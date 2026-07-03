import { useQuery } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface LogViewerContentParams {
  path: string;
  lines: number;
}

export const logViewerKeys = {
  all: ['log-viewer'] as const,
  content: (params: LogViewerContentParams) => ['log-viewer', 'content', params] as const,
};

export function useLogViewerContent(params: LogViewerContentParams, enabled = true) {
  return useQuery({
    queryKey: logViewerKeys.content(params),
    queryFn: () => request.get<{ content: string }>(`/api/log-viewer/content${toQueryString(params)}`).then(unwrap),
    enabled: enabled && !!params.path,
  });
}
