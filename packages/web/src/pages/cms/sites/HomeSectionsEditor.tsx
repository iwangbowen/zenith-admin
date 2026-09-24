import { useState } from 'react';
import { Banner, Button, Input, InputNumber, Select, Space, Typography } from '@douyinfe/semi-ui';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { CMS_HOME_IMAGE_RATIO_OPTIONS, CMS_HOME_SECTION_SOURCE_OPTIONS, CMS_HOME_SECTION_STYLE_OPTIONS, type CmsChannel, type CmsHomeSection } from '@zenith/shared/cms';
import { useCmsChannelTree } from '@/hooks/queries/cms-channels';
import { SliderInput } from '@/components/SliderInput';
import './site-composition.css';

function reorderHomeSections(rows: readonly CmsHomeSection[], from: number, to: number): CmsHomeSection[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return [...rows];
  const next = [...rows]; const [row] = next.splice(from, 1); next.splice(to, 0, row); return next;
}
function flatten(rows: readonly CmsChannel[]): CmsChannel[] { return rows.flatMap((row) => [row, ...flatten(row.children ?? [])]); }

export default function HomeSectionsEditor({ siteId, value = [], onChange, disabled }: Readonly<{ siteId?: number; value?: CmsHomeSection[]; onChange: (rows: CmsHomeSection[]) => void; disabled?: boolean }>) {
  const channels = useCmsChannelTree(siteId);
  const [dragging, setDragging] = useState<number | null>(null);
  const options = flatten(channels.data ?? []).filter((row) => row.type === 'list' && row.status === 'enabled').map((row) => ({ value: row.id, label: row.name }));
  const patch = (index: number, values: Partial<CmsHomeSection>) => onChange(value.map((row, position) => position === index ? { ...row, ...values } : row));
  const move = (from: number, to: number) => onChange(reorderHomeSections(value, from, to));
  return <div className="cms-composition-editor">
    <Typography.Text type="tertiary" size="small">拖动把手或使用上下移调整顺序。宽屏双列、手机单列，每区最多 24 条。</Typography.Text>
    {channels.isError ? <Banner type="warning" description="栏目加载失败，已选栏目保持不变，请重新打开编辑窗口重试。" /> : null}
    {value.map((row, index) => <div key={row.id} className="cms-composition-row" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!disabled && dragging !== null) move(dragging, index); setDragging(null); }}>
      <Space wrap>
        <button type="button" className="cms-composition-drag" aria-label={`拖动区域 ${index + 1}`} draggable={!disabled} disabled={disabled}
          onDragStart={(event) => { setDragging(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.id); }} onDragEnd={() => setDragging(null)}><GripVertical size={16} /></button>
        <Typography.Text strong>区域 {index + 1}</Typography.Text>
        <Button icon={<ArrowUp size={14} />} aria-label={`上移区域 ${index + 1}`} disabled={disabled || index === 0} onClick={() => move(index, index - 1)} />
        <Button icon={<ArrowDown size={14} />} aria-label={`下移区域 ${index + 1}`} disabled={disabled || index === value.length - 1} onClick={() => move(index, index + 1)} />
        <Button icon={<Trash2 size={14} />} aria-label={`删除区域 ${index + 1}`} disabled={disabled} onClick={() => onChange(value.filter((_, position) => position !== index))} />
      </Space>
      <div className="cms-composition-grid">
        <label>内容来源<Select aria-label={`区域 ${index + 1} 内容来源`} value={row.source} optionList={CMS_HOME_SECTION_SOURCE_OPTIONS} disabled={disabled} onChange={(source) => patch(index, { source: source as CmsHomeSection['source'], channelId: null })} /></label>
        {row.source === 'channel' ? <label>本站栏目<Select aria-label={`区域 ${index + 1} 栏目`} value={row.channelId ?? undefined} loading={channels.isFetching} filter disabled={disabled || !siteId} optionList={options} placeholder={siteId ? '选择启用的列表栏目' : '请先保存站点，再创建栏目'} onChange={(id) => patch(index, { channelId: Number(id) })} /></label> : null}
        <label>区域标题<Input aria-label={`区域 ${index + 1} 标题`} value={row.title} disabled={disabled} placeholder="留空使用来源名称" maxLength={80} onChange={(title) => patch(index, { title })} /></label>
        <label>展示条数<InputNumber aria-label={`区域 ${index + 1} 条数`} min={1} max={24} value={row.count} disabled={disabled} onChange={(count) => { if (typeof count === 'number') patch(index, { count }); }} /></label>
        <label>展示样式<Select aria-label={`区域 ${index + 1} 样式`} value={row.style} optionList={CMS_HOME_SECTION_STYLE_OPTIONS} disabled={disabled} onChange={(style) => patch(index, { style: style as CmsHomeSection['style'] })} /></label>
        <label>图片比例<Select aria-label={`区域 ${index + 1} 图片比例`} value={row.imageRatio} optionList={CMS_HOME_IMAGE_RATIO_OPTIONS} disabled={disabled || row.style === 'compact'} onChange={(imageRatio) => patch(index, { imageRatio: imageRatio as CmsHomeSection['imageRatio'] })} /></label>
      </div>
      {row.style !== 'compact' ? <div className="cms-composition-grid"><label>裁切焦点（水平）<SliderInput min={0} max={100} value={row.focusX} disabled={disabled} onChange={(focusX) => patch(index, { focusX })} /></label><label>裁切焦点（垂直）<SliderInput min={0} max={100} value={row.focusY} disabled={disabled} onChange={(focusY) => patch(index, { focusY })} /></label></div> : null}
    </div>)}
    <Button icon={<Plus size={14} />} disabled={disabled || value.length >= 16} onClick={() => onChange([...value, { id: crypto.randomUUID(), source: 'latest', channelId: null, title: '', count: 6, style: 'feature-list', imageRatio: 'wide', focusX: 50, focusY: 50 }])}>添加内容区域</Button>
  </div>;
}
