/**
 * 文件管理的长耗时任务：压缩与解压。
 *
 * 这两个操作在 GB 级归档上可以跑几分钟。放在请求里做，用户只能盯着转圈、
 * 无法取消、也看不到进展，浏览器或网关一超时前端就失去了它的下落——
 * 但服务端仍在继续写盘。接入任务中心后：可查进度、可取消、可事后追溯。
 *
 * 目录统计与文件名搜索**刻意不走任务中心**：它们是详情面板与搜索框里的即时查询，
 * 变成「提交任务→去任务中心看结果」反而更难用；它们的问题是无界延迟，
 * 已由 service 层的节点数 + 时间预算与 `truncated` 标记解决。
 */
import { registerTaskHandler } from '../../lib/task-center';
import { ArchiveCancelledError, compressToZip, extractArchive } from './terminal-files.service';

export const COMPRESS_TASK_TYPE = 'terminal-file-compress';
export const EXTRACT_TASK_TYPE = 'terminal-file-extract';

export function registerTerminalFileTaskHandlers(): void {
  registerTaskHandler({
    taskType: COMPRESS_TASK_TYPE,
    title: '压缩文件',
    module: '文件管理',
    description: '将选中的文件/目录打包为 ZIP；支持查看条目进度与中途取消。',
    allowConcurrent: true,
    // 操作的是文件管理器所在服务节点的本地文件系统：只能由提交任务的进程执行
    affinity: 'node',
    async run(ctx) {
      const paths = Array.isArray(ctx.payload.paths) ? (ctx.payload.paths as string[]) : [];
      const destPath = String(ctx.payload.destPath ?? '');
      if (paths.length === 0 || !destPath) throw new Error('缺少压缩入参');

      try {
        const entry = await compressToZip(paths, destPath, {
          onProgress: async (processed, total) => {
            const { cancelRequested } = await ctx.progress({
              processed,
              total: total || undefined,
              note: total ? `已打包 ${processed}/${total} 个条目` : `已打包 ${processed} 个条目`,
            });
            return cancelRequested;
          },
        });
        return { path: entry.path, size: entry.size, message: `已压缩到 ${entry.path}` };
      } catch (err) {
        // 取消是用户意图，不应记为失败；压缩产物已在 service 层清理
        if (err instanceof ArchiveCancelledError) return { message: '压缩已取消' };
        throw err;
      }
    },
  });

  registerTaskHandler({
    taskType: EXTRACT_TASK_TYPE,
    title: '解压文件',
    module: '文件管理',
    description: '解压 zip / tar / tar.gz / tar.bz2 / tar.xz / gz；支持中途取消。',
    allowConcurrent: true,
    affinity: 'node',
    async run(ctx) {
      const archivePath = String(ctx.payload.path ?? '');
      const destDir = ctx.payload.destDir ? String(ctx.payload.destDir) : undefined;
      if (!archivePath) throw new Error('缺少解压入参');

      await ctx.progress({ note: `正在解压 ${archivePath}…` });
      try {
        const entry = await extractArchive(archivePath, destDir, {
          isCancelled: () => ctx.isCancelRequested(),
        });
        return { path: entry.path, message: `已解压到 ${entry.path}` };
      } catch (err) {
        if (err instanceof ArchiveCancelledError) return { message: '解压已取消' };
        throw err;
      }
    },
  });
}
