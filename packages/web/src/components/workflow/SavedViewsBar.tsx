import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Space, Tag, Toast } from '@douyinfe/semi-ui';
import { Bookmark } from 'lucide-react';
import type { WorkflowSavedView } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import AppModal from '@/components/AppModal';

/**
 * 列表保存视图条（T1-3）。用于在列表页保存/应用/删除命名筛选条件。
 * - pageKey：区分不同列表页的视图命名空间
 * - currentFilters：当前筛选条件（保存时写入）
 * - onApply：点击某个视图时回调，由页面据此回填筛选并查询
 */
export default function SavedViewsBar({
  pageKey,
  currentFilters,
  onApply,
}: Readonly<{
  pageKey: string;
  currentFilters: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
}>) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [saveVisible, setSaveVisible] = useState(false);
  const [name, setName] = useState('');

  const savedViewsQuery = useQuery({
    queryKey: ['workflow', 'saved-views', pageKey],
    queryFn: () => request.get<WorkflowSavedView[]>(`/api/workflows/saved-views?pageKey=${encodeURIComponent(pageKey)}`).then(unwrap),
    staleTime: 30_000,
  });

  const invalidateSavedViews = () => queryClient.invalidateQueries({ queryKey: ['workflow', 'saved-views'] });
  const saveMutation = useMutation({
    mutationFn: (payload: { pageKey: string; name: string; filters: Record<string, unknown> }) =>
      request.post<WorkflowSavedView>('/api/workflows/saved-views', payload).then(unwrap),
    onSuccess: () => { void invalidateSavedViews(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => request.delete(`/api/workflows/saved-views/${id}`).then(unwrap),
    onSuccess: () => { void invalidateSavedViews(); },
  });

  const views = savedViewsQuery.data ?? [];

  const handleSave = async () => {
    if (!name.trim()) { Toast.warning('请输入视图名称'); return; }
    await saveMutation.mutateAsync({ pageKey, name: name.trim(), filters: currentFilters });
    Toast.success('已保存视图');
    setSaveVisible(false);
    setName('');
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
    if (activeId === id) setActiveId(null);
  };

  return (
    <Space wrap spacing={6} style={{ marginBottom: 8 }}>
      <Tag
        color={activeId === null ? 'blue' : 'grey'}
        style={{ cursor: 'pointer' }}
        onClick={() => { setActiveId(null); onApply({}); }}
      >
        全部
      </Tag>
      {views.map((v) => (
        <Tag
          key={v.id}
          color={activeId === v.id ? 'blue' : 'grey'}
          closable
          onClose={() => void handleDelete(v.id)}
          style={{ cursor: 'pointer' }}
          onClick={() => { setActiveId(v.id); onApply(v.filters ?? {}); }}
        >
          {v.name}
        </Tag>
      ))}
      <Button size="small" theme="borderless" icon={<Bookmark size={13} />} onClick={() => { setName(''); setSaveVisible(true); }}>
        保存当前为视图
      </Button>
      <AppModal
        title="保存筛选视图"
        visible={saveVisible}
        onCancel={() => setSaveVisible(false)}
        onOk={() => void handleSave()}
        okButtonProps={{ loading: saveMutation.isPending }}
        closeOnEsc
        width={420}
      >
        <Input value={name} onChange={setName} placeholder="视图名称（最多 64 字）" maxLength={64} showClear />
      </AppModal>
    </Space>
  );
}
