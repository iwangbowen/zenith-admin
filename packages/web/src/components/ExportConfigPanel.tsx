import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { confirmAndDelete } from '@/components/list-page/deleteAction';
import { Banner, Button, Checkbox, Collapse, Input, InputNumber, Radio, RadioGroup, SideSheet, Space, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { EXPORT_SCOPE_LABELS, type ExportJobFormat, type ExportJobRequestMode, type ExportPreview, type ExportScope } from '@zenith/shared/tasks';
import { useExportPreview } from '@/hooks/queries/export-jobs';
import { useExportJobRunner } from '@/hooks/useExportJobRunner';
import { useExportPresets, useSaveExportPreset, useDeleteExportPreset } from '@/hooks/queries/export-presets';
import { usePermission } from '@/hooks/usePermission';
import { resolveExportPreset } from '@/utils/export-configuration';
import './export-config-panel.css';
const CronBuilderPopover = lazy(() => import('@/components/CronBuilderPopover').then(module => ({ default: module.CronBuilderPopover })));
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
  const requestKeys = useRef(new Map<string, string>());
  const [presetName, setPresetName] = useState('');
  const [cron, setCron] = useState('');
  const [shared, setShared] = useState(false);
  const [splitRows, setSplitRows] = useState(0);
  const presets = useExportPresets();
  const savePreset = useSaveExportPreset();
  const deletePreset = useDeleteExportPreset();
  const { hasPermission } = usePermission();
  const preview = useExportPreview();
  const { mutateAsync } = preview;
  const runner = useExportJobRunner();
  const initialized = useRef(false);
  const [verifiedSpec, setVerifiedSpec] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const rowIds = scope === 'selected' ? initial.selectedIds : scope === 'page' ? initial.pageIds : undefined;
  const spec = { entity: initial.entity, query: initial.query, format, columns: meta?.supportsColumns && columns.length ? columns : undefined, scope, rowIds, raw, watermark, splitRows, executionMode: initial.executionMode };
  const specKey = JSON.stringify(spec);
  const [debouncedSpec] = useDebouncedValue(specKey, { wait: 250 });
  const currentPreview = verifiedSpec === specKey;
  useEffect(() => {
    let active = true;
    void mutateAsync({ body: JSON.parse(debouncedSpec) }).then(result => {
      if (!active) return;
      if (!initialized.current) {
        initialized.current = true;
        setColumns(result.supportsColumns ? result.columns.map(c => c.key) : []);
        setFormat(initial.formats.find(f => result.formats.includes(f)) ?? result.formats[0]);
      }
      setMeta(result); setError(null); setVerifiedSpec(debouncedSpec);
    }).catch(e => { if (active) { setVerifiedSpec(null); setError(e instanceof Error ? e.message : '预检失败'); } });
    return () => { active = false; };
  }, [debouncedSpec, refresh, mutateAsync, initial.formats]);
  const selectedSensitive = meta?.columns.some(c => c.sensitive && columns.includes(c.key));
  const move = (index: number, offset: number) => setColumns(old => { const next = [...old]; const target = index + offset; if (target < 0 || target >= next.length) return old; [next[index], next[target]] = [next[target], next[index]]; return next; });
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const key = JSON.stringify(spec);
      const requestKey = requestKeys.current.get(key) ?? crypto.randomUUID();
      requestKeys.current.set(key, requestKey);
      await runner.runExport({ ...spec, idempotencyKey: requestKey }); onClose();
    }
    catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setBusy(false); }
  };
  const entityPresets = (presets.data ?? []).filter(p => p.entity === initial.entity);
  const filterCount = Object.keys(initial.query).length;
  return <SideSheet title="导出配置" visible onCancel={() => { if (!busy) onClose(); }} maskClosable={!busy} width={640} className="export-config-sheet" footer={<div className="export-config-footer"><Button onClick={onClose} disabled={busy}>取消</Button><Button type="primary" theme="solid" onClick={() => void submit()} loading={busy} disabled={!meta || !currentPreview || (meta.supportsColumns && meta.columns.length > 0 && columns.length === 0) || (scope !== 'filtered' && !rowIds?.length)}>开始导出</Button></div>}>
    {error && <Banner type="danger" description={error} closeIcon={null} />}
    {!meta ? error ? <Button onClick={() => setRefresh(value => value + 1)}>重试预检</Button> : <Spin tip="正在校验权限和导出规格" /> : <div className="export-config-content">
      <div className="export-config-overview">
        <Typography.Title heading={5} style={{ margin: 0 }}>{meta.title}</Typography.Title>
        <Typography.Text type="tertiary">{!currentPreview ? '正在校验当前配置…' : '预计 ' + (meta.estimatedRows ?? '后台计算') + ' 条'} · {raw ? '明文导出' : '默认脱敏'} · 保留 {meta.retentionDays} 天</Typography.Text>
      </div>
      {raw && selectedSensitive && <Banner type="warning" description="所选字段包含敏感数据，文件按明文模式生成并记录审计。" closeIcon={null} />}
      {meta.supportsColumns && meta.columns.length > 0 && !columns.length && <Banner type="warning" closeIcon={null} description="请在「字段与顺序」中至少选择一个字段。" />}
      <div className="export-config-section">
      <Typography.Text strong>数据范围</Typography.Text>
      <RadioGroup value={scope} direction="vertical" onChange={e => setScope(e.target.value as ExportScope)}>
        <Radio value="filtered">{EXPORT_SCOPE_LABELS.filtered}</Radio>
        {meta.supportsRowScope && !!initial.pageIds?.length && <Radio value="page">{EXPORT_SCOPE_LABELS.page}（{initial.pageIds.length} 条）</Radio>}
        {meta.supportsRowScope && !!initial.selectedIds?.length && <Radio value="selected">{EXPORT_SCOPE_LABELS.selected}（{initial.selectedIds.length} 条）</Radio>}
      </RadioGroup>
      </div>
      <div className="export-config-section">
      <Typography.Text strong>文件格式</Typography.Text>
      <RadioGroup aria-label="导出格式" type="button" buttonSize="middle" value={format} onChange={e => setFormat(e.target.value as ExportJobFormat)}>
        {meta.formats.filter(f => initial.formats.includes(f)).map(f => <Radio key={f} value={f}>{f.toUpperCase()}</Radio>)}
      </RadioGroup>
      </div>
      <Collapse defaultActiveKey={[]} className="export-config-options">
      {meta.supportsColumns && meta.columns.length > 0 && <Collapse.Panel itemKey="columns" header={<span className="export-config-heading"><span>字段与顺序</span><span className="export-config-summary">已选 {columns.length}/{meta.columns.length}</span></span>}>
        <Space><Button size="small" theme="borderless" onClick={() => setColumns(meta.columns.map(c => c.key))}>恢复默认</Button><Button size="small" theme="borderless" onClick={() => setColumns([])}>清空</Button></Space>
        <div className="export-config-fields">
        {meta.columns.filter(c => !columns.includes(c.key)).map(c => <Checkbox key={c.key} checked={false} onChange={() => setColumns(old => [...old, c.key])}>{c.header}{c.sensitive ? ' · 敏感' : ''}</Checkbox>)}
        {columns.map((key, index) => { const column = meta.columns.find(c => c.key === key); return <div key={key} className="export-config-field">
          <Checkbox checked onChange={() => setColumns(old => old.filter(k => k !== key))}>{column?.header ?? key}{column?.sensitive ? ' · 敏感' : ''}</Checkbox>
          <Space spacing={0}>
          <Button aria-label={'上移字段 ' + key} icon={<ArrowUp size={13} />} size="small" theme="borderless" disabled={index === 0} onClick={() => move(index, -1)} />
          <Button aria-label={'下移字段 ' + key} icon={<ArrowDown size={13} />} size="small" theme="borderless" disabled={index === columns.length - 1} onClick={() => move(index, 1)} />
          </Space>
        </div>; })}
        </div>
      </Collapse.Panel>}
      <Collapse.Panel itemKey="preview" header={<span className="export-config-heading"><span>数据预览与筛选</span><span className="export-config-summary">{filterCount ? filterCount + ' 项筛选' : '无额外筛选'} · 最多 3 条</span></span>}>
        <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
      <Typography.Text strong>已生效的筛选条件</Typography.Text>
      <Typography.Paragraph className="export-config-code">{filterCount ? JSON.stringify(initial.query, null, 2) : '未设置额外筛选条件'}</Typography.Paragraph>
        <Button size="small" onClick={() => setRefresh(value => value + 1)} loading={preview.isPending}>刷新预览</Button>
      <Typography.Paragraph className="export-config-code">{!currentPreview ? '正在更新当前规格的预览…' : meta.sample.length ? JSON.stringify(meta.sample, null, 2) : '该规格不提供即时样例，提交后在后台生成完整结果。'}</Typography.Paragraph>
        </Space>
      </Collapse.Panel>
      <Collapse.Panel itemKey="advanced" header={<span className="export-config-heading"><span>高级设置</span><span className="export-config-summary">{raw ? '明文' : '脱敏'} · {splitRows ? '每卷 ' + splitRows + ' 行' : '单文件'}</span></span>}>
        <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
      {meta.canExportRaw ? <Checkbox checked={raw} onChange={e => setRaw(!!e.target.checked)}>明文导出（需要独立权限）</Checkbox> : <Typography.Text>默认按字段策略脱敏，当前账号没有明文导出权限</Typography.Text>}
      {format === 'xlsx' && <Checkbox checked={watermark} onChange={e => setWatermark(!!e.target.checked)}>包含导出元信息（不会写入原始敏感筛选值）</Checkbox>}
      {meta.supportsPartition && (format === 'csv' || format === 'xlsx') && <Space wrap>
        <Typography.Text>每卷行数（0 为单文件）</Typography.Text>
        <InputNumber aria-label="每卷行数" min={0} max={50000} step={1000} value={splitRows} onChange={value => setSplitRows(typeof value === 'number' ? value : 0)} />
      </Space>}
        <Typography.Text type="tertiary" size="small">单次上限 {meta.maxRows} 条，超出同步预算自动后台执行。分卷生成 ZIP 和校验清单。</Typography.Text>
        </Space>
      </Collapse.Panel>
      <Collapse.Panel itemKey="presets" header={<span className="export-config-heading"><span>模板与定时导出</span><span className="export-config-summary">{entityPresets.length ? entityPresets.length + ' 个模板' : '可选'}</span></span>}>
        <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
      {entityPresets.map(p => <div key={p.id} className="export-config-preset"><Space wrap>
        <Button onClick={() => { try { const next = resolveExportPreset(p, meta, initial.formats); setColumns(next.columns); setFormat(next.format); setError(null); } catch (e) { setError(e instanceof Error ? e.message : '模板不可用'); } }}>{p.shared ? '团队 · ' : ''}{p.name}</Button>
        {p.canManage && <Button theme="borderless" type="danger" loading={deletePreset.isPending} onClick={() => confirmAndDelete({ title: '删除导出模板', content: p.cron ? '删除后停止后续定时生成，已生成任务仍保留。' : '确认删除此导出模板？', run: () => deletePreset.mutateAsync({ params: { id: p.id } }), successMessage: '模板已删除' })}>删除</Button>}
      </Space><Typography.Text type="tertiary" size="small">{p.cron ? '定时：' + p.cron + '；下次：' + p.nextRunAt : '手动模板'}</Typography.Text>{p.lastError && <Typography.Text type="danger">{p.lastError}</Typography.Text>}</div>)}
      <Input aria-label="模板名称" value={presetName} onChange={setPresetName} placeholder="模板名称" />
      {hasPermission('system:export-preset:share') && <Checkbox checked={shared} onChange={e => setShared(!!e.target.checked)}>作为本租户团队模板</Checkbox>}
      {hasPermission('system:export-preset:schedule') && <Input aria-label="定时表达式" value={cron} onChange={setCron} addonAfter={<Suspense fallback={null}><CronBuilderPopover value={cron ? '0 ' + cron : ''} onApply={expression => { const fields = expression.trim().split(/\s+/u); if (fields.length === 6 && fields[0] === '0') { setCron(fields.slice(1).join(' ')); setError(null); } else setError('定时导出精度为分钟，请将秒字段设为0'); }} /></Suspense>} placeholder="可选：例如 0 9 * * 1，每周一9点生成（上海时区）" />}
      <Typography.Text type="tertiary" size="small">模板应用字段与格式，保留本页筛选；定时任务使用保存时的筛选条件，脱敏生成并通知创建人。</Typography.Text>
      <Button loading={savePreset.isPending} disabled={!currentPreview || !presetName.trim() || (meta.supportsColumns && meta.columns.length > 0 && !columns.length)} onClick={() => void savePreset.mutateAsync({ body: { name: presetName, entity: initial.entity, format, columns: meta.supportsColumns && columns.length ? columns : undefined, query: initial.query, shared, cron: cron.trim() || null } }).then(() => { Toast.success('模板已保存；定时结果通过导出通知查看'); setPresetName(''); }).catch(e => setError(e instanceof Error ? e.message : '保存失败'))}>保存模板</Button>
        </Space>
      </Collapse.Panel>
      </Collapse>
    </div>}
  </SideSheet>;
}
