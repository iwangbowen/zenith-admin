/**
 * 业务统一上传：业务模块只提供 init 与两套通道地址，客户端按服务端裁定的 mode
 * 自动走服务端分片或浏览器直传，并在两种模式间共享同一套续传检查点。
 */
import type { UploadSessionInit, UploadSessionStatus } from '@zenith/shared/platform';
import { ApiError } from '@/lib/query';
import { CHUNK_SIZE, CHUNKED_UPLOAD_CANCELLED, uploadChunksToSession, type ChunkedUploadChannel } from './chunked-upload';
import { directMultipartUpload, type DirectUploadChannel } from './direct-multipart-upload';
import { request } from './request';
import { scopedStorageKey } from './storage';

const BUSINESS_RESUME_PREFIX = 'business-upload:';

type BusinessResumeMode = 'server-proxy' | 'browser-direct';

interface BusinessResumeCheckpoint {
  uploadId: string;
  mode: BusinessResumeMode;
}

export interface BusinessUploadEndpoints<TFile> {
  /** 业务 init：返回会话与 mode，并完成业务权限 / 上下文绑定 */
  init: (body: Record<string, unknown>) => Promise<UploadSessionInit>;
  /** 服务端分片通道（chunk / complete / status / abort） */
  proxy: ChunkedUploadChannel;
  /** 浏览器直传通道（partUrl / partAck / status / complete / abort） */
  direct: DirectUploadChannel<TFile>;
}

export interface BusinessUploadOptions<TFile> {
  file: File;
  endpoints: BusinessUploadEndpoints<TFile>;
  /** init 的业务字段（目标节点、制品平台、固件版本等） */
  initExtra?: Record<string, unknown>;
  /** 续传键的作用域，需包含业务目标（版本 ID / 目录 ID） */
  resumeScope: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

function resumeKey(file: File, scope: string) {
  return scopedStorageKey(`${BUSINESS_RESUME_PREFIX}${scope}:${file.name}:${file.size}:${file.lastModified}`);
}

function readCheckpoint(key: string): BusinessResumeCheckpoint | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<BusinessResumeCheckpoint> | null;
    if (!parsed || typeof parsed.uploadId !== 'string') return null;
    if (parsed.mode !== 'server-proxy' && parsed.mode !== 'browser-direct') return null;
    return { uploadId: parsed.uploadId, mode: parsed.mode };
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

async function probeCheckpoint<TFile>(
  checkpoint: BusinessResumeCheckpoint,
  endpoints: BusinessUploadEndpoints<TFile>,
  signal?: AbortSignal,
): Promise<UploadSessionStatus | null> {
  try {
    if (checkpoint.mode === 'browser-direct') {
      return await endpoints.direct.status(checkpoint.uploadId);
    }
    const body = await request.get<UploadSessionStatus>(endpoints.proxy.status(checkpoint.uploadId), { silent: true, signal });
    return body.code === 0 ? body.data : null;
  } catch (error) {
    if (error instanceof ApiError && error.code === 404) return null;
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw error;
  }
}

export async function uploadBusinessFile<TFile>(options: BusinessUploadOptions<TFile>): Promise<TFile> {
  const { file, endpoints, initExtra, resumeScope, onProgress, signal } = options;
  const key = resumeKey(file, resumeScope);

  const saved = readCheckpoint(key);
  if (saved) {
    const status = await probeCheckpoint(saved, endpoints, signal);
    if (status?.status === 'uploading') {
      return saved.mode === 'browser-direct'
        ? directMultipartUpload<TFile>({
          file,
          endpoints: { ...endpoints.direct, init: async () => { throw new Error('续传会话已存在'); } },
          session: {
            uploadId: status.uploadId,
            chunkSize: status.chunkSize,
            totalChunks: status.totalChunks,
            received: status.received,
          },
          resumeKey: key,
          onProgress,
          signal,
        })
        : uploadChunksToSession<TFile>(file, {
          uploadId: status.uploadId,
          chunkSize: status.chunkSize,
          totalChunks: status.totalChunks,
          received: status.received,
        }, { endpoints: endpoints.proxy, resumeKey: key, onProgress, signal });
    }
    if (status?.status === 'completing') throw new Error('上一次上传正在服务端合并中，请稍后重试');
    localStorage.removeItem(key);
  }

  const session = await endpoints.init({
    ...initExtra,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || undefined,
    chunkSize: CHUNK_SIZE,
  });
  localStorage.setItem(key, JSON.stringify({ uploadId: session.uploadId, mode: session.mode } satisfies BusinessResumeCheckpoint));

  if (session.mode === 'browser-direct') {
    return directMultipartUpload<TFile>({
      file,
      endpoints: { ...endpoints.direct, init: async () => session },
      session: {
        uploadId: session.uploadId,
        chunkSize: session.chunkSize,
        totalChunks: session.totalChunks,
        received: session.received,
      },
      resumeKey: key,
      onProgress,
      signal,
    });
  }

  return uploadChunksToSession<TFile>(file, session, {
    endpoints: endpoints.proxy,
    resumeKey: key,
    onProgress,
    signal,
  });
}

export { CHUNKED_UPLOAD_CANCELLED };
