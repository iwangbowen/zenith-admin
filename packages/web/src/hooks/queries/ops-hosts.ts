import type { HostQueryInput } from '@zenith/shared/ops';
import { opsHostContract } from '@zenith/shared/ops';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

/** 页面持有的主机选择（null = 本机）→ 契约 `hostQuery` 输入 */
export function hostQueryOf(hostId: number | null | undefined): HostQueryInput {
  return hostId == null ? {} : { hostId };
}

/** 主机列表为全量数组（非分页），列表 hook 单独声明；详情 / 保存 / 删除沿用资源工厂 */
const {
  keys: resourceKeys,
  useDetail: useOpsHost,
  useSave: useSaveOpsHost,
  useDelete: useDeleteOpsHosts,
} = createResourceQueries(opsHostContract);

export { useOpsHost, useSaveOpsHost, useDeleteOpsHosts };

export const opsHostKeys = {
  ...resourceKeys,
  list: contractKey(opsHostContract.list),
};

export function useOpsHosts(enabled = true) {
  return useApiQuery(opsHostContract.list, { enabled });
}

/** 测试连接不落库，无需失效任何查询 */
export function useTestOpsHost() {
  return useApiMutation(opsHostContract.test);
}

/** 探测结果回填详情缓存并失效列表（状态 / 快照列变化） */
export function useProbeOpsHost() {
  return useApiMutation(opsHostContract.probe, {
    invalidate: (qc, saved) => {
      qc.setQueryData(opsHostKeys.detail(saved.id), saved);
      void qc.invalidateQueries({ queryKey: opsHostKeys.list });
    },
  });
}

/** 全量探测直接返回探测后的主机列表，回填列表缓存 */
export function useProbeAllOpsHosts() {
  return useApiMutation(opsHostContract.probeAll, {
    invalidate: (qc, list) => {
      qc.setQueryData(opsHostKeys.list, list);
    },
  });
}

export function useResetOpsHostKey() {
  return useApiMutation(opsHostContract.resetHostKey, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: opsHostKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: opsHostKeys.list });
    },
  });
}

export function useImportOpsHost() {
  return useApiMutation(opsHostContract.importSshProfile, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: opsHostKeys.list });
    },
  });
}
