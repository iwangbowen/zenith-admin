/**
 * 选择 + 剪贴板（复制/剪切/粘贴）+ 传输冲突处理。
 *
 * transferEntries 是移动/复制的统一入口：读取目标目录已有名 → 同目录复制自动
 * 「副本」命名 → 跨目录冲突弹窗询问（覆盖/跳过/保留两者）→ 逐项执行。
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  localBrowseQueryOptions,
  useDeleteTerminalEntries,
  useTerminalFileOperation,
} from '@/hooks/queries/terminal-files';
import { joinPath, makeCopyName } from '../fs-utils';
import type { ClipOp, ConflictResolution } from '../types';

export function useFsSelection() {
  const qc = useQueryClient();
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [clipboard, setClipboard] = useState<{ paths: string[]; op: ClipOp } | null>(null);
  const [conflictAsk, setConflictAsk] = useState<{ names: string[]; resolve: (r: ConflictResolution | null) => void } | null>(null);

  const fileOperationMutation = useTerminalFileOperation();
  const deleteEntriesMutation = useDeleteTerminalEntries();

  const toggleSelect = (p: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const clearSelect = useCallback(() => setSelectedPaths(new Set()), []);

  // ── 同名冲突处理 ──────────────────────────────────────────────────────────

  /** 读取目录内已有条目名（小写集合），检测粘贴/复制冲突用；staleTime 0 保证拿到新鲜清单 */
  const fetchDirNames = useCallback(async (dir: string): Promise<Set<string>> => {
    const res = await qc.fetchQuery({ ...localBrowseQueryOptions(dir), staleTime: 0 });
    return new Set((res?.entries ?? []).map((e) => e.name.toLowerCase()));
  }, [qc]);

  /** 弹出冲突处理选择框（覆盖 / 跳过 / 保留两者），取消返回 null */
  const askConflictResolution = useCallback((names: string[]) => {
    return new Promise<ConflictResolution | null>((resolve) => {
      setConflictAsk({ names, resolve });
    });
  }, []);

  const settleConflictAsk = (r: ConflictResolution | null) => {
    conflictAsk?.resolve(r);
    setConflictAsk(null);
  };

  /**
   * 批量复制/移动到目标目录（同名冲突交互 + 同目录自动副本）。
   * 返回实际执行的条数；用户取消返回 -1。
   */
  const transferEntries = useCallback(async (
    items: { path: string; name: string }[],
    destDir: string,
    op: 'copy' | 'move',
  ): Promise<number> => {
    const taken = await fetchDirNames(destDir);

    // 同目录复制：全部自动「副本」命名，无需询问；同目录移动无意义，直接跳过
    const plans: { from: string; to: string; overwrite: boolean }[] = [];
    const conflicts: { path: string; name: string }[] = [];
    for (const item of items) {
      const srcDir = item.path.replace(/[/\\][^/\\]+$/, '') || item.path;
      const sameDir = joinPath(srcDir, '') === joinPath(destDir, '');
      if (sameDir) {
        if (op === 'move') continue;
        const copyName = makeCopyName(item.name, taken);
        taken.add(copyName.toLowerCase());
        plans.push({ from: item.path, to: joinPath(destDir, copyName), overwrite: false });
      } else if (taken.has(item.name.toLowerCase())) {
        conflicts.push(item);
      } else {
        taken.add(item.name.toLowerCase());
        plans.push({ from: item.path, to: joinPath(destDir, item.name), overwrite: false });
      }
    }

    if (conflicts.length > 0) {
      const resolution = await askConflictResolution(conflicts.map((c) => c.name));
      if (resolution === null) return -1;
      for (const c of conflicts) {
        if (resolution === 'skip') continue;
        if (resolution === 'overwrite') {
          plans.push({ from: c.path, to: joinPath(destDir, c.name), overwrite: true });
        } else {
          const copyName = makeCopyName(c.name, taken);
          taken.add(copyName.toLowerCase());
          plans.push({ from: c.path, to: joinPath(destDir, copyName), overwrite: false });
        }
      }
    }

    for (const plan of plans) {
      // 后端拒绝覆盖已存在目标：覆盖语义 = 先删除目标再执行
      if (plan.overwrite) {
        await deleteEntriesMutation.mutateAsync([plan.to]).catch(() => {});
      }
      await fileOperationMutation.mutateAsync({ kind: op, from: plan.from, to: plan.to });
    }
    return plans.length;
  }, [fetchDirNames, askConflictResolution, deleteEntriesMutation, fileOperationMutation]);

  return {
    selectedPaths,
    setSelectedPaths,
    toggleSelect,
    clearSelect,
    clipboard,
    setClipboard,
    conflictAsk,
    settleConflictAsk,
    transferEntries,
    fileOperationMutation,
    deleteEntriesMutation,
  };
}
