/**
 * 用户收藏菜单 hook
 * 在内存中维护有序的收藏菜单 ID 列表，与后端同步。
 */
import { useState, useCallback, useEffect } from 'react';
import { request } from '@/utils/request';

export function useFavoriteMenus() {
  const [favorites, setFavorites] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 从后端加载
  useEffect(() => {
    request.get<number[]>('/api/auth/favorite-menus').then((res) => {
      if (res.code === 0) setFavorites(res.data ?? []);
      setLoaded(true);
    });
  }, []);

  // 保存到后端（防抖延迟 600ms）
  const save = useCallback((ids: number[]) => {
    request.put('/api/auth/favorite-menus', { menuIds: ids }).catch(() => null);
  }, []);

  const isFavorite = useCallback((menuId: number) => favorites.includes(menuId), [favorites]);

  const toggle = useCallback(
    (menuId: number) => {
      setFavorites((prev) => {
        const next = prev.includes(menuId) ? prev.filter((id) => id !== menuId) : [...prev, menuId];
        save(next);
        return next;
      });
    },
    [save],
  );

  const reorder = useCallback(
    (ids: number[]) => {
      setFavorites(ids);
      save(ids);
    },
    [save],
  );

  return { favorites, loaded, isFavorite, toggle, reorder };
}
