import { apiAccessLogContract } from '@zenith/shared/platform';
import { mockApiAccessLogs } from '@/mocks/data/logs';
import { mock } from '@/mocks/utils/contract';

export const apiAccessLogsHandlers = [
  mock(apiAccessLogContract.list, ({ query, ok, paginate }) => {
    const list = mockApiAccessLogs.filter((row) => {
      if (query.username && !(row.username ?? '').includes(query.username)) return false;
      if (query.module && !(row.module ?? '').includes(query.module)) return false;
      if (query.method && row.method !== query.method) return false;
      if (query.path && !row.path.includes(query.path)) return false;
      if (query.routePath && !(row.routePath ?? '').includes(query.routePath)) return false;
      if (query.requestId && !(row.requestId ?? '').startsWith(query.requestId)) return false;
      if (query.status === 'success' && (row.responseCode == null || row.responseCode >= 400)) return false;
      if (query.status === 'fail' && (row.responseCode == null || row.responseCode < 400)) return false;
      if (query.minDurationMs != null && (row.durationMs == null || row.durationMs < query.minDurationMs)) return false;
      if (query.maxDurationMs != null && (row.durationMs == null || row.durationMs > query.maxDurationMs)) return false;
      return true;
    });
    return ok(paginate(list));
  }),
  mock(apiAccessLogContract.detail, ({ params, ok }) => ok(mockApiAccessLogs.find((row) => row.id === params.id) ?? mockApiAccessLogs[0])),
];

