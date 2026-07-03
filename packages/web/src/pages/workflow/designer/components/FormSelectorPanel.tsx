/**
 * 流程设计器 · 第二步「表单」— 从表单库选择已设计的表单
 * 下拉选择 + 刷新 + 只读预览；新建/编辑表单时在下方内联展示表单设计器（不再新开页面）。
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Select, Typography, Empty, Spin } from '@douyinfe/semi-ui';
import { Plus, RefreshCw, Pencil } from 'lucide-react';
import { IllustrationNoContent, IllustrationNoContentDark } from '@douyinfe/semi-illustrations';
import type { WorkflowForm } from '@zenith/shared';
import WorkflowFormRenderer from './WorkflowFormRenderer';
import WorkflowFormInlineEditor from '../../forms/WorkflowFormInlineEditor';
import { useWorkflowDesignerFormOptions, workflowDesignerKeys } from '@/hooks/queries/workflow-designer';

interface FormSelectorPanelProps {
  formId: number | null;
  /** 已绑定表单的名称（用于绑定表单已停用、不在启用列表时回显） */
  formName?: string | null;
  onSelect: (form: WorkflowForm | null) => void;
}

export default function FormSelectorPanel({ formId, formName, onSelect }: Readonly<FormSelectorPanelProps>) {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFormId, setEditorFormId] = useState<number | null>(null);
  const formsQuery = useWorkflowDesignerFormOptions(formId);
  const forms = formsQuery.data ?? [];
  const loading = formsQuery.isFetching;

  const selected = forms.find(f => f.id === formId) ?? null;
  const fields = selected?.schema?.fields ?? [];

  const handleSelect = (value: unknown) => {
    const next = forms.find(f => f.id === value) ?? null;
    onSelect(next);
  };

  const openEditor = (id: number | null) => {
    setEditorFormId(id);
    setEditorOpen(true);
  };

  // 内联设计器保存成功：刷新列表并自动选中
  const handleSaved = (form: WorkflowForm) => {
    setEditorOpen(false);
    void queryClient.invalidateQueries({ queryKey: workflowDesignerKeys.formOptions(formId) });
    onSelect(form);
  };

  return (
    <div className="fd-form-selector">
      <div className="fd-form-selector__bar">
        <div className="fd-form-selector__bar-left">
          <Typography.Text strong>选择表单</Typography.Text>
          <Select
            value={formId ?? undefined}
            onChange={handleSelect}
            placeholder="请选择已设计的表单"
            style={{ width: 320 }}
            loading={loading}
            disabled={editorOpen}
            filter
            showClear
            emptyContent={<Typography.Text type="tertiary">暂无启用的表单，请先新建</Typography.Text>}
            optionList={forms.map(f => ({
              value: f.id,
              label: f.status === 'disabled' ? `${f.name}（已停用）` : f.name,
            }))}
          />
          {formId && !selected && formName && (
            <Typography.Text type="warning" size="small">当前绑定：{formName}</Typography.Text>
          )}
        </div>
        <div className="fd-form-selector__bar-right">
          <Button icon={<RefreshCw size={14} />} type="tertiary" theme="borderless" disabled={editorOpen} onClick={() => void formsQuery.refetch()}>
            刷新
          </Button>
          {selected && (
            <Button icon={<Pencil size={14} />} type="tertiary" theme="borderless" disabled={editorOpen} onClick={() => openEditor(selected.id)}>
              编辑此表单
            </Button>
          )}
          <Button icon={<Plus size={14} />} type="primary" disabled={editorOpen} onClick={() => openEditor(null)}>
            新建表单
          </Button>
        </div>
      </div>

      {editorOpen ? (
        <div
          style={{
            flex: 1,
            minHeight: 520,
            border: '1px solid var(--semi-color-border)',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--semi-color-bg-1)',
          }}
        >
          <WorkflowFormInlineEditor
            key={editorFormId ?? 'new'}
            embedded
            formId={editorFormId}
            backLabel="取消"
            onBack={() => setEditorOpen(false)}
            onSaved={handleSaved}
          />
        </div>
      ) : (
        <div className="fd-form-selector__preview">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><Spin /></div>
          ) : !selected ? (
            <Empty
              image={<IllustrationNoContent style={{ width: 140, height: 140 }} />}
              darkModeImage={<IllustrationNoContentDark style={{ width: 140, height: 140 }} />}
              title="未选择表单"
              description="从上方下拉选择一个已设计的表单，或点击「新建表单」在下方创建"
              style={{ padding: '48px 0' }}
            />
          ) : fields.length === 0 ? (
            <Empty
              image={<IllustrationNoContent style={{ width: 140, height: 140 }} />}
              darkModeImage={<IllustrationNoContentDark style={{ width: 140, height: 140 }} />}
              title="该表单暂无字段"
              description="点击「编辑此表单」为该表单添加字段"
              style={{ padding: '48px 0' }}
            />
          ) : (
            <div className="fd-form-selector__preview-card">
              <div className="fd-form-selector__preview-title">
                <Typography.Text strong>{selected.name}</Typography.Text>
                <Typography.Text type="tertiary" size="small">表单预览（只读）</Typography.Text>
              </div>
              <WorkflowFormRenderer
                fields={fields}
                readOnly
                labelPosition={selected.schema?.settings?.labelPosition ?? 'top'}
                labelAlign={selected.schema?.settings?.labelAlign}
                labelWidth={selected.schema?.settings?.labelWidth}
                style={{ padding: '8px 4px' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
