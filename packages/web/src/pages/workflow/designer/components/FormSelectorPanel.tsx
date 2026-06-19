/**
 * 流程设计器 · 第二步「表单」— 从表单库选择已设计的表单
 * 下拉选择 + 刷新 + 只读预览；新建/编辑表单时在下方内联展示表单设计器（不再新开页面）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Select, Typography, Empty, Spin } from '@douyinfe/semi-ui';
import { Plus, RefreshCw, Pencil } from 'lucide-react';
import { IllustrationNoContent, IllustrationNoContentDark } from '@douyinfe/semi-illustrations';
import type { WorkflowForm } from '@zenith/shared';
import { request } from '@/utils/request';
import WorkflowFormRenderer from './WorkflowFormRenderer';
import WorkflowFormInlineEditor from '../../forms/WorkflowFormInlineEditor';

interface FormSelectorPanelProps {
  formId: number | null;
  /** 已绑定表单的名称（用于绑定表单已停用、不在启用列表时回显） */
  formName?: string | null;
  onSelect: (form: WorkflowForm | null) => void;
}

export default function FormSelectorPanel({ formId, formName, onSelect }: Readonly<FormSelectorPanelProps>) {
  const [forms, setForms] = useState<WorkflowForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFormId, setEditorFormId] = useState<number | null>(null);

  const loadForms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<WorkflowForm[]>('/api/workflows/forms/enabled');
      let list = res.code === 0 && Array.isArray(res.data) ? res.data : [];
      // 绑定的表单若已停用，不在启用列表中，单独拉取补全以便回显与预览
      if (formId && !list.some(f => f.id === formId)) {
        const detail = await request.get<WorkflowForm>(`/api/workflows/forms/${formId}`, { silent: true });
        if (detail.code === 0 && detail.data) list = [detail.data, ...list];
      }
      setForms(list);
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

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
    void loadForms();
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
          <Button icon={<RefreshCw size={14} />} type="tertiary" theme="borderless" disabled={editorOpen} onClick={() => void loadForms()}>
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
