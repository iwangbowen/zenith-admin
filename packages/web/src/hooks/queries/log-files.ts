import type { QueryOf } from '@zenith/shared/core';
import { logFileContract } from '@zenith/shared/ops';
import { contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type LogFileContentParams = NonNullable<QueryOf<typeof logFileContract.content>>;

export const logFileKeys = {
  all: ['log-files'] as const,
  lists: contractKey(logFileContract.list),
  list: () => contractKey(logFileContract.list),
  content: (filename: string | undefined, params: LogFileContentParams) =>
    contractKey(logFileContract.content, { params: { filename: filename ?? '' }, query: params }),
};

export function useLogFiles() {
  return useApiQuery(logFileContract.list);
}

export function useLogFileContent(filename: string | undefined, params: LogFileContentParams, enabled = true) {
  return useApiQuery(logFileContract.content, { params: { filename: filename ?? '' }, query: params }, {
    enabled: enabled && !!filename,
  });
}

export function useDeleteLogFile() {
  return useApiMutation(logFileContract.remove, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: logFileKeys.all });
    },
  });
}

export function logFileDownloadUrl(filename: string) {
  return urlOf(logFileContract.download, { params: { filename } });
}

/** SSE 实时跟踪地址（event: log；`request.fetchRaw` + `readSseStream` 消费） */
export function logFileTailUrl(filename: string) {
  return urlOf(logFileContract.tail, { params: { filename } });
}
