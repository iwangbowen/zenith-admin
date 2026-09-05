import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { sshProfileContract, terminalRecordingContract, terminalSessionContract } from '@zenith/shared/ops';
import { api, apiRaw, contractKey, createResourceQueries, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export type TerminalSessionListParams = NonNullable<QueryOf<typeof terminalSessionContract.list>>;
export type TerminalRecordingListParams = NonNullable<QueryOf<typeof terminalRecordingContract.list>>;

// ─── SSH 配置（当前用户；列表为全量数组，非分页） ──────────────────────────────

const {
  keys: sshProfileKeys,
  useSave: useSaveSshProfile,
  useDelete: useDeleteSshProfiles,
} = createResourceQueries(sshProfileContract);

export { useSaveSshProfile, useDeleteSshProfiles };

export function useSshProfiles(enabled = true) {
  return useApiQuery(sshProfileContract.list, { enabled });
}

/** 拖动排序：成对交换 orderNum，逐条更新后统一失效列表 */
export function useUpdateSshProfileOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Array<{ id: number; orderNum: number }>) =>
      Promise.all(updates.map((u) => api(sshProfileContract.update, { params: { id: u.id }, body: { orderNum: u.orderNum } }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: sshProfileKeys.lists }),
  });
}

// ─── 活动会话（管理员监控） ────────────────────────────────────────────────────

const { keys: terminalSessionKeys } = createResourceQueries(terminalSessionContract);

export function useTerminalSessionList(params: TerminalSessionListParams, options?: { refetchInterval?: number | false }) {
  return useApiQuery(terminalSessionContract.list, { query: params }, {
    requestOptions: { silent: true },
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
  });
}

export function useTerminateTerminalSession() {
  return useApiMutation(terminalSessionContract.terminate, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: terminalSessionKeys.lists });
    },
  });
}

// ─── 录屏 ────────────────────────────────────────────────────────────────────

const {
  keys: terminalRecordingKeys,
  useList: useTerminalRecordingList,
  useDetail: useTerminalRecordingDetail,
  useDelete: useDeleteTerminalRecordings,
} = createResourceQueries(terminalRecordingContract);

export { useTerminalRecordingList, useTerminalRecordingDetail, useDeleteTerminalRecordings };

/** 清除录屏：接口只回提示文案（含删除条数），透传给调用方展示 */
export function useCleanTerminalRecordings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (days: number) => {
      const res = await apiRaw(terminalRecordingContract.clean, { query: { days } });
      unwrap(res);
      return res.message;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalRecordingKeys.lists }),
  });
}

export function downloadTerminalRecordingAsciinema(id: number, filename: string) {
  return request.download(urlOf(terminalRecordingContract.asciinema, { params: { id } }), filename);
}

export const terminalKeys = {
  all: ['terminal'] as const,
  sshProfiles: contractKey(sshProfileContract.list),
  sessionLists: terminalSessionKeys.lists,
  sessionList: (params: TerminalSessionListParams) => terminalSessionKeys.list(params),
  recordingLists: terminalRecordingKeys.lists,
  recordingList: (params: TerminalRecordingListParams) => terminalRecordingKeys.list(params),
  recordingDetail: (id: number | undefined) => terminalRecordingKeys.detail(id),
};
