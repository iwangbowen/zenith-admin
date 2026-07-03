import { useCallback, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppModal } from '@/components/AppModal';
import { Button, Input, Popconfirm, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { Plus } from 'lucide-react';
import type { WorkflowQuickPhrase } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

const quickPhraseKeys = {
  all: ['workflow', 'quick-phrases'] as const,
};

export function useQuickPhrases(): {
  quickPhrases: WorkflowQuickPhrase[];
  reload: () => Promise<void>;
  renderPhraseBar: (onPick: (text: string) => void) => ReactNode;
  phraseManageModal: ReactNode;
} {
  const queryClient = useQueryClient();
  const [phraseManageVisible, setPhraseManageVisible] = useState(false);
  const [newPhrase, setNewPhrase] = useState('');
  const [editingPhraseId, setEditingPhraseId] = useState<number | null>(null);
  const [editingPhraseContent, setEditingPhraseContent] = useState('');
  const quickPhrasesQuery = useQuery({
    queryKey: quickPhraseKeys.all,
    queryFn: () => request.get<WorkflowQuickPhrase[]>('/api/workflows/quick-phrases').then(unwrap),
  });
  const { data: quickPhraseData, refetch: refetchQuickPhrases } = quickPhrasesQuery;
  const quickPhrases = quickPhraseData ?? [];

  const reload = useCallback(async () => {
    await refetchQuickPhrases();
  }, [refetchQuickPhrases]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: quickPhraseKeys.all });
  }, [queryClient]);

  const addPhraseMutation = useMutation({
    mutationFn: (content: string) => request.post('/api/workflows/quick-phrases', { content }).then(unwrap),
    onSuccess: invalidate,
  });
  const deletePhraseMutation = useMutation({
    mutationFn: (id: number) => request.delete(`/api/workflows/quick-phrases/${id}`).then(unwrap),
    onSuccess: invalidate,
  });
  const updatePhraseMutation = useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      request.put(`/api/workflows/quick-phrases/${id}`, { content }).then(unwrap),
    onSuccess: invalidate,
  });

  const handleAddPhrase = async () => {
    const text = newPhrase.trim();
    if (!text) return;
    await addPhraseMutation.mutateAsync(text);
    setNewPhrase('');
  };

  const handleDeletePhrase = async (id: number) => {
    await deletePhraseMutation.mutateAsync(id);
  };

  const startEditPhrase = (p: WorkflowQuickPhrase) => {
    setEditingPhraseId(p.id);
    setEditingPhraseContent(p.content);
  };

  const cancelEditPhrase = () => {
    setEditingPhraseId(null);
    setEditingPhraseContent('');
  };

  const handleUpdatePhrase = async (id: number) => {
    const text = editingPhraseContent.trim();
    if (!text) return;
    await updatePhraseMutation.mutateAsync({ id, content: text });
    cancelEditPhrase();
  };

  const renderPhraseBar = (onPick: (text: string) => void) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
      {quickPhrases.map((p) => (
        <Tag key={p.id} color="white" style={{ cursor: 'pointer', border: '1px solid var(--semi-color-border)' }} onClick={() => onPick(p.content)}>
          {p.content}
        </Tag>
      ))}
      <Button theme="borderless" size="small" onClick={() => setPhraseManageVisible(true)}>管理常用语</Button>
    </div>
  );

  const phraseManageModal = (
    <AppModal
      title="管理审批常用语"
      visible={phraseManageVisible}
      onCancel={() => { setPhraseManageVisible(false); cancelEditPhrase(); }}
      footer={null}
      style={{ width: 480 }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input
          value={newPhrase}
          onChange={setNewPhrase}
          placeholder="输入新的常用语"
          onEnterPress={() => void handleAddPhrase()}
          maxLength={255}
          showClear
        />
        <Button type="primary" icon={<Plus size={14} />} onClick={() => void handleAddPhrase()}>新增</Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflow: 'auto' }}>
        {quickPhrases.length === 0 && <Typography.Text type="tertiary">暂无常用语，添加后可在审批时一键填入。</Typography.Text>}
        {quickPhrases.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
            {editingPhraseId === p.id ? (
              <>
                <Input
                  value={editingPhraseContent}
                  onChange={setEditingPhraseContent}
                  onEnterPress={() => void handleUpdatePhrase(p.id)}
                  maxLength={255}
                  showClear
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Space spacing={4}>
                  <Button theme="borderless" type="primary" size="small" onClick={() => void handleUpdatePhrase(p.id)}>保存</Button>
                  <Button theme="borderless" size="small" onClick={cancelEditPhrase}>取消</Button>
                </Space>
              </>
            ) : (
              <>
                <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>{p.content}</Typography.Text>
                {p.userId === null
                  ? <Tag size="small" color="grey">系统预置</Tag>
                  : (
                    <Space spacing={4}>
                      <Button theme="borderless" size="small" onClick={() => startEditPhrase(p)}>编辑</Button>
                      <Popconfirm title="删除该常用语？" onConfirm={() => void handleDeletePhrase(p.id)}>
                        <Button theme="borderless" type="danger" size="small">删除</Button>
                      </Popconfirm>
                    </Space>
                  )}
              </>
            )}
          </div>
        ))}
      </div>
    </AppModal>
  );

  return { quickPhrases, reload, renderPhraseBar, phraseManageModal };
}
