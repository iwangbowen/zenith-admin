import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Space, Tag, Toast } from '@douyinfe/semi-ui';
import { Bookmark } from 'lucide-react';
import type { WorkflowSavedView } from '@zenith/shared';
import { request } from '@/utils/request';
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
  const [views, setViews] = useState<WorkflowSavedView[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [saveVisible, setSaveVisible] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await request.get<WorkflowSavedView[]>(`/api/workflows/saved-views?pageKey=${encodeURIComponent(pageKey)}`);
    if (res.code === 0) setViews(res.data ?? []);
  }, [pageKey]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!name.trim()) { Toast.warning('请输入视图名称'); return; }
    setSaving(true);
    try {
      const res = await request.post('/api/workflows/saved-views', { pageKey, name: name.trim(), filters: currentFilters });
      if (res.code === 0) { Toast.success('已保存视图'); setSaveVisible(false); setName(''); await load(); }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/workflows/saved-views/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      if (activeId === id) setActiveId(null);
      await load();
    }
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
        okButtonProps={{ loading: saving }}
        closeOnEsc
        width={420}
      >
        <Input value={name} onChange={setName} placeholder="视图名称（最多 64 字）" maxLength={64} showClear />
      </AppModal>
    </Space>
  );
}
