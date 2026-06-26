import { Input, Select, Button, Space, Typography, Empty, TextArea } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import AppModal from '@/components/AppModal';
import type { ReportFilter, ReportFilterType, ReportDataset } from '@zenith/shared';

interface Props {
  visible: boolean;
  filters: ReportFilter[];
  datasets: ReportDataset[];
  onChange: (filters: ReportFilter[]) => void;
  onClose: () => void;
}

const TYPES = [
  { value: 'date', label: '日期' }, { value: 'daterange', label: '日期范围' },
  { value: 'select', label: '下拉单选' }, { value: 'multiSelect', label: '下拉多选' },
  { value: 'input', label: '文本' }, { value: 'numberRange', label: '数值范围' },
];

function genId() { return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`; }

export function FilterConfigModal({ visible, filters, datasets, onChange, onClose }: Readonly<Props>) {
  function patch(i: number, p: Partial<ReportFilter>) {
    const list = [...filters];
    list[i] = { ...list[i], ...p };
    onChange(list);
  }
  function patchSource(i: number, p: Partial<NonNullable<ReportFilter['optionSource']>>) {
    const cur = filters[i].optionSource ?? { kind: 'static' as const };
    patch(i, { optionSource: { ...cur, ...p } });
  }
  function add() {
    onChange([...filters, { id: genId(), label: '新筛选器', type: 'select', optionSource: { kind: 'static', options: [] } }]);
  }
  function remove(i: number) { onChange(filters.filter((_, j) => j !== i)); }

  return (
    <AppModal title="全局筛选器" visible={visible} onCancel={onClose} onOk={onClose} okText="完成" width={720} fullscreenable={false}>
      <Space vertical align="start" style={{ width: '100%' }}>
        {filters.length === 0 && <Empty description="还没有筛选器，点击下方添加" style={{ padding: '16px 0' }} />}
        {filters.map((f, i) => {
          const isSelect = f.type === 'select' || f.type === 'multiSelect';
          const src = f.optionSource;
          return (
            <div key={f.id} style={{ width: '100%', border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: 12 }}>
              <Space wrap style={{ width: '100%' }}>
                <Input prefix="标签" value={f.label} style={{ width: 180 }} onChange={(v) => patch(i, { label: v })} />
                <Select value={f.type} style={{ width: 130 }} optionList={TYPES} onChange={(v) => patch(i, { type: v as ReportFilterType })} />
                <Input prefix="ID" value={f.id} disabled style={{ width: 160 }} />
                <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => remove(i)} />
              </Space>
              {isSelect && (
                <Space wrap style={{ width: '100%', marginTop: 8 }}>
                  <Select value={src?.kind ?? 'static'} style={{ width: 120 }} optionList={[{ value: 'static', label: '静态选项' }, { value: 'dataset', label: '数据集' }]}
                    onChange={(v) => patchSource(i, { kind: v as 'static' | 'dataset' })} />
                  {src?.kind === 'dataset' ? (
                    <>
                      <Select placeholder="数据集" style={{ width: 160 }} value={src.datasetId ?? undefined} optionList={datasets.map((d) => ({ value: d.id, label: d.name }))}
                        onChange={(v) => patchSource(i, { datasetId: v as number })} showClear filter />
                      <Input prefix="值列" style={{ width: 120 }} value={src.valueField ?? ''} onChange={(v) => patchSource(i, { valueField: v })} />
                      <Input prefix="显示列" style={{ width: 120 }} value={src.labelField ?? ''} onChange={(v) => patchSource(i, { labelField: v })} />
                    </>
                  ) : (
                    <TextArea style={{ width: 360 }} placeholder={'静态选项，每行 value:label\n如：\npaid:已支付\nrefunded:已退款'} autosize={{ minRows: 1, maxRows: 4 }}
                      value={(src?.options ?? []).map((op) => `${op.value}:${op.label}`).join('\n')}
                      onChange={(v) => patchSource(i, { options: v.split('\n').map((line: string) => line.trim()).filter(Boolean).map((line: string) => { const [val, ...rest] = line.split(':'); return { value: val.trim(), label: (rest.join(':') || val).trim() }; }) })} />
                  )}
                </Space>
              )}
            </div>
          );
        })}
        <Button icon={<Plus size={14} />} onClick={add}>添加筛选器</Button>
        <Typography.Text type="tertiary" size="small">在组件配置的「参数绑定」中把筛选器连接到数据集参数（SQL 用 {'${参数名}'} 占位）。</Typography.Text>
      </Space>
    </AppModal>
  );
}

export default FilterConfigModal;
