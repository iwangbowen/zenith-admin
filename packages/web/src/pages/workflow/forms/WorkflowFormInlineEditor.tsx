/**
 * 工作流表单编辑器（可复用）
 * 同时用于：表单库独立设计页 与 流程设计器第二步「内联新建/编辑表单」。
 * 顶部为紧凑工具栏（含撤销/重做），主体内嵌 FormDesigner，支持 PC/移动双预览。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Spin, Toast, Typography, Input, Select, TextArea,
  RadioGroup, Radio, InputNumber, SideSheet, Divider, Tooltip, Dropdown, Banner, Switch,
} from '@douyinfe/semi-ui';
import { ArrowLeft, X, Eye, Save, Settings, Monitor, Smartphone, Undo2, Redo2, Braces, Copy, Stethoscope, LayoutTemplate, SlidersHorizontal, AlertTriangle, CircleAlert, Share2 } from 'lucide-react';
import type { WorkflowForm, WorkflowFormField, WorkflowFormFieldType, WorkflowFormSettings, WorkflowFormStatus } from '@zenith/shared';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { LABEL_POSITION_OPTIONS, LABEL_ALIGN_OPTIONS, COLUMN_SPAN_OPTIONS } from '../designer/form-types';
import { validateFormSchema, countErrors, type FormIssue } from '../designer/form-validate';
import AppModal from '@/components/AppModal';
import FieldDependencyGraph from '../designer/components/FieldDependencyGraph';
import FormDesigner, { type FormHistoryControls } from '../designer/components/FormDesigner';
import WorkflowFormRenderer from '../designer/components/WorkflowFormRenderer';
import { useSaveWorkflowForm, useWorkflowFormDetail } from '@/hooks/queries/workflow-forms';

type PreviewState = 'fill' | 'readonly' | 'approval';

let tplKeyCounter = 0;
function genFieldKey(type: WorkflowFormFieldType): string {
  tplKeyCounter += 1;
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${type}_${Date.now()}_${tplKeyCounter}_${random.replace(/-/g, '').slice(0, 8)}`;
}

// 常用字段模板（一键插入到表单末尾）
const FIELD_TEMPLATES: Array<{ key: string; label: string; build: () => WorkflowFormField[] }> = [
  {
    key: 'applicant',
    label: '申请人信息',
    build: () => [
      { key: genFieldKey('text'), label: '申请人', type: 'text', required: true },
      { key: genFieldKey('phone'), label: '联系电话', type: 'phone', required: true, placeholder: '请输入手机号' },
      { key: genFieldKey('deptSelect'), label: '所属部门', type: 'deptSelect' },
    ],
  },
  {
    key: 'leave',
    label: '请假信息',
    build: () => {
      const dateKey = genFieldKey('dateRange');
      return [
        { key: dateKey, label: '请假日期', type: 'dateRange', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: genFieldKey('number'), label: '请假天数', type: 'number', unit: '天', precision: 1, daysFromKey: dateKey, readOnly: true },
        { key: genFieldKey('textarea'), label: '请假事由', type: 'textarea', required: true },
      ];
    },
  },
  {
    key: 'reimburse',
    label: '报销信息',
    build: () => [
      { key: genFieldKey('amount'), label: '报销金额', type: 'amount', currency: 'CNY', precision: 2, required: true },
      { key: genFieldKey('attachment'), label: '发票/凭证', type: 'attachment', maxCount: 9, required: true },
      { key: genFieldKey('textarea'), label: '费用说明', type: 'textarea' },
    ],
  },
];

const LAYOUT_TYPES = new Set<WorkflowFormFieldType>(['row', 'group', 'divider', 'description', 'detail', 'serialNumber', 'tabs', 'steps']);

// 批量应用属性到所有可编辑字段（递归进入分栏/分组/明细/面板）
function applyBatchToFields(fields: WorkflowFormField[], patch: Partial<WorkflowFormField>): WorkflowFormField[] {
  return fields.map((f) => {
    let nf = LAYOUT_TYPES.has(f.type) ? { ...f } : { ...f, ...patch };
    if (f.columns) nf = { ...nf, columns: f.columns.map((c) => ({ ...c, fields: applyBatchToFields(c.fields, patch) })) };
    if (f.panes) nf = { ...nf, panes: f.panes.map((p) => ({ ...p, fields: applyBatchToFields(p.fields, patch) })) };
    if (f.children) nf = { ...nf, children: applyBatchToFields(f.children, patch) };
    return nf;
  });
}

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

  const [currentId, setCurrentId] = useState<number | null>(null);
  const detailQuery = useWorkflowFormDetail(formId, formId != null && formId !== currentId);
  const saveMutation = useSaveWorkflowForm();

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
  const [previewState, setPreviewState] = useState<PreviewState>('fill');
  const [jsonVisible, setJsonVisible] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [healthVisible, setHealthVisible] = useState(false);
  const [graphVisible, setGraphVisible] = useState(false);
  const [batchVisible, setBatchVisible] = useState(false);
  const [batchPatch, setBatchPatch] = useState<Partial<WorkflowFormField>>({});
  const [history, setHistory] = useState<FormHistoryControls | null>(null);

  const handleHistoryChange = useCallback((c: FormHistoryControls) => setHistory(c), []);

  // 体检：保存前/设计中聚合校验
  const healthIssues = useMemo(() => validateFormSchema(fields), [fields]);
  const healthErrorCount = countErrors(healthIssues);

  // 写入字段：优先走设计器历史栈（可撤销），未就绪时回退本地状态
  const commitFields = useCallback((next: WorkflowFormField[]) => {
    if (history) history.commitFields(next);
    else setFields(next);
  }, [history]);

  // ─── 加载（仅当外部指定的 formId 与当前已加载不一致时） ───────────────
  useEffect(() => {
    if (formId == null) return;
    const form = detailQuery.data;
    if (!form || form.id === currentId) return;
    setCurrentId(form.id);
    setName(form.name);
    setCode(form.code ?? '');
    setDescription(form.description ?? '');
    setCategoryId(form.categoryId ?? null);
    setStatus(form.status);
    setFields(form.schema?.fields ?? []);
    setSettings(form.schema?.settings ?? DEFAULT_SETTINGS);
  }, [currentId, detailQuery.data, formId]);

  // ─── 保存 ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) {
      Toast.warning('请填写表单名称');
      setSettingsVisible(true);
      return;
    }
    if (healthErrorCount > 0) {
      Toast.error(`表单存在 ${healthErrorCount} 项配置错误，请先在体检面板中修复`);
      setHealthVisible(true);
      return;
    }
    const payload = {
      name: name.trim(),
      code: code.trim() || null,
      description: description.trim() || null,
      categoryId,
      status,
      schema: { fields, settings },
    };
    const saved = await saveMutation.mutateAsync({ id: currentId, values: payload });
    Toast.success('保存成功');
    setCurrentId(saved.id);
    onSaved(saved);
  };

  // 表单级设置变更（纳入设计器撤销/重做历史）
  const updateSettings = (patch: Partial<WorkflowFormSettings>) => {
    const next = { ...settings, ...patch };
    if (history) history.commitSettings(next);
    else setSettings(next);
  };

  // 表单 schema 的 JSON（保存即此结构），供预览/复制
  const schemaJson = useMemo(() => JSON.stringify({ fields, settings }, null, 2), [fields, settings]);

  const openJson = () => { setJsonDraft(schemaJson); setJsonVisible(true); };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonDraft || schemaJson);
      Toast.success('已复制 JSON');
    } catch {
      Toast.error('复制失败，请手动选择复制');
    }
  };

  // 从 JSON 导入字段（结构校验后整体替换，纳入历史可撤销）
  const importJson = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonDraft);
    } catch {
      Toast.error('JSON 解析失败，请检查格式');
      return;
    }
    const obj = parsed as { fields?: unknown; settings?: unknown };
    const list = Array.isArray(obj) ? obj : obj?.fields;
    if (!Array.isArray(list)) {
      Toast.error('JSON 缺少 fields 数组');
      return;
    }
    const valid = list.every((f) => f && typeof (f as WorkflowFormField).key === 'string' && typeof (f as WorkflowFormField).type === 'string');
    if (!valid) {
      Toast.error('字段结构无效（缺少 key/type）');
      return;
    }
    commitFields(list as WorkflowFormField[]);
    if (!Array.isArray(obj) && obj?.settings && typeof obj.settings === 'object') {
      const nextSettings = obj.settings as WorkflowFormSettings;
      if (history) history.commitSettings(nextSettings);
      else setSettings(nextSettings);
    }
    setJsonVisible(false);
    Toast.success('已导入');
  };

  const insertTemplate = (tplKey: string) => {
    const tpl = FIELD_TEMPLATES.find((t) => t.key === tplKey);
    if (!tpl) return;
    commitFields([...fields, ...tpl.build()]);
    Toast.success(`已插入「${tpl.label}」模板`);
  };

  const applyBatch = () => {
    if (Object.keys(batchPatch).length === 0) { setBatchVisible(false); return; }
    commitFields(applyBatchToFields(fields, batchPatch));
    setBatchVisible(false);
    setBatchPatch({});
    Toast.success('已批量应用');
  };

  const previewBody = useMemo(() => {
    const readOnly = previewState !== 'fill';
    return (
    <div>
      {previewState === 'approval' && (
        <Banner
          type="info"
          closeIcon={null}
          style={{ marginBottom: 12 }}
          description="审批态预览：表单为只读，审批人仅查看申请内容并填写审批意见。"
        />
      )}
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
            readOnly={readOnly}
            labelPosition={settings.labelPosition ?? 'top'}
            labelAlign={settings.labelAlign}
            labelWidth={settings.labelWidth}
          />
          {previewState === 'approval' ? (
            <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
              <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 8 }}>审批意见</Typography.Text>
              <TextArea placeholder="请输入审批意见" rows={2} disabled />
              <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button type="danger" theme="light" disabled>驳回</Button>
                <Button type="primary" theme="solid" disabled>同意</Button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 16, textAlign: previewMode === 'mobile' ? 'center' : 'right' }}>
              <Button type="primary" theme="solid" disabled={readOnly} block={previewMode === 'mobile'}>
                {settings.submitButtonText || '提交'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
    );
  }, [fields, settings, previewMode, previewState]);

  if (detailQuery.isFetching) {
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

        <Dropdown
          trigger="click"
          position="bottomLeft"
          render={(
            <Dropdown.Menu>
              {FIELD_TEMPLATES.map((t) => (
                <Dropdown.Item key={t.key} onClick={() => insertTemplate(t.key)}>{t.label}</Dropdown.Item>
              ))}
            </Dropdown.Menu>
          )}
        >
          <Button icon={<LayoutTemplate size={14} />} type="tertiary" theme="borderless" size="small">模板</Button>
        </Dropdown>
        <Button icon={<SlidersHorizontal size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => { setBatchPatch({}); setBatchVisible(true); }}>批量设置</Button>
        <Button icon={<Share2 size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => setGraphVisible(true)}>依赖图</Button>
        <Tooltip content={healthErrorCount > 0 ? `${healthErrorCount} 项错误` : '表单体检'}>
          <Button
            icon={<Stethoscope size={14} />}
            type={healthErrorCount > 0 ? 'danger' : 'tertiary'}
            theme="borderless" size="small"
            onClick={() => setHealthVisible(true)}
          >
            体检{healthErrorCount > 0 ? `(${healthErrorCount})` : ''}
          </Button>
        </Tooltip>
        <Divider layout="vertical" margin="6px" />

        <Button icon={<Settings size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => setSettingsVisible(true)}>表单设置</Button>
        <Button icon={<Braces size={14} />} type="tertiary" theme="borderless" size="small" onClick={openJson}>JSON</Button>
        <Button icon={<Eye size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => setPreviewVisible(true)}>预览</Button>
        <Button icon={<Save size={14} />} type="primary" size="small" loading={saveMutation.isPending} onClick={() => void handleSave()}>保存</Button>
      </div>

      {/* 字段设计器 */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <FormDesigner
          fields={fields}
          onChange={setFields}
          settings={settings}
          onSettingsChange={setSettings}
          showToolbar={false}
          onHistoryChange={handleHistoryChange}
        />
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingRight: 32, flexWrap: 'wrap' }}>
            <span>表单预览</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <RadioGroup type="button" value={previewState} onChange={(e) => setPreviewState(e.target.value as PreviewState)}>
                <Radio value="fill">填写态</Radio>
                <Radio value="readonly">只读态</Radio>
                <Radio value="approval">审批态</Radio>
              </RadioGroup>
              <RadioGroup type="button" value={previewMode} onChange={(e) => setPreviewMode(e.target.value as 'pc' | 'mobile')}>
                <Radio value="pc"><Monitor size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />PC</Radio>
                <Radio value="mobile"><Smartphone size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />移动</Radio>
              </RadioGroup>
            </div>
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

      {/* JSON 弹窗（可编辑导入） */}
      <AppModal
        title={(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
            <span>表单 JSON</span>
            <Button icon={<Copy size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => void copyJson()}>复制</Button>
          </div>
        )}
        visible={jsonVisible}
        onCancel={() => setJsonVisible(false)}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button theme="borderless" type="tertiary" size="small" onClick={() => setJsonDraft(schemaJson)}>重置为当前表单</Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => setJsonVisible(false)}>关闭</Button>
              <Button type="primary" onClick={importJson}>导入</Button>
            </div>
          </div>
        )}
        width={640}
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
      >
        <Typography.Paragraph type="tertiary" size="small" style={{ marginBottom: 8 }}>
          编辑下方 JSON（schema：fields + settings）后点击「导入」覆盖当前表单；可用于外部对接与批量配置。导入会进入撤销栈，可撤销。
        </Typography.Paragraph>
        <TextArea
          value={jsonDraft}
          onChange={setJsonDraft}
          autosize={{ minRows: 12, maxRows: 24 }}
          style={{ fontFamily: 'var(--semi-font-family-mono, monospace)', fontSize: 12 }}
          spellCheck={false}
        />
      </AppModal>

      {/* 字段依赖关系图 */}
      <AppModal
        title="字段依赖关系图"
        visible={graphVisible}
        onCancel={() => setGraphVisible(false)}
        footer={<Button type="primary" onClick={() => setGraphVisible(false)}>关闭</Button>}
        width={920}
        closeOnEsc
      >
        {graphVisible && <FieldDependencyGraph fields={fields} />}
      </AppModal>

      {/* 体检面板 */}
      <SideSheet
        title={`表单体检（${healthErrorCount} 错误 / ${healthIssues.length - healthErrorCount} 警告）`}
        visible={healthVisible}
        onCancel={() => setHealthVisible(false)}
        width={420}
        closeOnEsc
      >
        {healthIssues.length === 0 ? (
          <Banner type="success" closeIcon={null} description="表单配置无问题，可放心保存。" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {healthIssues.map((issue, i) => (
              <HealthIssueRow
                key={`issue-${i}-${issue.fieldKey ?? 'form'}`}
                issue={issue}
                onLocate={issue.fieldKey ? () => { history?.selectField(issue.fieldKey!); setHealthVisible(false); } : undefined}
              />
            ))}
          </div>
        )}
      </SideSheet>

      {/* 批量设置 */}
      <AppModal
        title="批量设置字段属性"
        visible={batchVisible}
        onCancel={() => setBatchVisible(false)}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setBatchVisible(false)}>取消</Button>
            <Button type="primary" onClick={applyBatch}>应用到所有字段</Button>
          </div>
        )}
        width={420}
      >
        <Typography.Paragraph type="tertiary" size="small" style={{ marginBottom: 12 }}>
          仅勾选/选择需要修改的属性，将应用到所有非布局字段（含分栏/分组/明细内子字段）。
        </Typography.Paragraph>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography.Text strong size="small">设为必填</Typography.Text>
            <Switch
              checked={batchPatch.required === true}
              onChange={(v) => setBatchPatch((p) => { const n = { ...p }; if (v) n.required = true; else delete n.required; return n; })}
              size="small"
            />
          </div>
          <div>
            <Typography.Text strong size="small">标签位置</Typography.Text>
            <Select
              value={batchPatch.labelPosition}
              onChange={(v) => setBatchPatch((p) => ({ ...p, labelPosition: v as WorkflowFormSettings['labelPosition'] }))}
              placeholder="不修改"
              showClear
              onClear={() => setBatchPatch((p) => { const n = { ...p }; delete n.labelPosition; return n; })}
              style={{ width: '100%', marginTop: 4 }}
              optionList={LABEL_POSITION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
          <div>
            <Typography.Text strong size="small">列宽</Typography.Text>
            <Select
              value={batchPatch.columnSpan}
              onChange={(v) => setBatchPatch((p) => ({ ...p, columnSpan: v as number }))}
              placeholder="不修改"
              showClear
              onClear={() => setBatchPatch((p) => { const n = { ...p }; delete n.columnSpan; return n; })}
              style={{ width: '100%', marginTop: 4 }}
              optionList={COLUMN_SPAN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
        </div>
      </AppModal>
    </div>
  );
}

function HealthIssueRow({ issue, onLocate }: Readonly<{ issue: FormIssue; onLocate?: () => void }>) {
  const isError = issue.level === 'error';
  return (
    <button
      type="button"
      onClick={onLocate}
      disabled={!onLocate}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', textAlign: 'left',
        padding: '8px 10px', borderRadius: 6, cursor: onLocate ? 'pointer' : 'default',
        background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)',
      }}
    >
      {isError
        ? <CircleAlert size={15} style={{ color: 'var(--semi-color-danger)', flexShrink: 0, marginTop: 2 }} />
        : <AlertTriangle size={15} style={{ color: 'var(--semi-color-warning)', flexShrink: 0, marginTop: 2 }} />}
      <div style={{ flex: 1 }}>
        {issue.fieldLabel && <Typography.Text strong size="small" style={{ display: 'block' }}>{issue.fieldLabel}</Typography.Text>}
        <Typography.Text size="small" type={isError ? 'danger' : 'warning'}>{issue.message}</Typography.Text>
      </div>
    </button>
  );
}
