import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface LogFile {
  name: string;
  size: number;
  modifiedAt: string;
  isGzip: boolean;
}

export interface LogFileContentParams {
  lines: number;
  keyword?: string;
}

export const logFileKeys = {
  all: ['log-files'] as const,
  lists: ['log-files', 'list'] as const,
  list: () => ['log-files', 'list'] as const,
  content: (filename: string | undefined, params: LogFileContentParams) => ['log-files', 'content', filename, params] as const,
};

export function useLogFiles() {
  return useQuery({
    queryKey: logFileKeys.list(),
    queryFn: () => request.get<LogFile[]>('/api/log-files').then(unwrap),
  });
}

export function useLogFileContent(filename: string | undefined, params: LogFileContentParams, enabled = true) {
  return useQuery({
    queryKey: logFileKeys.content(filename, params),
    queryFn: () =>
      request.get<{ lines: string[] }>(`/api/log-files/${encodeURIComponent(filename ?? '')}/content${toQueryString(params)}`).then(unwrap),
    enabled: enabled && !!filename,
  });
}

export function useDeleteLogFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => request.delete<null>(`/api/log-files/${encodeURIComponent(filename)}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: logFileKeys.all }),
  });
}
