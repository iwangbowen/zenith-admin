/**
 * 分片上传会话的 Mock 存储：通用文件服务与各归属模块（App 制品、IoT 固件）共用同一套会话语义，
 * 分片大小裁定复用 shared 的纯算术，与服务端一致。
 */
import {
  countUploadChunks,
  resolveUploadChunkSize,
  type UploadChunkResult,
  type UploadSessionInit,
  type UploadSessionStatus,
} from '@zenith/shared/platform';

export interface MockUploadSession<TMeta = Record<string, unknown>> {
  uploadId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  chunkSize: number;
  totalChunks: number;
  received: Set<number>;
  status: UploadSessionStatus['status'];
  /** 归属模块在 init 时附带的业务上下文（目标 id、枚举等） */
  meta: TMeta;
}

const sessions = new Map<string, MockUploadSession>();

interface InitInput {
  fileName: string;
  fileSize: number;
  mimeType?: string;
  chunkSize: number;
}

/** 创建会话；文件超出分片上限时返回 null */
export function initMockUploadSession<TMeta extends Record<string, unknown>>(input: InitInput, meta: TMeta): UploadSessionInit | null {
  const chunkSize = resolveUploadChunkSize(input.fileSize, input.chunkSize);
  if (chunkSize === null) return null;
  const uploadId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const totalChunks = countUploadChunks(input.fileSize, chunkSize);
  sessions.set(uploadId, {
    uploadId, fileName: input.fileName, fileSize: input.fileSize, mimeType: input.mimeType,
    chunkSize, totalChunks, received: new Set(), status: 'uploading', meta,
  });
  return { uploadId, chunkSize, totalChunks, received: [] };
}

export function getMockUploadSession<TMeta = Record<string, unknown>>(uploadId: string): MockUploadSession<TMeta> | null {
  return (sessions.get(uploadId) as MockUploadSession<TMeta> | undefined) ?? null;
}

/** 登记一片；会话不存在返回 null */
export function receiveMockUploadChunk(uploadId: string, index: number): UploadChunkResult | null {
  const session = sessions.get(uploadId);
  if (!session) return null;
  session.received.add(index);
  return { index, receivedCount: session.received.size };
}

export function mockUploadSessionStatus(uploadId: string): UploadSessionStatus | null {
  const session = sessions.get(uploadId);
  if (!session) return null;
  return {
    uploadId: session.uploadId, status: session.status, chunkSize: session.chunkSize,
    totalChunks: session.totalChunks, received: [...session.received].sort((a, b) => a - b),
  };
}

/** 完成会话：取出并移除，供归属模块落业务对象；会话不存在返回 null */
export function completeMockUploadSession<TMeta = Record<string, unknown>>(uploadId: string): MockUploadSession<TMeta> | null {
  const session = sessions.get(uploadId) as MockUploadSession<TMeta> | undefined;
  if (!session) return null;
  session.status = 'completed';
  sessions.delete(uploadId);
  return session;
}

export function abortMockUploadSession(uploadId: string) {
  sessions.delete(uploadId);
}
