import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, InputOf, QueryOf } from '@zenith/shared/core';
import { reportChatbiContract, type ReportChatbiSessionDetail } from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { reportDatasetKeys } from './report-datasets';
import { reportDashboardKeys } from './report-dashboards';

export type ReportChatbiSessionListParams = NonNullable<QueryOf<typeof reportChatbiContract.sessions>>;
export type ReportChatbiAuditParams = NonNullable<QueryOf<typeof reportChatbiContract.audit>>;

const silent = { silent: true } as const;

export const reportChatbiKeys = {
  lists: contractKey(reportChatbiContract.sessions),
  list: (params: ReportChatbiSessionListParams) => contractKey(reportChatbiContract.sessions, { query: params }),
  detail: (id: number | undefined) => contractKey(reportChatbiContract.sessionDetail, { params: { id: id ?? 0 } }),
  quota: contractKey(reportChatbiContract.myQuota),
  audit: (params: ReportChatbiAuditParams) => contractKey(reportChatbiContract.audit, { query: params }),
};

export function useReportChatbiSessionList(params: ReportChatbiSessionListParams) {
  return useApiQuery(reportChatbiContract.sessions, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportChatbiSessionDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportChatbiContract.sessionDetail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    requestOptions: silent,
  });
}

/** 消息列表是会话详情的投影：与详情共用同一缓存条目（同一请求），只在 select 里取 messages */
export function useReportChatbiMessages(id: number | undefined, enabled = true) {
  return useApiQuery(reportChatbiContract.sessionDetail, { params: { id: id ?? 0 } }, {
    select: (detail) => detail.messages,
    enabled: enabled && id !== undefined,
    requestOptions: silent,
  });
}

export function useReportChatbiQuota(enabled = true) {
  return useApiQuery(reportChatbiContract.myQuota, { enabled, requestOptions: silent });
}

export function useReportChatbiAudit(params: ReportChatbiAuditParams, enabled = true) {
  return useApiQuery(reportChatbiContract.audit, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useCreateReportChatbiSession() {
  return useApiMutation(reportChatbiContract.createSession, {
    requestOptions: silent,
    invalidate: (qc, session) => {
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.lists });
      qc.setQueryData(reportChatbiKeys.detail(session.id), { session, messages: [] });
    },
  });
}

export function useUpdateReportChatbiSession() {
  return useApiMutation(reportChatbiContract.updateSession, {
    requestOptions: silent,
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
    requestOptions: silent,
    invalidate: (qc, session) => {
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.lists });
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.detail(session.id) });
    },
  });
}

export function useDeleteReportChatbiSession() {
  return useApiMutation(reportChatbiContract.removeSession, {
    requestOptions: silent,
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportChatbiKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: reportChatbiKeys.lists });
    },
  });
}

/**
 * H5 保留：提问可被用户中止，AbortSignal 随每次调用传入（requestOptions 是静态选项，装不下按次 signal）；
 * 成功与失败都要回源会话与用量。
 */
export function useAskReportChatbi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, values, signal }: {
      sessionId: number;
      values: BodyOf<typeof reportChatbiContract.ask>;
      signal?: AbortSignal;
    }) => api(reportChatbiContract.ask, { params: { id: sessionId }, body: values }, { ...silent, signal }),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: reportChatbiKeys.detail(variables.sessionId) });
      void queryClient.invalidateQueries({ queryKey: reportChatbiKeys.lists });
      void queryClient.invalidateQueries({ queryKey: reportChatbiKeys.quota });
    },
  });
}

/**
 * 存为数据集 / 看板会新增一条记录，只需刷新对应列表与下拉源；消息所属会话的详情（savedDatasetId / savedDashboardId）回源。
 * 路径里只有消息 id，会话 id 由调用方随变量带入（只交给 invalidate，不参与请求）。
 */
export function useSaveReportChatbiMessageAsset() {
  return useApiMutation<typeof reportChatbiContract.saveMessage, InputOf<typeof reportChatbiContract.saveMessage> & { sessionId: number }>(
    reportChatbiContract.saveMessage,
    {
      requestOptions: silent,
      invalidate: (qc, resource, { sessionId }) => {
        void qc.invalidateQueries({ queryKey: reportChatbiKeys.detail(sessionId) });
        if (resource.resourceType === 'dataset') {
          void qc.invalidateQueries({ queryKey: reportDatasetKeys.lists });
          void qc.invalidateQueries({ queryKey: reportDatasetKeys.lookup });
        } else {
          void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
        }
      },
    },
  );
}
