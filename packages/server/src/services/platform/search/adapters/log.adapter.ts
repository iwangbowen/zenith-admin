import { hasPermission } from '../../../../lib/context';
import { listOperationLogs } from '../../operation-logs.service';
import { listExceptionGroups } from '../../exception-logs.service';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

export const operationLogSearchAdapter: GlobalSearchAdapter = {
  type: 'operation-log',
  permissions: ['system:log:operation'],
  async search({ q, limit }) {
    if (!(await hasPermission('system:log:operation'))) return [];
    const page = await listOperationLogs({ page: 1, pageSize: limit, description: q });
    return page.list.map((log) => result({
      type: 'operation-log',
      id: String(log.id),
      title: log.description,
      subtitle: [log.module, log.method, log.path].filter(Boolean).join(' · '),
      description: `${log.responseCode} · ${log.createdAt}`,
      icon: 'ScrollText',
      route: `/system/operation-logs?description=${encodeURIComponent(q)}`,
      highlights: [{ field: 'title', text: log.description }],
    }));
  },
};

export const exceptionLogSearchAdapter: GlobalSearchAdapter = {
  type: 'exception-log',
  permissions: ['system:exception-log:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('system:exception-log:list'))) return [];
    const page = await listExceptionGroups({ page: 1, pageSize: limit, keyword: q });
    return page.list.map((group) => result({
      type: 'exception-log',
      id: String(group.id),
      title: group.message,
      subtitle: [group.errorType, group.level].filter(Boolean).join(' · '),
      description: group.status,
      icon: 'TriangleAlert',
      route: `/system/exception-logs?issue=${group.id}`,
      highlights: [{ field: 'title', text: group.message }],
    }));
  },
};
