import { useCallback, useEffect, useRef, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  collectDriveUploadDirectories,
  driveRelativePathSchema,
  driveUploadParentPath,
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
import type { DirectoryUploadFile } from '@/utils/directory-upload';
import { hashDriveFile } from './drive-hash';

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
  relativePath: string;
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

/**
 * 网盘上传队列：预检（冲突 / 配额 / 秒传）→ 简单上传或分片续传 → 失效目录与用量。
 * 不同目录最多三个并行任务，同目录串行；冲突询问串行化，取消同时终止哈希 Worker。
 */
export function useDriveUploader() {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [conflict, setConflict] = useState<UploadConflict | null>(null);
  const queueRef = useRef<UploadItem[]>([]);
  const runningRef = useRef(false);
  const controllersRef = useRef(new Map<string, AbortController>());
  const cancelledRef = useRef(new Set<string>());
  type ConflictRequest = UploadConflict & { signal: AbortSignal; finish: UploadConflict['resolve'] };
  const conflictsRef = useRef<ConflictRequest[]>([]);
  const currentConflictRef = useRef<ConflictRequest | null>(null);
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

  const showConflict = useCallback(function showNext(): void {
    if (currentConflictRef.current) return;
    const next = conflictsRef.current.shift();
    if (!next) return;
    if (next.signal.aborted) { next.finish(null); showNext(); return; }
    if (batchPolicyRef.current !== undefined) {
      next.finish(batchPolicyRef.current === null ? null : { policy: batchPolicyRef.current, applyAll: true });
      showNext();
      return;
    }
    currentConflictRef.current = next;
    setConflict({ fileName: next.fileName, resolve: next.resolve });
  }, []);

  const askConflict = useCallback((fileName: string, signal: AbortSignal) =>
    new Promise<{ policy: DriveUploadConflictPolicy; applyAll: boolean } | null>((resolve) => {
      const abort = () => item.resolve(null);
      const item: ConflictRequest = {
        fileName, signal,
        finish: (answer) => { signal.removeEventListener('abort', abort); resolve(answer); },
        resolve: (answer) => {
          if (answer?.applyAll) batchPolicyRef.current = answer.policy;
          conflictsRef.current = conflictsRef.current.filter((entry) => entry !== item);
          if (currentConflictRef.current === item) { currentConflictRef.current = null; setConflict(null); }
          item.finish(answer);
          showConflict();
        },
      };
      if (signal.aborted) { resolve(null); return; }
      signal.addEventListener('abort', abort, { once: true });
      conflictsRef.current.push(item);
      showConflict();
    }), [showConflict]);

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      queueRef.current = [];
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  const processOne = useCallback(async (item: UploadItem) => {
    const controller = new AbortController();
    controllersRef.current.set(item.id, controller);
    try {
      patch(item.id, { status: 'hashing', percent: 0 });
      const contentHash = await hashDriveFile(item.file, controller.signal, (percent) => patch(item.id, { percent }));
      if (controller.signal.aborted) throw new Error('已取消');
      const precheckBody = { spaceId: item.spaceId, parentId: item.parentId, fileName: item.file.name, fileSize: item.file.size, contentHash };
      // 冲突时先不落地；无冲突的可见内容可在预检阶段直接秒传。
      const precheck = await api(driveNodeContract.precheck, { body: { ...precheckBody, conflictPolicy: 'fail' } }, { signal: controller.signal, silent: true });
      if (precheck.node) {
        patch(item.id, { status: 'done', percent: 100, instant: true, node: precheck.node });
        finish(item);
        return;
      }
      if (!precheck.quotaOk) throw new Error('空间配额不足');
      let policy: DriveUploadConflictPolicy = 'rename';
      if (precheck.conflict) {
        if (batchPolicyRef.current === undefined) {
          const answer = await askConflict(item.relativePath, controller.signal);
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
          signal: controller.signal,
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
      const active = new Map<string, Promise<void>>();
      while (queueRef.current.length || active.size) {
        while (active.size < 3) {
          const index = queueRef.current.findIndex((item) => !active.has(`${item.spaceId}:${item.parentId}`));
          if (index < 0) break;
          const [next] = queueRef.current.splice(index, 1);
          if (cancelledRef.current.has(next.id)) continue;
          const key = `${next.spaceId}:${next.parentId}`;
          active.set(key, processOne(next).finally(() => { active.delete(key); }));
        }
        if (active.size) await Promise.race(active.values());
      }
    } finally {
      runningRef.current = false;
      batchPolicyRef.current = undefined;
    }
  }, [processOne]);

  const enqueue = useCallback(async (files: Array<File | DirectoryUploadFile>, target: UploaderTarget, emptyDirectories: string[] = []) => {
    if (files.length === 0 && emptyDirectories.length === 0) return;
    const sources = files.map((source) => source instanceof File
      ? { file: source, relativePath: source.webkitRelativePath || source.name } : source);
    const created: UploadItem[] = sources.map((source) => ({
      id: crypto.randomUUID(),
      ...source,
      spaceId: target.spaceId,
      parentId: target.parentId,
      status: 'pending',
      percent: 0,
    }));
    setItems((prev) => [...created, ...prev.filter((item) => ACTIVE_STATUSES.includes(item.status)).concat(prev.filter((item) => !ACTIVE_STATUSES.includes(item.status)).slice(0, 200))]);
    try {
      for (const item of created) item.relativePath = driveRelativePathSchema.parse(item.relativePath);
      const paths = [...new Set([
        ...collectDriveUploadDirectories(created.map((item) => item.relativePath)),
        ...emptyDirectories.map((path) => driveRelativePathSchema.parse(path)),
      ])];
      const directoryIds = new Map<string, number | null>([['', target.parentId]]);
      for (let offset = 0; offset < paths.length; offset += 200) {
        const directories = await api(driveNodeContract.ensureDirectories, {
          body: { ...target, paths: paths.slice(offset, offset + 200) },
        });
        directories.forEach((directory) => directoryIds.set(directory.path, directory.nodeId));
      }
      for (const item of created) {
        const parent = directoryIds.get(driveUploadParentPath(item.relativePath));
        if (parent === undefined) throw new Error(`无法定位上传目录：${item.relativePath}`);
        item.parentId = parent;
      }
      invalidateDir(qc, target.spaceId, target.parentId);
      queueRef.current.push(...created.filter((item) => !cancelledRef.current.has(item.id)));
      void pump().catch((error) => Toast.error(error instanceof Error ? error.message : '上传队列失败'));
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传目录准备失败';
      created.forEach((item) => patch(item.id, { status: 'error', error: message }));
      Toast.error(message);
    }
  }, [patch, pump, qc]);

  const cancel = useCallback((id: string) => {
    cancelledRef.current.add(id);
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
