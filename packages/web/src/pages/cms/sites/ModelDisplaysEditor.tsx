import { Banner, Button, Select, Space, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import { CMS_MODEL_DISPLAY_OPTIONS, CMS_MODEL_DISPLAY_ROLES, validateCmsModelDisplay, type CmsModelDisplay } from '@zenith/shared/cms';
import { useAllCmsModels } from '@/hooks/queries/cms-models';
import './site-composition.css';

export default function ModelDisplaysEditor({ siteId, value = [], onChange, disabled }: Readonly<{ siteId?: number; value?: CmsModelDisplay[]; onChange: (rows: CmsModelDisplay[]) => void; disabled?: boolean }>) {
  const models = useAllCmsModels(siteId);
  const available = (models.data ?? []).filter((model) => (model.fields?.length ?? 0) > 0);
  const addable = available.filter((model) => !value.some((row) => row.modelId === model.id));
  const patch = (index: number, update: Partial<CmsModelDisplay>) => onChange(value.map((row, position) => position === index ? { ...row, ...update } : row));
  return <div className="cms-composition-editor">
    <Typography.Text type="tertiary" size="small">绑定已发布模型字段。卡片使用每篇内容固定的模型版本；必填映射和字段类型在保存时检查。</Typography.Text>
    {models.isError ? <Banner type="warning" description="模型加载失败，请重试后保存展示映射。" /> : null}
    {value.map((row, index) => {
      const model = available.find((item) => item.id === row.modelId);
      const issues = validateCmsModelDisplay(row, model ? { id: model.id, fields: model.fields ?? [] } : undefined);
      return <div key={row.modelId} className="cms-composition-row">
        <Space wrap><Typography.Text strong>{model?.name ?? `不可用模型 #${row.modelId}`}</Typography.Text><Button icon={<Trash2 size={14} />} aria-label={`移除模型 ${row.modelId} 展示`} disabled={disabled} onClick={() => onChange(value.filter((_, position) => position !== index))} /></Space>
        <label>展示方案<Select value={row.kind} disabled={disabled} optionList={CMS_MODEL_DISPLAY_OPTIONS} onChange={(kind) => patch(index, { kind: kind as CmsModelDisplay['kind'], fields: {} })} /></label>
        <div className="cms-composition-grid">{CMS_MODEL_DISPLAY_ROLES[row.kind].map((role) => <label key={role.key}>{role.label}{role.required ? ' *' : ''}
          <Select aria-label={`${model?.name ?? row.modelId} ${role.label}`} value={row.fields[role.key]} placeholder={`选择${role.types.join(' / ')}字段`} showClear filter disabled={disabled}
            optionList={(model?.fields ?? []).filter((field) => role.types.includes(field.fieldType)).map((field) => ({ value: field.name, label: `${field.label}（${field.name}）` }))}
            onChange={(field) => { const fields = { ...row.fields }; if (typeof field === 'string' && field) fields[role.key] = field; else delete fields[role.key]; patch(index, { fields }); }} />
        </label>)}</div>
        {issues.length ? <Typography.Text type="warning" size="small">{issues.join('；')}</Typography.Text> : null}
      </div>;
    })}
    <Select prefix={<Plus size={14} />} value={undefined} disabled={disabled || !addable.length} loading={models.isFetching} placeholder="为内容模型添加展示方案" filter
      optionList={addable.map((model) => ({ value: model.id, label: model.name }))} onChange={(id) => onChange([...value, { modelId: Number(id), kind: 'event', fields: {} }])} />
  </div>;
}
