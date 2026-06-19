/**
 * 表单库 · 独立表单设计器页面
 * 管理整张表单的 schema（字段 + 表单级设置），内嵌 FormDesigner，支持 PC/移动双预览。
 * 路由：/workflow/forms/designer（新建） 或 /workflow/forms/designer?id=123（编辑）
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button, Spin, Toast, Typography, Input, Select, TextArea,
  RadioGroup, Radio, InputNumber, SideSheet, Divider,
} from '@douyinfe/semi-ui';
import { ArrowLeft, Eye, Save, Settings, Monitor, Smartphone } from 'lucide-react';
import type { WorkflowForm, WorkflowFormField, WorkflowFormSettings, WorkflowFormStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import AppModal from '@/components/AppModal';
import FormDesigner from '../designer/components/FormDesigner';
import WorkflowFormRenderer from '../designer/components/WorkflowFormRenderer';

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 52,
  padding: '0 16px',
  borderBottom: '1px solid var(--semi-color-border)',
  background: 'var(--semi-color-bg-1)',
  flexShrink: 0,
};

export default function WorkflowFormDesignerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { categories } = useWorkflowCategories();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formId, setFormId] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [status, setStatus] = useState<WorkflowFormStatus>('enabled');
  const [fields, setFields] = useState<WorkflowFormField[]>([]);
  const [settings, setSettings] = useState<WorkflowFormSettings>({ submitButtonText: '提交', labelPosition: 'top' });

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewMode, setPreviewMode] = useState<'pc' | 'mobile'>('pc');

  // ─── 加载 ────────────────────────────────────────────────────────
  useEffect(() => {
    const idParam = searchParams.get('id');
    if (!idParam) {
      setLoading(false);
      return;
    }
    const fid = Number(idParam);
    if (!Number.isFinite(fid)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    request.get<WorkflowForm>(`/api/workflows/forms/${fid}`).then(res => {
      if (res.code === 0 && res.data) {
        setFormId(res.data.id);
        setName(res.data.name);
        setCode(res.data.code ?? '');
        setDescription(res.data.description ?? '');
        setCategoryId(res.data.categoryId ?? null);
        setStatus(res.data.status);
        setFields(res.data.schema?.fields ?? []);
        setSettings(res.data.schema?.settings ?? { submitButtonText: '提交', labelPosition: 'top' });
      } else {
        Toast.error('表单不存在或加载失败');
      }
    }).finally(() => setLoading(false));
    // 仅在 id 变化时加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('id')]);

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
      const res = formId
        ? await request.put<WorkflowForm>(`/api/workflows/forms/${formId}`, payload)
        : await request.post<WorkflowForm>('/api/workflows/forms', payload);
      if (res.code === 0) {
        Toast.success('保存成功');
        if (!formId && res.data) {
          setFormId(res.data.id);
          setSearchParams({ id: String(res.data.id) }, { replace: true });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const updateSettings = (patch: Partial<WorkflowFormSettings>) =>
    setSettings(prev => ({ ...prev, ...patch }));

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部工具栏 */}
      <div style={toolbarStyle}>
        <Button icon={<ArrowLeft size={14} />} type="tertiary" theme="borderless" title="返回表单库" onClick={() => navigate('/workflow/forms')} />
        <Input
          value={name}
          onChange={setName}
          placeholder="未命名表单"
          style={{ width: 280, fontWeight: 600 }}
          size="large"
        />
        <div style={{ flex: 1 }} />
        <Button icon={<Settings size={14} />} type="tertiary" theme="borderless" onClick={() => setSettingsVisible(true)}>表单设置</Button>
        <Button icon={<Eye size={14} />} type="tertiary" theme="borderless" onClick={() => setPreviewVisible(true)}>预览</Button>
        <Button icon={<Save size={14} />} type="primary" loading={saving} onClick={() => void handleSave()}>保存</Button>
      </div>

      {/* 字段设计器 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <FormDesigner fields={fields} onChange={setFields} />
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
                onChange={(e) => updateSettings({ labelPosition: e.target.value as 'top' | 'left' })}
              >
                <Radio value="top">顶部</Radio>
                <Radio value="left">左侧</Radio>
              </RadioGroup>
            </div>
          </div>
          {settings.labelPosition === 'left' && (
            <div>
              <Typography.Text strong size="small">标签宽度</Typography.Text>
              <InputNumber
                value={settings.labelWidth ?? 96}
                onChange={(v) => updateSettings({ labelWidth: Number(v) || undefined })}
                min={60}
                max={200}
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
    </div>
  );
}
