/**
 * 工作流表单编辑器（可复用）
 * 同时用于：表单库独立设计页 与 流程设计器第二步「内联新建/编辑表单」。
 * 顶部为紧凑工具栏（含撤销/重做），主体内嵌 FormDesigner，支持 PC/移动双预览。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Spin, Toast, Typography, Input, Select, TextArea,
  RadioGroup, Radio, InputNumber, SideSheet, Divider, Tooltip,
} from '@douyinfe/semi-ui';
import { ArrowLeft, X, Eye, Save, Settings, Monitor, Smartphone, Undo2, Redo2, Braces, Copy } from 'lucide-react';
import type { WorkflowForm, WorkflowFormField, WorkflowFormSettings, WorkflowFormStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { LABEL_POSITION_OPTIONS, LABEL_ALIGN_OPTIONS } from '../designer/form-types';
import AppModal from '@/components/AppModal';
import FormDesigner, { type FormHistoryControls } from '../designer/components/FormDesigner';
import WorkflowFormRenderer from '../designer/components/WorkflowFormRenderer';

export interface WorkflowFormInlineEditorProps {
  /** 表单 id；null 表示新建 */
  formId: number | null;
  /** 保存成功回调，返回最新表单实体 */
  onSaved: (form: WorkflowForm) => void;
  /** 返回 / 取消 */
  onBack?: () => void;
  /** 返回按钮文案，默认「返回」 */
  backLabel?: string;
  /** 内嵌模式（流程设计器内联），影响图标与样式 */
  embedded?: boolean;
}

const DEFAULT_SETTINGS: WorkflowFormSettings = { submitButtonText: '提交', labelPosition: 'top' };

export default function WorkflowFormInlineEditor({
  formId,
  onSaved,
  onBack,
  backLabel = '返回',
  embedded = false,
}: Readonly<WorkflowFormInlineEditorProps>) {
  const { categories } = useWorkflowCategories();

  const [loading, setLoading] = useState(formId != null);
  const [saving, setSaving] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [status, setStatus] = useState<WorkflowFormStatus>('enabled');
  const [fields, setFields] = useState<WorkflowFormField[]>([]);
  const [settings, setSettings] = useState<WorkflowFormSettings>(DEFAULT_SETTINGS);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewMode, setPreviewMode] = useState<'pc' | 'mobile'>('pc');
  const [jsonVisible, setJsonVisible] = useState(false);
  const [history, setHistory] = useState<FormHistoryControls | null>(null);

  const handleHistoryChange = useCallback((c: FormHistoryControls) => setHistory(c), []);

  // ─── 加载（仅当外部指定的 formId 与当前已加载不一致时） ───────────────
  useEffect(() => {
    if (formId == null || formId === currentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    request.get<WorkflowForm>(`/api/workflows/forms/${formId}`).then(res => {
      if (res.code === 0 && res.data) {
        setCurrentId(res.data.id);
        setName(res.data.name);
        setCode(res.data.code ?? '');
        setDescription(res.data.description ?? '');
        setCategoryId(res.data.categoryId ?? null);
        setStatus(res.data.status);
        setFields(res.data.schema?.fields ?? []);
        setSettings(res.data.schema?.settings ?? DEFAULT_SETTINGS);
      } else {
        Toast.error('表单不存在或加载失败');
      }
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  // ─── 保存 ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) {
      Toast.warning('请填写表单名称');
      setSettingsVisible(true);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim() || null,
        description: description.trim() || null,
        categoryId,
        status,
        schema: { fields, settings },
      };
      const res = currentId
        ? await request.put<WorkflowForm>(`/api/workflows/forms/${currentId}`, payload)
        : await request.post<WorkflowForm>('/api/workflows/forms', payload);
      if (res.code === 0 && res.data) {
        Toast.success('保存成功');
        setCurrentId(res.data.id);
        onSaved(res.data);
      }
    } finally {
      setSaving(false);
    }
  };

  const updateSettings = (patch: Partial<WorkflowFormSettings>) =>
    setSettings(prev => ({ ...prev, ...patch }));

  // 表单 schema 的 JSON（保存即此结构），供预览/复制
  const schemaJson = useMemo(() => JSON.stringify({ fields, settings }, null, 2), [fields, settings]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(schemaJson);
      Toast.success('已复制 JSON');
    } catch {
      Toast.error('复制失败，请手动选择复制');
    }
  };

  const previewBody = useMemo(() => (
    <div>
      {settings.description && (
        <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--semi-color-fill-0)', borderRadius: 6 }}>
          <Typography.Text type="secondary" size="small">{settings.description}</Typography.Text>
        </div>
      )}
      {fields.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--semi-color-text-2)', padding: '40px 0' }}>暂无表单字段</div>
      ) : (
        <>
          <WorkflowFormRenderer
            fields={fields}
            labelPosition={settings.labelPosition ?? 'top'}
            labelAlign={settings.labelAlign}
            labelWidth={settings.labelWidth}
          />
          <div style={{ marginTop: 16, textAlign: previewMode === 'mobile' ? 'center' : 'right' }}>
            <Button type="primary" theme="solid" disabled block={previewMode === 'mobile'}>
              {settings.submitButtonText || '提交'}
            </Button>
          </div>
        </>
      )}
    </div>
  ), [fields, settings, previewMode]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 240 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 紧凑顶部工具栏 */}
      <div className="wf-form-editor__toolbar">
        {onBack && (
          <Button
            icon={embedded ? <X size={14} /> : <ArrowLeft size={14} />}
            type="tertiary"
            theme="borderless"
            size="small"
            onClick={onBack}
          >
            {backLabel}
          </Button>
        )}
        <Input
          value={name}
          onChange={setName}
          placeholder="未命名表单"
          style={{ width: 220, fontWeight: 600 }}
        />
        <div style={{ flex: 1 }} />

        {/* 撤销 / 重做（接管自 FormDesigner） */}
        <Tooltip content="撤销 (Ctrl+Z)">
          <Button
            icon={<Undo2 size={15} />} type="tertiary" theme="borderless" size="small"
            disabled={!history?.canUndo} onClick={() => history?.undo()} aria-label="撤销"
          />
        </Tooltip>
        <Tooltip content="重做 (Ctrl+Shift+Z)">
          <Button
            icon={<Redo2 size={15} />} type="tertiary" theme="borderless" size="small"
            disabled={!history?.canRedo} onClick={() => history?.redo()} aria-label="重做"
          />
        </Tooltip>
        <Divider layout="vertical" margin="6px" />

        <Button icon={<Settings size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => setSettingsVisible(true)}>表单设置</Button>
        <Button icon={<Braces size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => setJsonVisible(true)}>JSON</Button>
        <Button icon={<Eye size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => setPreviewVisible(true)}>预览</Button>
        <Button icon={<Save size={14} />} type="primary" size="small" loading={saving} onClick={() => void handleSave()}>保存</Button>
      </div>

      {/* 字段设计器 */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <FormDesigner fields={fields} onChange={setFields} showToolbar={false} onHistoryChange={handleHistoryChange} />
      </div>

      {/* 表单设置抽屉 */}
      <SideSheet
        title="表单设置"
        visible={settingsVisible}
        onCancel={() => setSettingsVisible(false)}
        width={380}
        closeOnEsc
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <Typography.Text strong size="small">表单名称</Typography.Text>
            <Input value={name} onChange={setName} placeholder="请输入表单名称" style={{ marginTop: 4 }} />
          </div>
          <div>
            <Typography.Text strong size="small">表单标识</Typography.Text>
            <Input value={code} onChange={setCode} placeholder="唯一英文标识（选填）" style={{ marginTop: 4 }} />
          </div>
          <div>
            <Typography.Text strong size="small">分类</Typography.Text>
            <Select
              value={categoryId ?? undefined}
              onChange={(v) => setCategoryId((v as number) ?? null)}
              placeholder="请选择分类（选填）"
              style={{ width: '100%', marginTop: 4 }}
              showClear
              optionList={categories.map(c => ({ value: c.id, label: c.name }))}
            />
          </div>
          <div>
            <Typography.Text strong size="small">状态</Typography.Text>
            <div style={{ marginTop: 4 }}>
              <RadioGroup type="button" value={status} onChange={(e) => setStatus(e.target.value as WorkflowFormStatus)}>
                <Radio value="enabled">启用</Radio>
                <Radio value="disabled">停用</Radio>
              </RadioGroup>
            </div>
          </div>
          <div>
            <Typography.Text strong size="small">表单说明</Typography.Text>
            <TextArea
              value={description}
              onChange={setDescription}
              placeholder="用于表单库列表展示的描述（选填）"
              rows={2}
              style={{ marginTop: 4 }}
            />
          </div>

          <Divider margin="4px" />
          <Typography.Text strong>渲染设置</Typography.Text>

          <div>
            <Typography.Text strong size="small">顶部提示文字</Typography.Text>
            <TextArea
              value={settings.description ?? ''}
              onChange={(v) => updateSettings({ description: v || undefined })}
              placeholder="显示在表单顶部的提示说明（选填）"
              rows={2}
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Typography.Text strong size="small">提交按钮文案</Typography.Text>
            <Input
              value={settings.submitButtonText ?? ''}
              onChange={(v) => updateSettings({ submitButtonText: v || undefined })}
              placeholder="默认：提交"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Typography.Text strong size="small">标签位置</Typography.Text>
            <div style={{ marginTop: 4 }}>
              <RadioGroup
                type="button"
                value={settings.labelPosition ?? 'top'}
                onChange={(e) => updateSettings({ labelPosition: e.target.value as 'top' | 'left' | 'inset' })}
              >
                {LABEL_POSITION_OPTIONS.map(o => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}
              </RadioGroup>
            </div>
          </div>
          <div>
            <Typography.Text strong size="small">标签对齐</Typography.Text>
            <div style={{ marginTop: 4 }}>
              <RadioGroup
                type="button"
                value={settings.labelAlign ?? 'left'}
                onChange={(e) => updateSettings({ labelAlign: e.target.value as 'left' | 'right' })}
              >
                {LABEL_ALIGN_OPTIONS.map(o => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}
              </RadioGroup>
            </div>
          </div>
          {(settings.labelPosition === 'left' || settings.labelPosition === 'inset') && (
            <div>
              <Typography.Text strong size="small">标签宽度</Typography.Text>
              <InputNumber
                value={settings.labelWidth ?? 96}
                onChange={(v) => updateSettings({ labelWidth: Number(v) || undefined })}
                min={60}
                max={300}
                suffix="px"
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>
          )}
        </div>
      </SideSheet>

      {/* 预览弹窗 */}
      <AppModal
        title={(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
            <span>表单预览</span>
            <RadioGroup type="button" value={previewMode} onChange={(e) => setPreviewMode(e.target.value as 'pc' | 'mobile')}>
              <Radio value="pc"><Monitor size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />PC</Radio>
              <Radio value="mobile"><Smartphone size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />移动</Radio>
            </RadioGroup>
          </div>
        )}
        visible={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={<Button type="primary" onClick={() => setPreviewVisible(false)}>关闭</Button>}
        width={previewMode === 'mobile' ? 460 : 640}
        bodyStyle={{ maxHeight: '70vh', overflowY: 'auto', background: previewMode === 'mobile' ? 'var(--semi-color-fill-0)' : undefined }}
      >
        {previewMode === 'mobile' ? (
          <div style={{
            width: 375,
            margin: '12px auto',
            padding: '16px 14px',
            background: 'var(--semi-color-bg-1)',
            border: '1px solid var(--semi-color-border)',
            borderRadius: 20,
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          }}>
            {previewBody}
          </div>
        ) : (
          <div style={{ padding: '4px 8px' }}>{previewBody}</div>
        )}
      </AppModal>

      {/* JSON 预览弹窗 */}
      <AppModal
        title={(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
            <span>表单 JSON</span>
            <Button icon={<Copy size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => void copyJson()}>复制</Button>
          </div>
        )}
        visible={jsonVisible}
        onCancel={() => setJsonVisible(false)}
        footer={<Button type="primary" onClick={() => setJsonVisible(false)}>关闭</Button>}
        width={640}
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
      >
        <Typography.Paragraph type="tertiary" size="small" style={{ marginBottom: 8 }}>
          表单保存为以下 JSON 结构（schema），可用于排查与外部对接。
        </Typography.Paragraph>
        <pre style={{
          margin: 0,
          padding: 12,
          background: 'var(--semi-color-fill-0)',
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.6,
          fontFamily: 'var(--semi-font-family-mono, monospace)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>{schemaJson}</pre>
      </AppModal>
    </div>
  );
}
