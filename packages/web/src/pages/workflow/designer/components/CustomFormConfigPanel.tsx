/**
 * 流程设计器 · 第二步「表单」— 自定义业务表单配置
 *
 * 当表单类型选择「自定义业务表单」时展示。用户配置：
 * - 创建/查看页组件路径（相对 src/pages，复用菜单同款组件解析机制）
 * - 页签图标（整页打开时使用，预留）
 * - 暴露给流程的变量声明（驱动条件分支 / 按字段指定审批人）
 */
import { Button, Input, Select, Typography, Space, Banner } from '@douyinfe/semi-ui';
import { Plus, Trash2, CircleCheck, CircleAlert } from 'lucide-react';
import type { WorkflowCustomFormConfig, WorkflowCustomFormVariable } from '@zenith/shared';
import IconPicker from '@/components/IconPicker';
import { hasPageComponent } from '@/utils/page-registry';

interface CustomFormConfigPanelProps {
  value: WorkflowCustomFormConfig | null;
  onChange: (next: WorkflowCustomFormConfig) => void;
  /** custom=自定义业务表单（流程内创建/查看）；external=业务系统主导（仅审批查看） */
  formType?: 'custom' | 'external';
}

const VARIABLE_TYPE_OPTIONS: Array<{ value: WorkflowCustomFormVariable['type']; label: string }> = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'date', label: '日期' },
  { value: 'user', label: '人员' },
  { value: 'dept', label: '部门' },
];

const EMPTY_CONFIG: WorkflowCustomFormConfig = { createComponent: '', viewComponent: null, icon: null, variables: [] };

/** 组件路径解析状态提示 */
function ComponentStatus({ path }: Readonly<{ path: string }>) {
  if (!path.trim()) return null;
  const ok = hasPageComponent(path);
  return ok ? (
    <Typography.Text type="success" size="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <CircleCheck size={13} /> 已找到组件
    </Typography.Text>
  ) : (
    <Typography.Text type="warning" size="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <CircleAlert size={13} /> 未找到组件，请确认已在 src/pages 下创建
    </Typography.Text>
  );
}

export default function CustomFormConfigPanel({ value, onChange, formType = 'custom' }: Readonly<CustomFormConfigPanelProps>) {
  const config = value ?? EMPTY_CONFIG;
  const variables = config.variables ?? [];
  const isExternal = formType === 'external';

  const patch = (p: Partial<WorkflowCustomFormConfig>) => onChange({ ...config, ...p });

  const variableKey = (v: WorkflowCustomFormVariable) => v.id ?? String(v.key);
  const updateVariable = (key: string, p: Partial<WorkflowCustomFormVariable>) => {
    const next = variables.map((v) => (variableKey(v) === key ? { ...v, ...p } : v));
    patch({ variables: next });
  };
  const addVariable = () => patch({ variables: [...variables, { id: crypto.randomUUID(), key: '', label: '', type: 'string' }] });
  const removeVariable = (key: string) => patch({ variables: variables.filter((v) => variableKey(v) !== key) });

  const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 6 };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '4px 2px' }}>
      <Banner
        type="info"
        bordered
        closeIcon={null}
        description={isExternal
          ? '业务系统主导：流程由业务模块（自有表/列表页）调用 startWorkflowForBiz 发起并关联（businessKey）。此处通常只需配置「查看页组件」用于审批时按 bizId 渲染业务数据，创建页留空即可。'
          : '自定义业务表单使用你在 src/pages 下自行实现的 React 页面承载发起填写与查看。页面通过 props.mode（create/view/approve）区分渲染，提交的数据将作为流程实例的 formData 存储。'}
        style={{ marginBottom: 16 }}
      />

      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={labelStyle}>
          创建 / 填写页组件 {isExternal ? <Typography.Text type="tertiary">（业务系统主导时可留空）</Typography.Text> : <Typography.Text type="danger">*</Typography.Text>}
        </Typography.Text>
        <Input
          value={config.createComponent}
          onChange={(v) => patch({ createComponent: v })}
          placeholder="相对 src/pages 的路径，如 biz/leave/LeaveForm"
          showClear
        />
        <div style={{ marginTop: 4 }}><ComponentStatus path={config.createComponent} /></div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={labelStyle}>{isExternal ? '审批查看页组件' : '查看页组件（可选）'}</Typography.Text>
        <Input
          value={config.viewComponent ?? ''}
          onChange={(v) => patch({ viewComponent: v || null })}
          placeholder={isExternal ? '审批/查看时按 bizId 渲染业务数据，如 biz/leave/LeaveApprovalView' : '留空则复用创建页组件并以只读模式渲染'}
          showClear
        />
        <div style={{ marginTop: 4 }}>
          {config.viewComponent ? <ComponentStatus path={config.viewComponent} /> : null}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Typography.Text strong style={labelStyle}>页签图标</Typography.Text>
        <IconPicker value={config.icon ?? ''} onChange={(icon) => patch({ icon: icon || null })} style={{ maxWidth: 260 }} />
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
          作为独立页签打开时显示的图标（预留）。
        </Typography.Text>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Text strong>暴露给流程的变量</Typography.Text>
          <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={addVariable}>添加变量</Button>
        </div>
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
          声明业务页提交时写入 formData 的字段，供「条件分支」「按表单字段指定审批人」引用。业务页需保证提交数据包含这些 key。
        </Typography.Text>
        {variables.length === 0 ? (
          <Typography.Text type="tertiary" size="small">暂无变量，点击「添加变量」声明。</Typography.Text>
        ) : (
          <Space vertical align="start" style={{ width: '100%' }} spacing={8}>
            {variables.map((v) => {
              const varId = v.id ?? String(v.key);
              return (
                <Space key={varId} align="center" style={{ width: '100%' }}>
                  <Input
                    value={v.key}
                    onChange={(val) => updateVariable(varId, { key: val })}
                    placeholder="变量 key（英文）"
                    style={{ width: 200 }}
                  />
                  <Input
                    value={v.label}
                    onChange={(val) => updateVariable(varId, { label: val })}
                    placeholder="显示名称"
                    style={{ width: 180 }}
                  />
                  <Select
                    value={v.type}
                    onChange={(val) => updateVariable(varId, { type: val as WorkflowCustomFormVariable['type'] })}
                    optionList={VARIABLE_TYPE_OPTIONS}
                    style={{ width: 110 }}
                  />
                  <Button
                    type="danger"
                    theme="borderless"
                    size="small"
                    icon={<Trash2 size={14} />}
                    onClick={() => removeVariable(varId)}
                  />
                </Space>
              );
            })}
          </Space>
        )}
      </div>
    </div>
  );
}
