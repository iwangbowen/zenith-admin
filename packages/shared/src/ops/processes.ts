import type { ProcessInfo } from './contracts/processes';

export interface ProcessFilter {
  /** 匹配进程名 / 命令行 / 用户 / PID（大小写不敏感，包含匹配） */
  keyword?: string;
  status?: string;
}

/**
 * 进程列表的客户端筛选谓词：进程数据来自实时 SSE / 一次性拉取，不经数据库，
 * 页面表格与导出中心对同一份快照做同样的过滤。
 */
export function matchesProcessFilter(p: Pick<ProcessInfo, 'name' | 'command' | 'user' | 'pid' | 'status'>, q: ProcessFilter): boolean {
  const kw = q.keyword?.trim().toLowerCase();
  const matchKw = !kw
    || p.name.toLowerCase().includes(kw)
    || p.command.toLowerCase().includes(kw)
    || p.user.toLowerCase().includes(kw)
    || String(p.pid).includes(kw);
  const matchStatus = !q.status || p.status === q.status;
  return matchKw && matchStatus;
}
