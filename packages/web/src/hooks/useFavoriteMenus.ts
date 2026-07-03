/**
 * 用户收藏菜单 hook
 * 在内存中维护有序的收藏菜单 ID 列表，与后端同步。
 */
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

const favoriteMenuKeys = {
  all: ['auth', 'favorite-menus'] as const,
};

export function useFavoriteMenus() {
  const queryClient = useQueryClient();
  const favoritesQuery = useQuery({
    queryKey: favoriteMenuKeys.all,
    queryFn: () => request.get<number[]>('/api/auth/favorite-menus').then(unwrap),
  });
  const favorites = useMemo(() => favoritesQuery.data ?? [], [favoritesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (ids: number[]) => request.put('/api/auth/favorite-menus', { menuIds: ids }).then(unwrap),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: favoriteMenuKeys.all }),
  });
  const { mutate: saveFavoriteMenus } = saveMutation;

  const isFavorite = useCallback((menuId: number) => favorites.includes(menuId), [favorites]);

  const save = useCallback((ids: number[]) => {
    queryClient.setQueryData(favoriteMenuKeys.all, ids);
    saveFavoriteMenus(ids);
  }, [queryClient, saveFavoriteMenus]);

  const toggle = useCallback(
    (menuId: number) => {
      const next = favorites.includes(menuId) ? favorites.filter((id) => id !== menuId) : [...favorites, menuId];
      save(next);
    },
    [favorites, save],
  );

  const reorder = useCallback(
    (ids: number[]) => {
      save(ids);
    },
    [save],
  );

  return { favorites, loaded: !favoritesQuery.isLoading, isFavorite, toggle, reorder };
}
