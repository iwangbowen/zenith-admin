import { useEffect, useState } from 'react';
import { Banner, Button, Checkbox, Radio, RadioGroup, Select, SideSheet, Space, Spin, Typography } from '@douyinfe/semi-ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { EXPORT_SCOPE_LABELS, type ExportJobFormat, type ExportJobRequestMode, type ExportPreview, type ExportScope } from '@zenith/shared/tasks';
import { useExportPreview } from '@/hooks/queries/export-jobs';
import { useExportJobRunner } from '@/hooks/useExportJobRunner';
export interface ExportConfiguration {
  entity: string;
  query: Record<string, unknown>;
  formats: ExportJobFormat[];
  raw: boolean;
  watermark: boolean;
  executionMode: ExportJobRequestMode;
  selectedIds?: Array<string | number>;
  pageIds?: Array<string | number>;
}
export default function ExportConfigPanel({ initial, onClose }: Readonly<{ initial: ExportConfiguration; onClose: () => void }>) {
  const [meta, setMeta] = useState<ExportPreview | null>(null);
  const [format, setFormat] = useState(initial.formats[0] ?? 'xlsx');
  const [scope, setScope] = useState<ExportScope>('filtered');
  const [columns, setColumns] = useState<string[]>([]);
  const [raw, setRaw] = useState(initial.raw);
  const [watermark, setWatermark] = useState(initial.watermark);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const preview = useExportPreview();
  const { mutateAsync } = preview;
  const runner = useExportJobRunner();
  useEffect(() => {
    let active = true;
    void mutateAsync({ body: { entity: initial.entity, query: initial.query, format: initial.formats[0] ?? 'xlsx', raw: initial.raw, watermark: initial.watermark, executionMode: initial.executionMode } }).then(result => {
      if (!active) return;
      setMeta(result); setColumns(result.columns.map(c => c.key));
      setFormat(initial.formats.find(f => result.formats.includes(f)) ?? result.formats[0]);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '预检失败'); });
    return () => { active = false; };
  }, [initial, mutateAsync]);
  const rowIds = scope === 'selected' ? initial.selectedIds : scope === 'page' ? initial.pageIds : undefined;
  const selectedSensitive = meta?.columns.some(c => c.sensitive && columns.includes(c.key));
  const move = (index: number, offset: number) => setColumns(old => { const next = [...old]; const target = index + offset; if (target < 0 || target >= next.length) return old; [next[index], next[target]] = [next[target], next[index]]; return next; });
  const check = async () => {
    try {
      const result = await mutateAsync({ body: { ...initial, format, columns: columns.length ? columns : undefined, scope, rowIds, raw, watermark } });
      setMeta(result); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : '预检失败'); }
  };
  const submit = async () => {
    setBusy(true); setError(null);
    try { await runner.runExport({ entity: initial.entity, query: initial.query, format, scope, rowIds, columns: columns.length ? columns : undefined, raw, watermark, executionMode: initial.executionMode, idempotencyKey: requestKey }); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setBusy(false); }
  };
  return <SideSheet title="导出配置" visible onCancel={onClose} width={640} footer={<Space><Button onClick={onClose} disabled={busy}>取消</Button><Button onClick={() => void check()} loading={preview.isPending} disabled={!meta}>更新预览</Button><Button type="primary" onClick={() => void submit()} loading={busy} disabled={!meta || (meta.columns.length > 0 && columns.length === 0) || (scope !== 'filtered' && !rowIds?.length)}>开始导出</Button></Space>}>
    {error && <Banner type="danger" description={error} closeIcon={null} />}
    {!meta ? <Spin tip="正在校验权限和导出规格" /> : <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
      <Typography.Title heading={5}>{meta.title}</Typography.Title>
      <Typography.Text strong>数据范围</Typography.Text>
      <RadioGroup value={scope} direction="vertical" onChange={e => setScope(e.target.value as ExportScope)}>
        <Radio value="filtered">{EXPORT_SCOPE_LABELS.filtered}</Radio>
        <Radio value="page" disabled={!meta.supportsRowScope || !initial.pageIds?.length}>{EXPORT_SCOPE_LABELS.page}（{initial.pageIds?.length ?? 0} 条）</Radio>
        <Radio value="selected" disabled={!meta.supportsRowScope || !initial.selectedIds?.length}>{EXPORT_SCOPE_LABELS.selected}（{initial.selectedIds?.length ?? 0} 条）</Radio>
      </RadioGroup>
      <Typography.Text strong>已生效的筛选条件</Typography.Text>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{Object.keys(initial.query).length ? JSON.stringify(initial.query, null, 2) : '未设置额外筛选条件'}</Typography.Paragraph>
      <Typography.Text strong>文件格式</Typography.Text>
      <Select aria-label="导出格式" value={format} onChange={v => setFormat(v as ExportJobFormat)} optionList={meta.formats.filter(f => initial.formats.includes(f)).map(f => ({ value: f, label: f.toUpperCase() }))} style={{ width: 180 }} />
      {meta.columns.length > 0 && <>
        <Space><Typography.Text strong>字段与顺序（{columns.length}/{meta.columns.length}）</Typography.Text><Button theme="borderless" onClick={() => setColumns(meta.columns.map(c => c.key))}>恢复默认</Button><Button theme="borderless" onClick={() => setColumns([])}>清空</Button></Space>
        {meta.columns.filter(c => !columns.includes(c.key)).map(c => <Checkbox key={c.key} checked={false} onChange={() => setColumns(old => [...old, c.key])}>{c.header}{c.sensitive ? ' · 敏感' : ''}</Checkbox>)}
        {columns.map((key, index) => { const column = meta.columns.find(c => c.key === key); return <Space key={key}>
          <Checkbox checked onChange={() => setColumns(old => old.filter(k => k !== key))}>{column?.header ?? key}{column?.sensitive ? ' · 敏感' : ''}</Checkbox>
          <Button aria-label={'上移字段 ' + key} icon={<ArrowUp size={13} />} size="small" theme="borderless" disabled={index === 0} onClick={() => move(index, -1)} />
          <Button aria-label={'下移字段 ' + key} icon={<ArrowDown size={13} />} size="small" theme="borderless" disabled={index === columns.length - 1} onClick={() => move(index, 1)} />
        </Space>; })}
      </>}
      <Typography.Text strong>数据保护</Typography.Text>
      {meta.canExportRaw ? <Checkbox checked={raw} onChange={e => setRaw(!!e.target.checked)}>明文导出（需要独立权限）</Checkbox> : <Typography.Text>默认按字段策略脱敏，当前账号没有明文导出权限</Typography.Text>}
      {raw && selectedSensitive && <Banner type="warning" description="所选字段包含敏感数据，文件按明文模式生成并记录审计。" closeIcon={null} />}
      {format === 'xlsx' && <Checkbox checked={watermark} onChange={e => setWatermark(!!e.target.checked)}>包含导出元信息（不会写入原始敏感筛选值）</Checkbox>}
      <Banner type="info" closeIcon={null} description={'预计 ' + (scope === 'filtered' ? meta.estimatedRows ?? '后台计算' : rowIds?.length ?? 0) + ' 条；单次上限 ' + meta.maxRows + ' 条。完成后保留 ' + meta.retentionDays + ' 天。超出同步预算自动后台执行，可在任务托盘与导出中心跟踪。'} />
      <Typography.Text strong>数据样例（最多 3 条，点击更新预览应用配置）</Typography.Text>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{meta.sample.length ? JSON.stringify(meta.sample, null, 2) : '该规格不提供即时样例，提交后在后台生成完整结果。'}</Typography.Paragraph>
    </Space>}
  </SideSheet>;
}

