/**
 * 业务绑定上传的统一入口。
 *
 * 业务模块只声明「归属模块 + 业务上下文 + 可见性 + 校验属性」，平台负责：
 * 1. init 时创建会话（按存储配置与业务策略选择 server-proxy / browser-direct）并写入绑定；
 * 2. complete 时校验绑定归属、按会话属性完成合并与落库；
 * 3. 业务落库失败时回收刚生成的文件，避免留下无人引用的对象。
 *
 * 通用文件中心的 `uploadOne` / 直传 complete 不参与这套流程：它们不携带业务权限与上下文。
 */
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { ZodType } from 'zod';
import {
  FILE_DIRECT_UPLOAD_SUPPORT,
  UPLOAD_CHUNK_MIN_BYTES,
  type FileUploadMode,
  type FileVisibility,
  type ManagedFile,
  type UploadSessionInit,
} from '@zenith/shared/platform';
import { db } from '../../db';
import { fileStorageConfigs } from '../../db/schema';
import logger from '../../lib/logger';
import { recordFileUploadMetric } from '../../lib/file-upload-metrics';
import { createDirectUpload } from './direct-uploads.service';
import { deleteGeneratedManagedFile } from './files.service';
import { bindUploadSession, requireUploadBinding } from './upload-bindings.service';
import { abortChunkUpload, completeChunkUpload, getUploadSession, initChunkUpload } from './upload-sessions.service';

/** 模块标识只允许小写字母 / 数字 / 连字符，避免绑定表出现自由文本 */
const MODULE_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export interface BusinessUploadInitInput {
  module: string;
  /** 业务上下文（目标节点、版本 ID、制品平台等），complete 时按模块 schema 取回 */
  payload: Record<string, unknown>;
  visibility: FileVisibility;
  fileName: string;
  fileSize: number;
  mimeType?: string | null;
  chunkSize?: number;
  /** 客户端声明的内容 SHA-256；服务端在 complete 时按实际内容校验 */
  expectedHash?: string | null;
  /** 服务端必须产出可信摘要时置 true（制品 / 固件） */
  computeHash?: boolean;
  /** 任意二进制制品跳过 MIME 白名单 */
  skipTypeCheck?: boolean;
  /** 允许该域使用浏览器直传；实际模式仍受存储配置 uploadMode 与 provider 能力约束 */
  allowDirect?: boolean;
}

/** 默认存储是否具备浏览器直传条件；不可用时静默退回服务端中转 */
async function defaultStorageSupportsDirect(): Promise<boolean> {
  const [config] = await db
    .select()
    .from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled')))
    .limit(1);
  return !!config
    && config.uploadMode === 'browser-direct'
    && !!FILE_DIRECT_UPLOAD_SUPPORT[config.provider];
}

export async function initBusinessUpload(input: BusinessUploadInitInput): Promise<UploadSessionInit> {
  if (!MODULE_PATTERN.test(input.module)) {
    throw new HTTPException(500, { message: `上传模块标识无效：${input.module}` });
  }

  const sessionOptions = {
    module: input.module,
    visibility: input.visibility,
    expectedHash: input.expectedHash?.toLowerCase() ?? null,
    computeHash: input.computeHash ?? false,
    skipTypeCheck: input.skipTypeCheck ?? false,
  };

  const session = input.allowDirect && await defaultStorageSupportsDirect()
    ? await createDirectUpload({
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType ?? undefined,
    }, sessionOptions)
    : await initChunkUpload({
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType ?? undefined,
      chunkSize: input.chunkSize ?? UPLOAD_CHUNK_MIN_BYTES,
    }, sessionOptions);

  try {
    await bindUploadSession(session.uploadId, input.module, input.payload);
  } catch (error) {
    await abortChunkUpload(session.uploadId, { allowBrowserDirect: true }).catch(() => { /* 绑定失败已足以让会话不可用 */ });
    throw error;
  }
  return session;
}

export interface BusinessUploadCompleteInput<T, R> {
  uploadId: string;
  module: string;
  /** 绑定 payload 的 schema；解析失败视为上下文失效，要求重新上传 */
  schema: ZodType<T>;
  /** 业务落库；抛错时平台回收本次生成的文件 */
  onComplete: (file: ManagedFile, payload: T, context: { mode: FileUploadMode }) => Promise<R>;
}

export async function completeBusinessUpload<T, R>(input: BusinessUploadCompleteInput<T, R>): Promise<R> {
  const payload = await requireUploadBinding(input.uploadId, input.module, input.schema);
  const session = await getUploadSession(input.uploadId);
  if (session.module !== input.module) {
    throw new HTTPException(400, { message: '上传会话不属于当前业务模块' });
  }

  let file: ManagedFile;
  try {
    file = await completeChunkUpload(input.uploadId, {
      allowBrowserDirect: session.uploadMode === 'browser-direct',
    });
  } catch (error) {
    if (session.uploadMode === 'browser-direct') recordFileUploadMetric('directFailed');
    throw error;
  }
  if (session.uploadMode === 'browser-direct') recordFileUploadMetric('directCompleted');

  try {
    return await input.onComplete(file, payload, { mode: session.uploadMode });
  } catch (error) {
    // 业务事务已回滚时引用计数仍为 0，可直接回收；已产生引用则交给孤儿 GC
    await deleteGeneratedManagedFile(file.id, session.tenantId).catch((cleanupError: unknown) => {
      logger.warn(`[business-uploads] 回收上传文件失败 module=${input.module} fileId=${file.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    });
    throw error;
  }
}
