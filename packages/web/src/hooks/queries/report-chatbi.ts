import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { reportChatbiContract, type ReportChatbiSessionDetail } from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { reportDatasetKeys } from './report-datasets';
import { reportDashboardKeys } from './report-dashboards';

export type ReportChatbiSessionListParams = NonNullable<QueryOf<typeof reportChatbiContract.sessions>>;
export type ReportChatbiAuditParams = NonNullable<QueryOf<typeof reportChatbiContract.audit>>;

export const reportChatbiKeys = {
  lists: contractKey(reportChatbiContract.sessions),
  list: (params: ReportChatbiSessionListParams) => contractKey(reportChatbiContract.sessions, { query: params }),
  detail: (id: number | undefined) => contractKey(reportChatbiContract.sessionDetail, { params: { id: id ?? 0 } }),
  /** 消息列表由会话详情派生（同一请求），独立缓存供流式追加 */
  messages: (id: number | undefined) => [...contractKey(reportChatbiContract.sessionDetail, { params: { id: id ?? 0 } }), 'messages'] as const,
  quota: contractKey(reportChatbiContract.myQuota),
  audit: (params: ReportChatbiAuditParams) => contractKey(reportChatbiContract.audit, { query: params }),
};

export function useReportChatbiSessionList(params: ReportChatbiSessionListParams) {
  return useApiQuery(reportChatbiContract.sessions, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportChatbiSessionDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportChatbiContract.sessionDetail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    requestOptions: { silent: true },
  });
}

export function useReportChatbiMessages(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportChatbiKeys.messages(id),
    queryFn: () => api(reportChatbiContract.sessionDetail, { params: { id: id ?? 0 } }, { silent: true }).then((detail) => detail.messages),
    enabled: enabled && id !== undefined,
  });
}

export function useReportChatbiQuota(enabled = true) {
  return useApiQuery(reportChatbiContract.myQuota, { enabled, requestOptions: { silent: true } });
}

export function useReportChatbiAudit(params: ReportChatbiAuditParams, enabled = true) {
  return useApiQuery(reportChatbiContract.audit, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useCreateReportChatbiSession() {
  return useApiMutation(reportChatbiContract.createSession, {
    requestOptions: { silent: true },
    invalidate: (qc, session) => {
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.lists });
      qc.setQueryData(reportChatbiKeys.detail(session.id), { session, messages: [] });
    },
  });
}

export function useUpdateReportChatbiSession() {
  return useApiMutation(reportChatbiContract.updateSession, {
    requestOptions: { silent: true },
    invalidate: (qc, session) => {
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.lists });
      qc.setQueryData<ReportChatbiSessionDetail>(
        reportChatbiKeys.detail(session.id),
        (current) => current ? { ...current, session } : current,
      );
    },
  });
}

export function useArchiveReportChatbiSession() {
  return useApiMutation(reportChatbiContract.archiveSession, {
    requestOptions: { silent: true },
    invalidate: (qc, session) => {
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.lists });
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.detail(session.id) });
    },
  });
}

export function useDeleteReportChatbiSession() {
  return useApiMutation(reportChatbiContract.removeSession, {
    requestOptions: { silent: true },
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportChatbiKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.lists });
    },
  });
}

/** 提问可被用户中止（signal 随每次调用传入），成功与失败都要回源会话与用量 */
export function useAskReportChatbi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, values, signal }: {
      sessionId: number;
      values: BodyOf<typeof reportChatbiContract.ask>;
      signal?: AbortSignal;
    }) => api(reportChatbiContract.ask, { params: { id: sessionId }, body: values }, { signal, silent: true }),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: reportChatbiKeys.detail(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: reportChatbiKeys.lists });
      void queryClient.invalidateQueries({ queryKey: reportChatbiKeys.quota });
    },
  });
}

/** 存为数据集 / 看板会新增一条记录，只需刷新对应列表与下拉源 */
export function useSaveReportChatbiMessageAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, values }: {
      messageId: number;
      sessionId: number;
      values: BodyOf<typeof reportChatbiContract.saveMessage>;
    }) => api(reportChatbiContract.saveMessage, { params: { id: messageId }, body: values }, { silent: true }),
    onSuccess: (resource, variables) => {
      void queryClient.invalidateQueries({ queryKey: reportChatbiKeys.detail(variables.sessionId) });
      if (resource.resourceType === 'dataset') {
        void queryClient.invalidateQueries({ queryKey: reportDatasetKeys.lists });
        void queryClient.invalidateQueries({ queryKey: reportDatasetKeys.lookup });
      } else {
        void queryClient.invalidateQueries({ queryKey: reportDashboardKeys.lists });
      }
    },
  });
}
