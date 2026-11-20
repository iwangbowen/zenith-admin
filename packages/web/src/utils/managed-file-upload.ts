import {
  FILE_DIRECT_UPLOAD_SUPPORT,
  fileContract,
  fileStorageConfigContract,
  type FileStorageConfig,
  type ManagedFile,
} from '@zenith/shared/platform';
import { api } from '@/lib/contract-query';
import { trackEvent } from '@/utils/tracker';
import { directMultipartUpload } from './direct-multipart-upload';

const QUICK_UPLOAD_HASH_LIMIT = 32 * 1024 * 1024;

async function quickUploadHash(file: File): Promise<string | undefined> {
  if (file.size > QUICK_UPLOAD_HASH_LIMIT || !globalThis.crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ManagedFileAutoUploadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  storageConfigId?: number;
  /** 文件列表的服务端中转降级必须显式关闭，避免直传失败后再次进入直传。 */
  allowDirect?: boolean;
  /** 调用方自己的表单上传通道，通常用于保留业务字段 / 自定义上传接口。 */
  proxy: () => Promise<ManagedFile>;
}

/**
 * 统一文件上传入口：默认存储为 browser-direct 时优先直传，失败后回退调用方提供的
 * 表单上传通道；Demo 模式与不允许直传的入口始终走 proxy。
 */
export async function uploadManagedFileAuto(
  file: File,
  options: ManagedFileAutoUploadOptions,
): Promise<ManagedFile> {
  if (import.meta.env.VITE_DEMO_MODE === 'true' || options.allowDirect === false) {
    return options.proxy();
  }
  let config: FileStorageConfig | null;
  try {
    config = await api(fileStorageConfigContract.defaultConfig, undefined, { silent: true });
  } catch {
    return options.proxy();
  }
  if (!config || config.uploadMode !== 'browser-direct' || !FILE_DIRECT_UPLOAD_SUPPORT[config.provider]) {
    return options.proxy();
  }
  try {
    const contentHash = await quickUploadHash(file);
    if (contentHash) {
      const existing = await api(fileContract.quickUpload, {
        body: { fileName: file.name, fileSize: file.size, mimeType: file.type || undefined, contentHash },
      });
      if (existing) {
        options.onProgress?.(100);
        return existing;
      }
    }
    return await directMultipartUpload({
      file,
      storageConfigId: options.storageConfigId ?? config.id,
      contentHash,
      onProgress: options.onProgress,
      signal: options.signal,
      abortOnFailure: true,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    trackEvent('file_direct_upload_fallback', { provider: config.provider, size: file.size });
    return options.proxy();
  }
}

/** 把 File 构造为通用 upload / upload-one 的 FormData，可保留调用方附加字段。 */
export function formDataWithFile(file: File, extra?: FormData): FormData {
  const formData = new FormData();
  for (const [key, value] of extra?.entries() ?? []) {
    if (key !== 'file') formData.append(key, value);
  }
  formData.append('file', file);
  return formData;
}
