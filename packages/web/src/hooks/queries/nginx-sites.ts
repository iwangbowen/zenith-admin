import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nginxSiteContract } from '@zenith/shared/ops';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const nginxSiteKeys = {
  all: ['nginx-sites'] as const,
  lists: contractKey(nginxSiteContract.list),
  list: () => contractKey(nginxSiteContract.list),
  detail: (name: string | undefined) => contractKey(nginxSiteContract.detail, { params: { name: name ?? '' } }),
};

/** 页面同时需要 Nginx 安装信息与站点清单，合并为一次查询避免两段 loading */
export function useNginxSitesOverview() {
  return useQuery({
    queryKey: nginxSiteKeys.list(),
    queryFn: async () => {
      const [info, sites] = await Promise.all([
        api(nginxSiteContract.info, { silent: true }),
        api(nginxSiteContract.list, { silent: true }),
      ]);
      return { info, sites };
    },
  });
}

export function useNginxSiteDetail(name: string | undefined, enabled = true) {
  return useApiQuery(nginxSiteContract.detail, { params: { name: name ?? '' } }, { enabled: enabled && !!name });
}

export function useCreateNginxSite() {
  return useApiMutation(nginxSiteContract.create, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: nginxSiteKeys.all });
    },
  });
}

export function useUpdateNginxSite() {
  return useApiMutation(nginxSiteContract.update, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: nginxSiteKeys.all });
    },
  });
}

/** 启用 / 禁用 / 删除三条操作按动作择一调用 */
export function useNginxSiteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: 'enable' | 'disable' | 'delete' }) => {
      const op = action === 'delete' ? nginxSiteContract.remove : action === 'enable' ? nginxSiteContract.enable : nginxSiteContract.disable;
      return api(op, { params: { name } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: nginxSiteKeys.all }),
  });
}

/** 配置测试只读，不失效任何查询 */
export function useTestNginxConfig() {
  return useApiMutation(nginxSiteContract.test);
}

export function useReloadNginx() {
  return useApiMutation(nginxSiteContract.reload, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: nginxSiteKeys.all });
    },
  });
}
