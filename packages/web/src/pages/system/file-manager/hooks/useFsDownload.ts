/**
 * 下载：单文件直下；批量/含目录时先压缩为服务器临时 ZIP，下载完成后清理。
 *
 * 压缩已改为后台任务（GB 级打包会跑很久），因此这里显式等待任务进入终态后再下载；
 * 显式「压缩」动作则不等待，由任务托盘承载进度。
 */
import { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import dayjs from 'dayjs';
import type { UseMutationResult } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { terminalFileDownloadUrl, useTerminalCompress, waitForAsyncTask, type TerminalFileOperation } from '@/hooks/queries/terminal-files';
import { joinPath } from '../fs-utils';
import type { FsEntry } from '../types';

interface UseFsDownloadArgs {
  currentPath: string;
  filteredEntries: FsEntry[];
  selectedPaths: Set<string>;
  fileOperationMutation: UseMutationResult<null, Error, TerminalFileOperation>;
  deleteEntriesMutation: UseMutationResult<number, Error, string[]>;
}

export function useFsDownload({ currentPath, filteredEntries, selectedPaths, deleteEntriesMutation }: UseFsDownloadArgs) {
  const compressTask = useTerminalCompress();

  /** 按服务器路径下载文件；走统一 request 以复用 401 刷新、错误提示与 Demo 模式 */
  const downloadByPath = useCallback(async (path: string, fileName: string): Promise<void> => {
    await request.download(terminalFileDownloadUrl(path), fileName);
  }, []);

  const handleDownload = useCallback((entry: FsEntry) => {
    void downloadByPath(entry.path, entry.name);
  }, [downloadByPath]);

  /** 批量下载：单个文件直下；多项 / 含目录先压缩为临时 ZIP，下载后清理服务器临时包 */
  const handleBatchDownload = async () => {
    const sel = filteredEntries.filter((e) => selectedPaths.has(e.path));
    if (sel.length === 0) return;
    if (sel.length === 1 && sel[0].type === 'file') {
      handleDownload(sel[0]);
      return;
    }
    const zipName = `打包下载_${dayjs().format('YYYYMMDDHHmmss')}.zip`;
    const dest = joinPath(currentPath, zipName);
    Toast.info({ content: `正在打包 ${sel.length} 项…`, duration: 2 });
    let packed = false;
    try {
      const task = await compressTask.mutateAsync({ body: { paths: sel.map((e) => e.path), destPath: dest } });
      const finished = await waitForAsyncTask(task.id);
      if (finished.status !== 'success') {
        Toast.error(finished.status === 'cancelled' ? '打包已取消' : '打包失败');
        return;
      }
      packed = true;
      await downloadByPath(dest, zipName);
      Toast.success('打包下载完成');
    } catch {
      Toast.error('打包下载失败');
    } finally {
      // 只有确实产出了临时包才需要清理
      if (packed) await deleteEntriesMutation.mutateAsync([dest]).catch(() => {});
    }
  };

  return { handleDownload, handleBatchDownload };
}
