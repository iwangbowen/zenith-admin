import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpConditionalMenu, MpMenu, MpMenuButton, MpMenuMatchRule } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export const mpMenuKeys = {
  all: ['mp', 'menu'] as const,
  detail: (accountId: number | null | undefined) => ['mp', 'menu', accountId, 'detail'] as const,
  conditionalAll: ['mp', 'conditional-menus'] as const,
  conditionalLists: (accountId: number | null | undefined) => ['mp', 'conditional-menus', accountId, 'list'] as const,
  conditionalList: (accountId: number | null | undefined) => ['mp', 'conditional-menus', accountId, 'list', { accountId }] as const,
};

export function useMpMenu(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpMenuKeys.detail(accountId),
    queryFn: () => request.get<MpMenu>(`/api/mp/menu${toQueryString({ accountId })}`).then(unwrap),
    enabled: !!accountId,
  });
}

export function useSaveMpMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, buttons }: { accountId: number; buttons: MpMenuButton[] }) =>
      request.post<MpMenu>('/api/mp/menu/save', { accountId, buttons }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMenuKeys.all }),
  });
}

export function usePublishMpMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, buttons }: { accountId: number; buttons: MpMenuButton[] }) => {
      await request.post<MpMenu>('/api/mp/menu/save', { accountId, buttons }).then(unwrap);
      return request.post<MpMenu>('/api/mp/menu/publish', { accountId }).then(unwrap);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMenuKeys.all }),
  });
}

export function usePullMpMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => request.post<MpMenu>('/api/mp/menu/pull', { accountId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMenuKeys.all }),
  });
}

export function useDeleteMpMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => request.post<MpMenu>('/api/mp/menu/delete', { accountId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMenuKeys.all }),
  });
}

export function useMpConditionalMenus(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpMenuKeys.conditionalList(accountId),
    queryFn: () => request.get<MpConditionalMenu[]>(`/api/mp/conditional-menus${toQueryString({ accountId })}`).then(unwrap),
    enabled: !!accountId,
  });
}

export function useSaveMpConditionalMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountId, name, buttons, matchRule }: { id?: number; accountId: number; name: unknown; buttons: MpMenuButton[]; matchRule: MpMenuMatchRule }) =>
      (id === undefined
        ? request.post<MpConditionalMenu>('/api/mp/conditional-menus', { accountId, name, buttons, matchRule })
        : request.put<MpConditionalMenu>(`/api/mp/conditional-menus/${id}`, { name, buttons, matchRule })
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMenuKeys.conditionalAll }),
  });
}

export function usePublishMpConditionalMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<MpConditionalMenu>(`/api/mp/conditional-menus/${id}/publish`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMenuKeys.conditionalAll }),
  });
}

export function useDeleteMpConditionalMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/conditional-menus/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMenuKeys.conditionalAll }),
  });
}

export function useTryMatchMpConditionalMenu() {
  return useMutation({
    mutationFn: ({ accountId, userId }: { accountId: number; userId: string }) =>
      request.post<{ buttons: MpMenuButton[] }>('/api/mp/conditional-menus/trymatch', { accountId, userId }).then(unwrap),
  });
}
