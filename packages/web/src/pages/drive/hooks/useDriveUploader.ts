import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DRIVE_CLIENT_HASH_MAX_BYTES,
  DRIVE_SIMPLE_UPLOAD_MAX_BYTES,
  driveNodeContract,
  type DriveNode,
  type DriveUploadConflictPolicy,
} from '@zenith/shared/drive';
import { request } from '@/utils/request';
import { api, urlOf } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { chunkedUpload, type ChunkedUploadEndpoints } from '@/utils/chunked-upload';
import { driveKeys, invalidateDir } from '@/hooks/queries/drive';

/** 网盘自有的分片上传接口（init / chunk / complete / status），由契约派生 */
const DRIVE_UPLOAD_ENDPOINTS: ChunkedUploadEndpoints = {
  init: urlOf(driveNodeContract.uploadInit),
  chunk: urlOf(driveNodeContract.uploadChunk),
  complete: urlOf(driveNodeContract.uploadComplete),
  status: (uploadId) => urlOf(driveNodeContract.uploadStatus, { params: { uploadId } }),
};

export type UploadItemStatus = 'pending' | 'hashing' | 'uploading' | 'done' | 'skipped' | 'error' | 'cancelled';

export interface UploadItem {
  id: string;
  file: File;
  spaceId: number;
  parentId: number | null;
  status: UploadItemStatus;
  percent: number;
  error?: string;
  /** 秒传命中 */
  instant?: boolean;
  node?: DriveNode;
}

export interface UploaderTarget {
  spaceId: number;
  parentId: number | null;
}

/** 等待用户决定的同名冲突；resolve(null) = 跳过 */
export interface UploadConflict {
  fileName: string;
  resolve: (answer: { policy: DriveUploadConflictPolicy; applyAll: boolean } | null) => void;
}

const ACTIVE_STATUSES: readonly UploadItemStatus[] = ['pending', 'hashing', 'uploading'];

/** 浏览器端 SHA-256（≤ DRIVE_CLIENT_HASH_MAX_BYTES 且运行在安全上下文时）；不可用返回 undefined */
async function sha256Hex(file: File): Promise<string | undefined> {
  if (file.size > DRIVE_CLIENT_HASH_MAX_BYTES || file.size === 0) return undefined;
  if (!globalThis.crypto?.subtle) return undefined;
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

/**
 * 网盘上传队列：预检（冲突 / 配额 / 秒传）→ 简单上传或分片续传 → 失效目录与用量。
 * 队列串行处理，避免同名文件并发落地时冲突策略互相干扰；冲突由 `conflict` 状态交给 UI 询问。
 */
export function useDriveUploader() {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [conflict, setConflict] = useState<UploadConflict | null>(null);
  const queueRef = useRef<UploadItem[]>([]);
  const runningRef = useRef(false);
  const controllersRef = useRef(new Map<string, AbortController>());
  /** undefined = 每次询问；null = 本批全部跳过；其余 = 本批统一策略 */
  const batchPolicyRef = useRef<DriveUploadConflictPolicy | null | undefined>(undefined);

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  }, []);

  const finish = useCallback((item: UploadItem) => {
    invalidateDir(qc, item.spaceId, item.parentId);
    void qc.invalidateQueries({ queryKey: driveKeys.mySpaces });
    void qc.invalidateQueries({ queryKey: driveKeys.spaceDetail(item.spaceId) });
    void qc.invalidateQueries({ queryKey: driveKeys.viewOf('recent') });
  }, [qc]);

  const askConflict = useCallback((fileName: string) => new Promise<{ policy: DriveUploadConflictPolicy; applyAll: boolean } | null>((resolve) => {
    setConflict({
      fileName,
      resolve: (answer) => {
        setConflict(null);
        resolve(answer);
      },
    });
  }), []);

  const processOne = useCallback(async (item: UploadItem) => {
    const controller = new AbortController();
    controllersRef.current.set(item.id, controller);
    try {
      patch(item.id, { status: 'hashing', percent: 0 });
      const contentHash = await sha256Hex(item.file);
      if (controller.signal.aborted) throw new Error('已取消');
      const precheckBody = { spaceId: item.spaceId, parentId: item.parentId, fileName: item.file.name, fileSize: item.file.size, contentHash };
      // 先用 fail 策略探测冲突（不会落地），交给用户决定
      const precheck = await api(driveNodeContract.precheck, { body: { ...precheckBody, conflictPolicy: 'fail' } }, { signal: controller.signal, silent: true });
      if (!precheck.quotaOk) throw new Error('空间配额不足');
      let policy: DriveUploadConflictPolicy = 'rename';
      if (precheck.conflict) {
        if (batchPolicyRef.current === undefined) {
          const answer = await askConflict(item.file.name);
          if (answer?.applyAll) batchPolicyRef.current = answer.policy;
          if (!answer) {
            if (controller.signal.aborted) throw new Error('已取消');
            patch(item.id, { status: 'skipped' });
            return;
          }
          policy = answer.policy;
        } else if (batchPolicyRef.current === null) {
          patch(item.id, { status: 'skipped' });
          return;
        } else {
          policy = batchPolicyRef.current;
        }
      }
      if (precheck.instant && contentHash) {
        const instant = await api(driveNodeContract.precheck, { body: { ...precheckBody, conflictPolicy: policy } }, { signal: controller.signal, silent: true });
        if (instant.node) {
          patch(item.id, { status: 'done', percent: 100, instant: true, node: instant.node });
          finish(item);
          return;
        }
      }
      patch(item.id, { status: 'uploading', percent: 0 });
      let node: DriveNode;
      if (item.file.size <= DRIVE_SIMPLE_UPLOAD_MAX_BYTES) {
        const fd = new FormData();
        fd.append('file', item.file);
        fd.append('spaceId', String(item.spaceId));
        if (item.parentId) fd.append('parentId', String(item.parentId));
        fd.append('conflictPolicy', policy);
        node = await request.postForm<DriveNode>(urlOf(driveNodeContract.upload), fd, {
          silent: true,
          onProgress: (p) => patch(item.id, { percent: Math.min(99, p) }),
        }).then(unwrap);
      } else {
        node = await chunkedUpload<DriveNode>(item.file, {
          endpoints: DRIVE_UPLOAD_ENDPOINTS,
          initExtra: { spaceId: item.spaceId, parentId: item.parentId, conflictPolicy: policy, contentHash },
          resumeScope: `drive:${item.spaceId}:${item.parentId ?? 0}`,
          signal: controller.signal,
          onProgress: (p) => patch(item.id, { percent: p }),
        });
      }
      patch(item.id, { status: 'done', percent: 100, node });
      finish(item);
    } catch (err) {
      const message = err instanceof Error ? err.message : '上传失败';
      patch(item.id, { status: controller.signal.aborted ? 'cancelled' : 'error', error: message });
    } finally {
      controllersRef.current.delete(item.id);
    }
  }, [askConflict, finish, patch]);

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const next = queueRef.current.shift();
        if (!next) break;
        await processOne(next);
      }
    } finally {
      runningRef.current = false;
      batchPolicyRef.current = undefined;
    }
  }, [processOne]);

  const enqueue = useCallback((files: File[], target: UploaderTarget) => {
    if (files.length === 0) return;
    const created: UploadItem[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      spaceId: target.spaceId,
      parentId: target.parentId,
      status: 'pending',
      percent: 0,
    }));
    setItems((prev) => [...created, ...prev].slice(0, 200));
    queueRef.current.push(...created);
    void pump();
  }, [pump]);

  const cancel = useCallback((id: string) => {
    controllersRef.current.get(id)?.abort();
    queueRef.current = queueRef.current.filter((it) => it.id !== id);
    setItems((prev) => prev.map((it) => (it.id === id && ACTIVE_STATUSES.includes(it.status) ? { ...it, status: 'cancelled' } : it)));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((it) => ACTIVE_STATUSES.includes(it.status)));
  }, []);

  const activeCount = items.filter((it) => ACTIVE_STATUSES.includes(it.status)).length;
  return { items, enqueue, cancel, clearFinished, activeCount, conflict };
}
