import { useQuery } from '@tanstack/react-query';
import { apiQueryOptions } from '@/lib/contract-query';
import { workflowDefinitionContract, workflowInstanceContract, workflowTaskContract, type WorkflowInstanceStatus } from '@zenith/shared/workflow';
import { approvalRequest } from './approval-request';

const requestOptions = { client: approvalRequest, silent: true } as const;

export function canViewApprovalStatistics(permissions: readonly string[] = []) {
  return permissions.includes('*') || permissions.includes('workflow:instance:monitor');
}

export function useApprovalStatistics(definitionId: number | undefined, enabled: boolean) {
  return useQuery({ ...apiQueryOptions(workflowInstanceContract.analytics, { query: { definitionId } }, { enabled, requestOptions, refetchOnMount: 'always' }), queryKey: ['approval', 'statistics', definitionId] });
}

export function useApprovalStatisticsDefinitions(enabled: boolean) {
  return useQuery({ ...apiQueryOptions(workflowDefinitionContract.all, { enabled, requestOptions, staleTime: 300_000 }), queryKey: ['approval', 'statistics-definitions'] });
}

export type StatisticsDetail = 'overdue' | 'pending' | WorkflowInstanceStatus | 'all';
export function useApprovalStatisticsDetail(kind: StatisticsDetail | null, definitionId: number | undefined, page: number, enabled: boolean) {
  const query = { page, pageSize: 20, definitionId };
  const instances = useQuery({ ...apiQueryOptions(workflowInstanceContract.monitor, { query: { ...query, status: kind && !['overdue', 'pending', 'all'].includes(kind) ? kind as WorkflowInstanceStatus : undefined } }, { enabled: enabled && kind != null && kind !== 'overdue' && kind !== 'pending', requestOptions }), queryKey: ['approval', 'statistics-detail', kind, definitionId, page] });
  const overdue = useQuery({ ...apiQueryOptions(workflowInstanceContract.overdue, { query }, { enabled: enabled && kind === 'overdue', requestOptions }), queryKey: ['approval', 'statistics-overdue', definitionId, page] });
  const tasks = useQuery({ ...apiQueryOptions(workflowTaskContract.taskMonitor, { query: { ...query, status: 'pending' } }, { enabled: enabled && kind === 'pending', requestOptions }), queryKey: ['approval', 'statistics-pending', definitionId, page] });
  const result = kind === 'overdue' ? overdue : kind === 'pending' ? tasks : instances;
  const rows = kind === 'overdue'
    ? overdue.data?.list.map(row => ({ key: row.taskId, id: row.instanceId, title: row.instanceTitle, subtitle: `${row.nodeName} · ${row.assigneeName ?? '未分配'} · ${row.timeoutAt} 到期` }))
    : kind === 'pending'
      ? tasks.data?.list.map(row => ({ key: row.id, id: row.instanceId, title: row.instanceTitle, subtitle: `${row.nodeName} · ${row.assigneeName ?? '未分配'}` }))
      : instances.data?.list.map(row => ({ key: row.id, id: row.id, title: row.title, subtitle: row.definitionName ?? row.createdAt }));
  return { data: result.data, isFetching: result.isFetching, isError: result.isError, error: result.error, refetch: result.refetch, rows: rows ?? [] };
}
