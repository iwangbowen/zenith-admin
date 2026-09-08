/**
 * 分片上传 + 断点续传工具。
 * 大文件切片并发上传，失败分片自动重试；uploadId 持久化到 localStorage，
 * 支持刷新/重新选择同一文件后续传未完成的分片。
 *
 * 取消语义：调用方用 `controller.abort(CHUNKED_UPLOAD_CANCELLED)` 表示用户显式取消，此时通知服务端
 * 释放会话（云端 multipart / 临时分片）并清除续传键；不带该原因的 abort（页面卸载、路由切换）只中断
 * 请求，会话保留，下次选择同一文件仍可续传。
 */
import { fileContract, UPLOAD_CHUNK_MIN_BYTES, type UploadChunkResult, type UploadSessionInit, type UploadSessionStatus } from '@zenith/shared/platform';
import { urlOf } from '@/lib/contract-query';
import { request } from '@/utils/request';

/** 默认分片大小（5MB，即各 provider 允许的最小分片）。超过该大小的文件走分片上传；服务端可能上调，以 init 响应为准。 */
export const CHUNK_SIZE = UPLOAD_CHUNK_MIN_BYTES;
const CHUNK_CONCURRENCY = 3;
const MAX_RETRY = 3;
const RESUME_KEY_PREFIX = 'zenith_chunk_upload:';

/** `AbortController.abort(reason)` 的原因值：用户显式取消，需要服务端释放会话 */
export const CHUNKED_UPLOAD_CANCELLED = 'chunked-upload:cancelled';

/** 分片上传五个子路径的地址（init / chunk / complete / {uploadId}/status / {uploadId} 中止） */
export interface ChunkedUploadEndpoints {
  init: string;
  chunk: string;
  complete: string;
  status: (uploadId: string) => string;
  abort: (uploadId: string) => string;
}

/** 通用文件服务的分片接口，由契约派生 */
const FILE_UPLOAD_ENDPOINTS: ChunkedUploadEndpoints = {
  init: urlOf(fileContract.uploadInit),
  chunk: urlOf(fileContract.uploadChunk),
  complete: urlOf(fileContract.uploadComplete),
  status: (uploadId) => urlOf(fileContract.uploadStatus, { params: { uploadId } }),
  abort: (uploadId) => urlOf(fileContract.uploadAbort, { params: { uploadId } }),
};

export interface ChunkedUploadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  /**
   * 分片接口地址，默认通用文件服务（`fileContract.uploadInit` 等五个操作）。
   * 归属模块（如企业网盘）传入由自己契约派生的地址（init / chunk / complete / status / abort）。
   */
  endpoints?: ChunkedUploadEndpoints;
  /** init 请求的附加字段（目标目录、冲突策略、内容哈希等），与 fileName / fileSize / mimeType / chunkSize 合并 */
  initExtra?: Record<string, unknown>;
  /** 续传键的额外维度：同一文件上传到不同目标时不应复用会话 */
  resumeScope?: string;
}

function resumeKey(file: File, scope?: string) {
  return `${RESUME_KEY_PREFIX}${scope ? `${scope}:` : ''}${file.name}:${file.size}:${file.lastModified}`;
}

function isUserCancelled(signal?: AbortSignal) {
  return !!signal?.aborted && signal.reason === CHUNKED_UPLOAD_CANCELLED;
}

/** 会话在服务端已不处于上传中（完成 / 中止 / 不存在）时清掉续传键，避免下次误续传 */
async function forgetIfNotUploading(key: string, endpoints: ChunkedUploadEndpoints, uploadId: string) {
  const body = await request.get<UploadSessionStatus>(endpoints.status(uploadId), { silent: true });
  if (body.code !== 0 || body.data.status !== 'uploading') localStorage.removeItem(key);
}

const COMPLETING_POLL_INTERVAL_MS = 2000;
const COMPLETING_POLL_MAX = 15;

type SessionProbe = UploadSessionStatus | { status: 'missing' } | { status: 'completing' };

/**
 * 会话正在服务端合并（上一次 complete 仍在进行，或并发 complete 被 409 拒绝）时轮询等待，
 * 直到离开 completing 或超时（约 30s，超时仍返回 completing 由调用方提示稍后重试）。
 */
async function waitWhileCompleting(endpoints: ChunkedUploadEndpoints, uploadId: string, signal?: AbortSignal): Promise<SessionProbe> {
  for (let i = 0; i < COMPLETING_POLL_MAX; i++) {
    if (signal?.aborted) throw new Error('已取消');
    const body = await request.get<UploadSessionStatus>(endpoints.status(uploadId), { silent: true, signal });
    if (body.code !== 0) return { status: 'missing' };
    if (body.data.status !== 'completing') return body.data;
    await new Promise((r) => setTimeout(r, COMPLETING_POLL_INTERVAL_MS));
  }
  return { status: 'completing' };
}

const COMPLETING_RETRY_LATER = '上一次上传正在服务端合并中，请稍后重试';
const COMPLETED_ELSEWHERE = '该文件的上一次上传已在服务端完成，请刷新列表确认';

/** 对单个文件执行分片上传，返回最终的 ManagedFile（data）。 */
export async function chunkedUpload<TFile = unknown>(file: File, opts: ChunkedUploadOptions): Promise<TFile> {
  const { signal, endpoints = FILE_UPLOAD_ENDPOINTS, initExtra, resumeScope } = opts;
  const key = resumeKey(file, resumeScope);

  let uploadId = '';
  let chunkSize = CHUNK_SIZE;
  let totalChunks = 0;
  const received = new Set<number>();

  // 1) 尝试续传：localStorage 中已有未完成会话
  const storedId = localStorage.getItem(key);
  if (storedId) {
    const body = await request.get<UploadSessionStatus>(endpoints.status(storedId), { silent: true, signal });
    let probe: SessionProbe = body.code === 0 ? body.data : { status: 'missing' };
    if (probe.status === 'completing') {
      // 上一次 complete 仍在合并（如刷新页面时正在合并）：等它结束再决定续传还是重新开始
      probe = await waitWhileCompleting(endpoints, storedId, signal);
      if (probe.status === 'completing') throw new Error(COMPLETING_RETRY_LATER);
      if (probe.status === 'completed') { localStorage.removeItem(key); throw new Error(COMPLETED_ELSEWHERE); }
    }
    if (probe.status === 'uploading') {
      uploadId = storedId;
      chunkSize = probe.chunkSize;
      totalChunks = probe.totalChunks;
      probe.received.forEach((i) => received.add(i));
    } else if (!signal?.aborted) {
      // 会话已完成 / 中止 / 过期：丢弃旧键，走全新初始化
      localStorage.removeItem(key);
    }
  }

  // 2) 初始化
  if (!uploadId) {
    const body = await request.post<UploadSessionInit>(
      endpoints.init,
      { ...initExtra, fileName: file.name, fileSize: file.size, mimeType: file.type || undefined, chunkSize: CHUNK_SIZE },
      { silent: true, signal },
    );
    if (body.code !== 0) throw new Error(body.message || '初始化上传失败');
    uploadId = body.data.uploadId;
    chunkSize = body.data.chunkSize;
    totalChunks = body.data.totalChunks;
    body.data.received.forEach((i) => received.add(i));
    localStorage.setItem(key, uploadId);
  }

  try {
    // 3) 并发上传缺失分片（失败重试）
    const missing: number[] = [];
    for (let i = 0; i < totalChunks; i++) if (!received.has(i)) missing.push(i);

    let done = received.size;
    const report = () => opts.onProgress?.(totalChunks === 0 ? 100 : Math.min(99, Math.round((done / totalChunks) * 100)));
    report();

    const uploadOne = async (index: number): Promise<void> => {
      const start = index * chunkSize;
      const blob = file.slice(start, Math.min(start + chunkSize, file.size));
      for (let attempt = 0; ; attempt++) {
        try {
          const fd = new FormData();
          fd.append('uploadId', uploadId);
          fd.append('index', String(index));
          fd.append('chunk', blob);
          const body = await request.post<UploadChunkResult>(endpoints.chunk, fd, { silent: true, signal });
          if (body.code !== 0) throw new Error(body.message || '分片上传失败');
          return;
        } catch (err) {
          if (signal?.aborted || attempt >= MAX_RETRY) throw err;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    };

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < missing.length) {
        if (signal?.aborted) throw new Error('已取消');
        const index = missing[cursor++];
        await uploadOne(index);
        done++;
        report();
      }
    };
    const workerCount = Math.min(CHUNK_CONCURRENCY, Math.max(1, missing.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // 4) 合并完成；撞上并发合并（409）时等待对方结束：回到 uploading 说明对方失败可重试，completed 说明已由对方完成
    let body = await request.post<TFile>(endpoints.complete, { uploadId }, { silent: true, signal });
    if (body.code === 409) {
      const probe = await waitWhileCompleting(endpoints, uploadId, signal);
      if (probe.status === 'completed') { localStorage.removeItem(key); throw new Error(COMPLETED_ELSEWHERE); }
      if (probe.status === 'completing') throw new Error(COMPLETING_RETRY_LATER);
      if (probe.status !== 'uploading') { localStorage.removeItem(key); throw new Error('上传会话已失效，请重新上传'); }
      body = await request.post<TFile>(endpoints.complete, { uploadId }, { silent: true, signal });
    }
    if (body.code !== 0) {
      // 内容 / 大小 / 类型校验失败等终态错误会让服务端中止会话，此时不能再续传
      if (!signal?.aborted) await forgetIfNotUploading(key, endpoints, uploadId).catch(() => { /* 探测失败保留续传键 */ });
      throw new Error(body.message || '合并失败');
    }
    localStorage.removeItem(key);
    opts.onProgress?.(100);
    return body.data;
  } catch (err) {
    if (isUserCancelled(signal)) {
      // 用户显式取消：释放服务端会话（云端 multipart / 临时分片），不保留续传
      localStorage.removeItem(key);
      void request.delete(endpoints.abort(uploadId), undefined, { silent: true }).catch(() => { /* 释放失败由保留策略兜底 */ });
    }
    throw err;
  }
}