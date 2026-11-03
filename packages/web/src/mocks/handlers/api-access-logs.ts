import { apiAccessLogContract, apiAccessLogListItemSchema } from '@zenith/shared/platform';
import { mockApiAccessLogs } from '@/mocks/data/logs';
import { mock } from '@/mocks/utils/contract';
import { includesKeyword, matchesFilter, withinDateRange } from '@/mocks/utils/filter';
import { notFound } from '@/mocks/utils/handlers';

export const apiAccessLogsHandlers = [
  mock(apiAccessLogContract.list, ({ query, ok, paginate }) => {
    const list = mockApiAccessLogs.filter((row) => {
      if (!matchesFilter(row.userId, query.userId) || !matchesFilter(row.memberId, query.memberId) || !matchesFilter(row.deviceId, query.deviceId)) return false;
      if (!includesKeyword(query.accessorId?.trim(), row.accessorId)) return false;
      if (!matchesFilter(row.accessorType, query.accessorType) || !matchesFilter(row.credentialType, query.credentialType)) return false;
      if (!includesKeyword(query.accessorName?.trim(), row.accessorName)) return false;
      if (!includesKeyword(query.module?.trim(), row.module)) return false;
      if (!includesKeyword(query.operationKey?.trim(), row.operationKey)) return false;
      if (!includesKeyword(query.clientId?.trim(), row.clientId)) return false;
      if (query.method && row.method !== query.method.toUpperCase()) return false;
      if (!includesKeyword(query.path?.trim(), row.path)) return false;
      if (!includesKeyword(query.routePath?.trim(), row.routePath)) return false;
      if (!includesKeyword(query.serviceName?.trim(), row.serviceName) || !includesKeyword(query.ip?.trim(), row.ip)) return false;
      if (query.requestId && !(row.requestId ?? '').startsWith(query.requestId.trim())) return false;
      if (!matchesFilter(row.responseCode, query.responseCode)) return false;
      if (query.status === 'success' && (row.responseCode == null || row.responseCode < 200 || row.responseCode >= 400)) return false;
      if (query.status === 'fail' && (row.responseCode == null || row.responseCode < 400)) return false;
      if (!includesKeyword(query.content?.trim(), JSON.stringify(row.queryParams), JSON.stringify(row.requestBody), { caseInsensitive: true })) return false;
      if (!withinDateRange(row.createdAt, query.startTime, query.endTime)) return false;
      if (query.minDurationMs != null && (row.durationMs == null || row.durationMs < query.minDurationMs)) return false;
      if (query.maxDurationMs != null && (row.durationMs == null || row.durationMs > query.maxDurationMs)) return false;
      return true;
    });
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
    // Parse through the summary schema so Demo cannot accidentally expose detail payloads in a list.
    return ok(paginate(list.map((row) => apiAccessLogListItemSchema.parse(row))));
  }),
  mock(apiAccessLogContract.detail, ({ params, ok }) => {
    const row = mockApiAccessLogs.find((item) => item.id === params.id);
    return row ? ok(row) : notFound('API 访问日志不存在或已清理', { status: 404 });
  }),
];

