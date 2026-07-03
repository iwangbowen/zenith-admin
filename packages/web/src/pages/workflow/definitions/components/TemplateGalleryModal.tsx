import { useEffect, useState } from 'react';
import { Button, Modal, Spin, Toast, Input, TextArea, Typography } from '@douyinfe/semi-ui';
import { LayoutTemplate, ArrowLeft } from 'lucide-react';
import type { WorkflowTemplate, WorkflowDefinition } from '@zenith/shared';
import { useCloneWorkflowTemplate, useWorkflowTemplates } from '@/hooks/queries/workflow-templates';

interface Props {
  visible: boolean;
  onCancel: () => void;
  categoryId?: number | null;
  /** Called with the new definition's id on successful clone */
  onCreated: (definitionId: number) => void;
}

export function TemplateGalleryModal({ visible, onCancel, categoryId = null, onCreated }: Props) {
  // 参数化步骤：选中模板后填写新流程的名称/描述再创建
  const [picked, setPicked] = useState<WorkflowTemplate | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const templatesQuery = useWorkflowTemplates({ enabled: visible });
  const cloneMutation = useCloneWorkflowTemplate();
  const templates = templatesQuery.data ?? [];
  const loading = templatesQuery.isFetching;
  const creating = cloneMutation.isPending;

  useEffect(() => {
    if (!visible) return;
    setPicked(null);
  }, [visible]);

  const pickTemplate = (tpl: WorkflowTemplate) => {
    setPicked(tpl);
    setName(tpl.name);
    setDescription(tpl.description ?? '');
  };

  const handleCreate = async () => {
    if (!picked) return;
    if (!name.trim()) {
      Toast.warning('请填写流程名称');
      return;
    }
    const res = await cloneMutation.mutateAsync({
      id: picked.id,
      values: { name: name.trim(), description: description.trim() || null, ...(categoryId == null ? {} : { categoryId }) },
    });
    Toast.success('已从模板创建流程');
    onCreated((res as WorkflowDefinition).id);
  };

  return (
    <Modal
      title={picked ? '配置新流程' : '从模板新建流程'}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={760}
      bodyStyle={{ paddingBottom: 24 }}
      closeOnEsc
    >
      {picked ? (
        <div>
          <Button size="small" theme="borderless" icon={<ArrowLeft size={14} />} onClick={() => setPicked(null)} style={{ marginBottom: 12 }}>
            返回模板列表
          </Button>
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            基于模板「{picked.name}」创建，可调整名称与描述后再生成草稿。
          </div>
          <div style={{ marginBottom: 12 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>流程名称</Typography.Text>
            <Input value={name} onChange={setName} maxLength={64} showClear placeholder="请输入新流程名称" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>流程描述</Typography.Text>
            <TextArea value={description} onChange={setDescription} maxCount={512} autosize rows={3} placeholder="可选，简要描述该流程用途" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setPicked(null)}>取消</Button>
            <Button type="primary" theme="solid" loading={creating} onClick={() => void handleCreate()}>创建流程</Button>
          </div>
        </div>
      ) : (
        <Spin spinning={loading}>
          {!loading && templates.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--semi-color-text-2)', padding: '40px 0' }}>
              暂无可用模板
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              maxHeight: 480,
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                style={{
                  border: '1px solid var(--semi-color-border)',
                  borderRadius: 8,
                  padding: '16px 14px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  background: 'var(--semi-color-bg-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  {tpl.color ? (
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: tpl.color,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <LayoutTemplate size={14} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />
                  )}
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tpl.name}
                  </span>
                </div>
                {tpl.categoryName && (
                  <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>
                    {tpl.categoryName}
                  </span>
                )}
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: 'var(--semi-color-text-2)',
                    flex: 1,
                    overflow: 'hidden',
                    maxHeight: 36,
                    lineHeight: '18px',
                  }}
                >
                  {tpl.description || '暂无描述'}
                </p>
                <Button
                  size="small"
                  type="primary"
                  theme="solid"
                  style={{ marginTop: 8, width: '100%' }}
                  onClick={() => pickTemplate(tpl)}
                >
                  使用此模板
                </Button>
              </div>
            ))}
          </div>
        </Spin>
      )}
    </Modal>
  );
}
