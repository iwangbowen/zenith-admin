import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { nginxSiteContract } from '@zenith/shared/ops';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const nginxSiteKeys = {
  lists: contractKey(nginxSiteContract.list),
  /** 安装信息 + 站点清单的合并查询：list 操作前缀下追加区分段，与将来可能出现的纯 list 查询不共键 */
  overview: [...contractKey(nginxSiteContract.list), 'overview'] as const,
  detail: (name: string | undefined) => contractKey(nginxSiteContract.detail, { params: { name: name ?? '' } }),
};

/** 页面同时需要 Nginx 安装信息与站点清单，合并为一次查询避免两段 loading（H5：组合两次契约请求） */
export function useNginxSitesOverview() {
  return useQuery({
    queryKey: nginxSiteKeys.overview,
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

/** 站点配置变化：清单（含启用态 / 概览）与该站点详情（配置文本）都需回源 */
function invalidateSite(qc: QueryClient, name: string) {
  void qc.invalidateQueries({ queryKey: nginxSiteKeys.lists });
  void qc.invalidateQueries({ queryKey: nginxSiteKeys.detail(name) });
}

export function useCreateNginxSite() {
  return useApiMutation(nginxSiteContract.create, {
    // 新站点尚无详情缓存，只需清单回源
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: nginxSiteKeys.lists }),
  });
}

export function useUpdateNginxSite() {
  return useApiMutation(nginxSiteContract.update, {
    invalidate: (qc, _output, { params }) => invalidateSite(qc, params.name),
  });
}

/**
 * H5：启用 / 禁用 / 删除三条操作按动作分派，页面以 `{ name, action }` 一个变量驱动行级忙碌态。
 * 删除后详情缓存移除而非失效（避免对已删站点的 404 重拉）
 */
export function useNginxSiteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: 'enable' | 'disable' | 'delete' }) => {
      const op = action === 'delete' ? nginxSiteContract.remove : action === 'enable' ? nginxSiteContract.enable : nginxSiteContract.disable;
      return api(op, { params: { name } });
    },
    onSuccess: (_data, { name, action }) => {
      if (action === 'delete') {
        qc.removeQueries({ queryKey: nginxSiteKeys.detail(name) });
        void qc.invalidateQueries({ queryKey: nginxSiteKeys.lists });
        return;
      }
      invalidateSite(qc, name);
    },
  });
}

/** 配置测试只读，不失效任何查询 */
export function useTestNginxConfig() {
  return useApiMutation(nginxSiteContract.test);
}

/** 重载后概览里的运行状态可能变化；站点配置文本不变 */
export function useReloadNginx() {
  return useApiMutation(nginxSiteContract.reload, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: nginxSiteKeys.lists }),
  });
}
