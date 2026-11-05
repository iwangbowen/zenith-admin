/**
 * 日志源：把「应用日志目录内的文件」、「白名单目录 / 远端主机上的绝对路径」与后端控制台
 * 收敛成同一组读取入口，供共享的日志工作台组件消费。各契约共用 `logTailQuery` /
 * `logLinesSchema` / SSE `event: log`；应用日志额外支持按 correlationId 精确筛选链路。
 */
import { CONSOLE_LOG_ROLE_LABELS, type ConsoleLogRole } from '@zenith/shared/ops';
import { consoleLogTailUrl, useConsoleLogContent } from './console-logs';
import { logFileDownloadUrl, logFileTailUrl, useLogFileContent, type LogFileContentParams } from './log-files';
import { logViewerDownloadUrl, logViewerTailUrl, useLogViewerContent } from './log-viewer';

export type LogSource =
  /** 应用日志目录内的文件（`/api/log-files`，权限 `system:log:files`） */
  | { kind: 'file'; filename: string }
  /** 后端自身的运行输出，按可访问日志目录中的进程角色区分 */
  | { kind: 'console'; role: ConsoleLogRole }
  /** 白名单目录内的绝对路径，可选远端主机（`/api/log-viewer`，权限 `system:log:view`） */
  | { kind: 'path'; path: string; hostId?: number | null };

export type LogTailParams = LogFileContentParams;

/** 同一来源的稳定标识：用作组件 key，切换来源时重挂载工作台 */
export function logSourceKey(source: LogSource): string {
  if (source.kind === 'console') return `console:${source.role}`;
  return source.kind === 'file'
    ? `file:${source.filename}`
    : `path:${source.hostId ?? 'local'}:${source.path}`;
}

/** 展示用名称：文件名 / 路径最后一段 */
export function logSourceName(source: LogSource): string {
  if (source.kind === 'console') return `${CONSOLE_LOG_ROLE_LABELS[source.role]} 控制台`;
  if (source.kind === 'file') return source.filename;
  return source.path.split('/').pop() || source.path;
}

/**
 * 读取来源的末尾 N 行。各契约查询都无条件声明（保持 hooks 调用顺序稳定），
 * 只有与来源类型匹配的一条启用。
 */
export function useLogSourceContent(source: LogSource, params: LogTailParams, enabled = true) {
  // 精确链路筛选只属于应用日志契约，远程/任意路径查看器继续使用通用读取参数。
  const { correlationId: _correlationId, locateCorrelationId: _locateCorrelationId, ...pathParams } = params;
  const fileQuery = useLogFileContent(
    source.kind === 'file' ? source.filename : undefined,
    params,
    enabled && source.kind === 'file',
  );
  const pathQuery = useLogViewerContent(
    { path: source.kind === 'path' ? source.path : '', hostId: source.kind === 'path' ? source.hostId : undefined, ...pathParams },
    enabled && source.kind === 'path',
  );
  const consoleQuery = useConsoleLogContent(
    source.kind === 'console' ? source.role : undefined,
    params,
    enabled && source.kind === 'console',
  );
  if (source.kind === 'console') return consoleQuery;
  return source.kind === 'file' ? fileQuery : pathQuery;
}

export function logSourceTailUrl(source: LogSource): string {
  if (source.kind === 'console') return consoleLogTailUrl(source.role);
  return source.kind === 'file' ? logFileTailUrl(source.filename) : logViewerTailUrl(source.path, source.hostId);
}

export function logSourceDownloadUrl(source: Exclude<LogSource, { kind: 'console' }>): string {
  return source.kind === 'file' ? logFileDownloadUrl(source.filename) : logViewerDownloadUrl(source.path, source.hostId);
}
