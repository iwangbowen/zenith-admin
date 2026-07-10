import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Divider, Empty, Input, InputNumber, Modal, Select, Space, Spin, Switch, Tabs, Tag, TextArea, Toast, Tooltip, Typography,
} from '@douyinfe/semi-ui';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import type { IWorkbookData } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import { ArrowLeft, Eye, PanelRightOpen, Plus, RefreshCcw, Save, Settings2, Trash2 } from 'lucide-react';
import '@univerjs/preset-sheets-core/lib/index.css';
import '../report-grid.css';
import { usePermission } from '@/hooks/usePermission';
import { useThemeController } from '@/providers/theme-controller';
import AppModal from '@/components/AppModal';
import PrintReportView from '../PrintReportView';
import ReportParamDialog from '@/components/ReportParamDialog';
import { buildReportParamInitialValues } from '@/components/report-param-utils';
import { printContentToUniver, univerToPrintContent } from './print-univer';
import { useReportDesignerDatasets } from '@/hooks/queries/report-designer';
import { useReportDatasetDetail } from '@/hooks/queries/report-datasets';
import {
  useRenderReportPrintTemplate,
  useReportPrintTemplateDetail,
  useSaveReportPrintTemplate,
} from '@/hooks/queries/report-print';
import { REPORT_FIELD_TYPE_OPTIONS } from '@zenith/shared';
import type {
  ReportDataset,
  ReportDatasetParam,
  ReportFieldType,
  ReportPrintContent,
  ReportPrintPageConfig,
  ReportPrintRenderResult,
  ReportPrintSheet,
  ReportPrintTemplate,
  UpdateReportPrintTemplateInput,
} from '@zenith/shared';
import { useDictItems } from '@/hooks/useDictItems';

type UniverBundle = ReturnType<typeof createUniver>;
type PanelKey = 'fields' | 'params' | 'page';

const PARAM_TYPE_OPTIONS = REPORT_FIELD_TYPE_OPTIONS;
const PAPER_OPTIONS = [
  { value: 'A4', label: 'A4' },
  { value: 'A3', label: 'A3' },
  { value: 'A5', label: 'A5' },
  { value: 'Letter', label: 'Letter' },
];
const DEFAULT_MARGIN = { top: 12, right: 12, bottom: 12, left: 12 };
const DEFAULT_PAGE_CONFIG: ReportPrintPageConfig = {
  paper: 'A4',
  orientation: 'portrait',
  margin: DEFAULT_MARGIN,
  detailDirection: 'vertical',
  calculateRowsPerPage: true,
};
const EMPTY_DATASETS: ReportDataset[] = [];
const AGGREGATIONS = ['SUM', 'COUNT', 'AVG', 'MAX', 'MIN'] as const;

function parseDefaultValue(param: ReportDatasetParam): ReportDatasetParam['defaultValue'] {
  if (param.defaultValue === '' || param.defaultValue === undefined) return undefined;
  if (param.type === 'number') {
    const num = Number(param.defaultValue);
    return Number.isFinite(num) ? num : undefined;
  }
  if (param.type === 'boolean') return param.defaultValue === true || param.defaultValue === 'true';
  return param.defaultValue;
}

function normalizeParams(params: ReportDatasetParam[]) {
  return params
    .map((param) => ({
      ...param,
      name: param.name.trim(),
      label: param.label.trim() || param.name.trim(),
      defaultValue: parseDefaultValue(param),
    }))
    .filter((param) => param.name || param.label);
}

function normalizePageConfig(config?: ReportPrintPageConfig): ReportPrintPageConfig {
  return {
    ...DEFAULT_PAGE_CONFIG,
    ...(config ?? {}),
    margin: { ...DEFAULT_MARGIN, ...(config?.margin ?? {}) },
  };
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function RangeInputs({
  label,
  range,
  onChange,
}: Readonly<{
  label: string;
  range: { start: number; end: number } | null | undefined;
  onChange: (range: { start: number; end: number } | null) => void;
}>) {
  return (
    <Field label={label}>
      <Space wrap>
        <InputNumber
          prefix="起"
          min={0}
          value={range?.start}
          placeholder="模板行"
          style={{ width: 150 }}
          onChange={(value) => onChange(value == null ? null : { start: Number(value), end: range?.end ?? Number(value) })}
        />
        <InputNumber
          prefix="止"
          min={range?.start ?? 0}
          value={range?.end}
          placeholder="模板行"
          style={{ width: 150 }}
          onChange={(value) => onChange(value == null ? null : { start: range?.start ?? Number(value), end: Number(value) })}
        />
      </Space>
      <Typography.Text type="tertiary" size="small">模板行号按 0 开始。</Typography.Text>
    </Field>
  );
}

export default function PrintDesignerPage() {
  const { items: statusItems } = useDictItems('common_status');
  const routeParams = useParams<{ id: string }>();
  const templateId = Number(routeParams.id);
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canSave = hasPermission('report:print:update');
  const { isDark } = useThemeController();

  const containerRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<UniverBundle | null>(null);
  const univerAPIRef = useRef<UniverBundle['univerAPI'] | null>(null);
  const seededTemplateId = useRef<number | null>(null);

  const [template, setTemplate] = useState<ReportPrintTemplate | null>(null);
  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [status, setStatus] = useState<ReportPrintTemplate['status']>('enabled');
  const [remark, setRemark] = useState('');
  const [params, setParams] = useState<ReportDatasetParam[]>([]);
  const [sheetConfigs, setSheetConfigs] = useState<ReportPrintSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [panelVisible, setPanelVisible] = useState(true);
  const [activePanel, setActivePanel] = useState<PanelKey>('fields');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewResult, setPreviewResult] = useState<ReportPrintRenderResult | null>(null);
  const [previewParams, setPreviewParams] = useState<Record<string, unknown>>({});
  const [paramDialogVisible, setParamDialogVisible] = useState(false);
  const [workbookSeed, setWorkbookSeed] = useState<Partial<IWorkbookData> | null>(null);

  const templateQuery = useReportPrintTemplateDetail(templateId, !!templateId);
  const selectedDatasetDetailQuery = useReportDatasetDetail(datasetId ?? undefined, !!datasetId);
  const datasetsQuery = useReportDesignerDatasets(
    selectedDatasetDetailQuery.data
      ? { id: selectedDatasetDetailQuery.data.id, name: selectedDatasetDetailQuery.data.name, status: selectedDatasetDetailQuery.data.status }
      : (template?.datasetId ? { id: template.datasetId, name: template.datasetName ?? `#${template.datasetId}`, status: 'enabled' } : null),
  );
  const saveMutation = useSaveReportPrintTemplate();
  const renderMutation = useRenderReportPrintTemplate();
  const datasets = datasetsQuery.data ?? EMPTY_DATASETS;
  const selectedDataset = selectedDatasetDetailQuery.data ?? null;
  const activeSheet = useMemo(() => sheetConfigs.find((sheet) => sheet.id === activeSheetId) ?? sheetConfigs[0] ?? null, [activeSheetId, sheetConfigs]);
  const activePageConfig = activeSheet?.pageConfig ?? DEFAULT_PAGE_CONFIG;

  useEffect(() => {
    seededTemplateId.current = null;
  }, [templateId]);

  useEffect(() => {
    const tpl = templateQuery.data;
    if (!tpl || seededTemplateId.current === tpl.id) return;
    seededTemplateId.current = tpl.id;
    setTemplate(tpl);
    setName(tpl.name);
    setDatasetId(tpl.datasetId ?? null);
    setStatus(tpl.status);
    setRemark(tpl.remark ?? '');
    setParams(tpl.params ?? []);
    const workbook = tpl.content?.workbook as IWorkbookData | undefined;
    const content = workbook ? univerToPrintContent(workbook) : tpl.content;
    const sheets = (content.sheets?.length ? content.sheets : [{
      id: 'sheet-01',
      name: 'Sheet1',
      grid: content.grid ?? { rows: 20, cols: 8, cells: [] },
      pageConfig: tpl.pageConfig,
    }]).map((sheet) => ({ ...sheet, pageConfig: normalizePageConfig(sheet.pageConfig ?? tpl.pageConfig) }));
    setSheetConfigs(sheets);
    setActiveSheetId(sheets[0]?.id ?? null);
    setWorkbookSeed(workbook ?? printContentToUniver({ grid: content.grid, sheets }, tpl.name));
  }, [templateQuery.data]);

  useEffect(() => {
    if (!selectedDatasetDetailQuery.data) return;
    if (selectedDatasetDetailQuery.data.id !== datasetId) return;
    setParams((prev) => prev.length ? prev : (selectedDatasetDetailQuery.data?.params ?? []));
  }, [datasetId, selectedDatasetDetailQuery.data]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !workbookSeed) return;
    bundleRef.current?.univer.dispose();
    const bundle = createUniver({
      locale: LocaleType.ZH_CN,
      darkMode: isDark,
      locales: { [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN) },
      presets: [
        UniverSheetsCorePreset({
          container,
          header: true,
          toolbar: true,
          formulaBar: true,
          contextMenu: true,
          footer: { sheetBar: true, statisticBar: true, zoomSlider: true },
        }),
      ],
    });
    bundleRef.current = bundle;
    univerAPIRef.current = bundle.univerAPI;
    const workbook = bundle.univerAPI.createWorkbook(workbookSeed);
    workbook.setEditable(true);
    setActiveSheetId(workbook.getActiveSheet()?.getSheetId() ?? null);
    return () => {
      bundle.univer.dispose();
      if (bundleRef.current === bundle) {
        bundleRef.current = null;
        univerAPIRef.current = null;
      }
    };
  }, [workbookSeed, isDark]);

  const insertText = useCallback((text: string) => {
    const workbook = univerAPIRef.current?.getActiveWorkbook();
    const range = workbook?.getActiveRange() ?? workbook?.getActiveSheet().getActiveRange() ?? workbook?.getActiveSheet().getRange(0, 0);
    if (!range) {
      Toast.warning('请先选择一个单元格');
      return;
    }
    range.setValueForCell(text);
  }, []);

  const extractSnapshot = useCallback(() => {
    const workbook = univerAPIRef.current?.getActiveWorkbook();
    if (!workbook) {
      Toast.error('设计器尚未初始化');
      return null;
    }
    const snapshot = workbook.save() as IWorkbookData;
    sheetConfigs.forEach((sheet) => {
      const target = snapshot.sheets?.[sheet.id] as { custom?: { printPageConfig?: ReportPrintPageConfig } } | undefined;
      if (target) target.custom = { ...(target.custom ?? {}), printPageConfig: sheet.pageConfig };
    });
    const content = univerToPrintContent(snapshot);
    const mergedSheets = (content.sheets ?? []).map((sheet) => ({
      ...sheet,
      pageConfig: normalizePageConfig(sheetConfigs.find((item) => item.id === sheet.id)?.pageConfig ?? sheet.pageConfig),
    }));
    return {
      snapshot,
      content: {
        ...content,
        sheets: mergedSheets,
        grid: mergedSheets[0]?.grid ?? content.grid,
      } satisfies ReportPrintContent,
    };
  }, [sheetConfigs]);

  const syncSheetsFromWorkbook = useCallback(() => {
    const extracted = extractSnapshot();
    if (!extracted) return;
    setSheetConfigs(extracted.content.sheets ?? []);
    setActiveSheetId((current) => current && extracted.content.sheets?.some((sheet) => sheet.id === current) ? current : (extracted.content.sheets?.[0]?.id ?? null));
    Toast.success('已同步页签配置');
  }, [extractSnapshot]);

  const saveTemplate = useCallback(async (options?: { toast?: boolean }) => {
    const extracted = extractSnapshot();
    if (!extracted) return null;
    const normalizedParams = normalizeParams(params);
    if (normalizedParams.some((param) => !param.name || !param.label)) {
      Toast.error('请完整填写参数名称和标签');
      return null;
    }
    try {
      const firstSheetPageConfig = extracted.content.sheets?.[0]?.pageConfig ?? DEFAULT_PAGE_CONFIG;
      const payload = {
        name: name.trim(),
        datasetId,
        content: extracted.content,
        params: normalizedParams,
        pageConfig: firstSheetPageConfig,
        status,
        remark: remark || undefined,
      } satisfies UpdateReportPrintTemplateInput;
      const saved = await saveMutation.mutateAsync({ id: templateId, values: payload });
      setTemplate(saved);
      setParams(saved.params ?? normalizedParams);
      setSheetConfigs((saved.content.sheets ?? []).map((sheet) => ({ ...sheet, pageConfig: normalizePageConfig(sheet.pageConfig ?? saved.pageConfig) })));
      if (options?.toast !== false) Toast.success('已保存');
      return saved;
    } catch {
      return null;
    }
  }, [datasetId, extractSnapshot, name, params, remark, saveMutation, status, templateId]);

  async function handlePreview() {
    const saved = await saveTemplate({ toast: false });
    if (!saved) return;
    setPreviewParams(buildReportParamInitialValues(saved.params ?? []));
    setParamDialogVisible(true);
  }

  async function handlePreviewSubmit(values: Record<string, unknown>) {
    setParamDialogVisible(false);
    setPreviewVisible(true);
    setPreviewResult(null);
    setPreviewParams(values);
    const result = await renderMutation.mutateAsync({ id: templateId, params: values, limit: 300 });
    setPreviewResult(result);
  }

  function updateParam(index: number, patch: Partial<ReportDatasetParam>) {
    setParams((prev) => prev.map((param, currentIndex) => (currentIndex === index ? { ...param, ...patch } : param)));
  }

  function handleDatasetChange(value: unknown) {
    const nextId = value ? Number(value) : null;
    setDatasetId(nextId);
    if (!nextId) {
      setParams([]);
      return;
    }
    const dataset = selectedDatasetDetailQuery.data;
    if (dataset && dataset.id === nextId) setParams(dataset.params ?? []);
  }

  function patchActiveSheetConfig(patch: Partial<ReportPrintPageConfig>) {
    setSheetConfigs((prev) => prev.map((sheet) => sheet.id === activeSheet?.id ? { ...sheet, pageConfig: normalizePageConfig({ ...(sheet.pageConfig ?? {}), ...patch }) } : sheet));
  }

  function patchMargin(key: keyof NonNullable<ReportPrintPageConfig['margin']>, value: unknown) {
    const margin = { ...DEFAULT_MARGIN, ...(activePageConfig.margin ?? {}) };
    patchActiveSheetConfig({ margin: { ...margin, [key]: typeof value === 'number' ? value : 0 } });
  }

  if ((!!templateId && templateQuery.isPending) || datasetsQuery.isPending) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  return (
    <div className="report-designer">
      <div className="report-designer__topbar">
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/report/print')}>返回</Button>
        <Input value={name} onChange={setName} placeholder="模板名称" style={{ width: 220 }} showClear />
        <Select
          value={datasetId ?? undefined}
          onChange={handleDatasetChange}
          placeholder="选择数据集"
          optionList={datasets.map((dataset) => ({ value: dataset.id, label: dataset.name }))}
          showClear
          style={{ width: 220 }}
        />
        <Select
          value={status}
          onChange={(value) => setStatus((value as ReportPrintTemplate['status']) ?? 'enabled')}
          optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))}
          style={{ width: 110 }}
        />
        <div style={{ flex: 1 }} />
        <Tooltip content="同步当前页签配置">
          <Button icon={<RefreshCcw size={14} />} onClick={syncSheetsFromWorkbook}>同步页签</Button>
        </Tooltip>
        <Tooltip content="字段面板">
          <Button icon={<PanelRightOpen size={14} />} onClick={() => setPanelVisible((value) => !value)}>{panelVisible ? '隐藏字段' : '显示字段'}</Button>
        </Tooltip>
        <Button icon={<Settings2 size={14} />} onClick={() => { setPanelVisible(true); setActivePanel('params'); }}>参数</Button>
        <Button icon={<Settings2 size={14} />} onClick={() => { setPanelVisible(true); setActivePanel('page'); }}>页面设置</Button>
        <Button icon={<Eye size={14} />} onClick={() => void handlePreview()}>预览</Button>
        <Button type="primary" icon={<Save size={14} />} loading={saveMutation.isPending} disabled={!canSave} onClick={() => void saveTemplate()}>保存</Button>
      </div>

      <div className="report-designer__main">
        <div className="report-designer__canvas" style={{ padding: 0 }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 560 }} />
        </div>

        {panelVisible && (
          <div className="report-designer__config" style={{ width: 380 }}>
            <Tabs activeKey={activePanel} onChange={(key) => setActivePanel(key as PanelKey)} type="line" size="small">
              <Tabs.TabPane tab="字段" itemKey="fields">
                <Typography.Title heading={6} style={{ marginTop: 0 }}>字段插入</Typography.Title>
                <Typography.Text type="tertiary" size="small">
                  支持明细、标量、总计、组小计、页小计，以及二维码 / Code128 条码表达式。
                </Typography.Text>
                <Divider margin={12} />
                {selectedDataset?.fields?.length ? (
                  <Space vertical align="start" style={{ width: '100%' }}>
                    {selectedDataset.fields.map((field) => (
                      <div key={field.name} style={{ width: '100%', padding: '8px 0', borderBottom: '1px solid var(--semi-color-border)' }}>
                        <Space wrap style={{ marginBottom: 6 }}>
                          <Tag size="small">{field.type}</Tag>
                          <Typography.Text strong>{field.label || field.name}</Typography.Text>
                          <Typography.Text type="tertiary" size="small">{field.name}</Typography.Text>
                        </Space>
                        <Space wrap>
                          <Button size="small" onClick={() => insertText(`\${${field.name}}`)}>明细</Button>
                          <Button size="small" onClick={() => insertText(`#{${field.name}}`)}>标量</Button>
                          <Button size="small" theme="borderless" onClick={() => insertText(`\${QRCODE(${field.name})}`)}>二维码</Button>
                          <Button size="small" theme="borderless" onClick={() => insertText(`\${CODE128(${field.name})}`)}>条码</Button>
                          {AGGREGATIONS.map((fn) => (
                            <Button key={fn} size="small" theme="borderless" onClick={() => insertText(`\${${fn}(${field.name})}`)}>{fn}</Button>
                          ))}
                        </Space>
                      </div>
                    ))}
                  </Space>
                ) : (
                  <Empty description={datasetId ? '当前数据集没有字段' : '请先绑定数据集'} />
                )}
                <Divider margin={12} />
                <Typography.Title heading={6}>参数表达式</Typography.Title>
                <Space wrap>
                  {params.map((param) => (
                    <Button key={param.name} size="small" onClick={() => insertText(`\${${param.name}}`)}>{param.label || param.name}</Button>
                  ))}
                </Space>
                <Divider margin={12} />
                <Typography.Title heading={6}>语法速查</Typography.Title>
                <Typography.Paragraph size="small" spacing="extended" style={{ color: 'var(--semi-color-text-2)' }}>
                  ${'{field}'}：明细；#{'{field}'}：标量；${'{SUM(field)}'}：总计；${'{GROUP_SUM(field)}'}：组小计；${'{PAGE_SUM(field)}'}：页小计；${'{QRCODE(field)}'} / ${'{CODE128(field)}'}：二维码 / 条码。
                </Typography.Paragraph>
              </Tabs.TabPane>

              <Tabs.TabPane tab="参数" itemKey="params">
                <Space style={{ marginBottom: 12 }}>
                  <Button size="small" icon={<Plus size={14} />} onClick={() => setParams((prev) => [...prev, { name: '', label: '', type: 'string' }])}>添加参数</Button>
                  {template?.datasetName && <Typography.Text type="tertiary" size="small">数据集：{template.datasetName}</Typography.Text>}
                </Space>
                {params.length === 0 ? <Empty description="暂无参数" /> : (
                  <Space vertical align="start" style={{ width: '100%' }}>
                    {params.map((param, index) => (
                      <div key={`${param.name}-${index}`} style={{ width: '100%', padding: 10, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                        <Space vertical align="start" style={{ width: '100%' }}>
                          <Input placeholder="参数名，如 startDate" value={param.name} onChange={(value) => updateParam(index, { name: value })} showClear />
                          <Input placeholder="显示名" value={param.label} onChange={(value) => updateParam(index, { label: value })} showClear />
                          <Select value={param.type} optionList={PARAM_TYPE_OPTIONS} onChange={(value) => updateParam(index, { type: value as ReportFieldType })} style={{ width: '100%' }} />
                          <Input placeholder="默认值" value={param.defaultValue == null ? '' : String(param.defaultValue)} onChange={(value) => updateParam(index, { defaultValue: value })} showClear />
                          <Space>
                            <Switch checked={!!param.required} onChange={(checked) => updateParam(index, { required: checked })} size="small" />
                            <Typography.Text size="small">必填</Typography.Text>
                            <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={() => setParams((prev) => prev.filter((_, currentIndex) => currentIndex !== index))}>删除</Button>
                          </Space>
                        </Space>
                      </div>
                    ))}
                  </Space>
                )}
              </Tabs.TabPane>

              <Tabs.TabPane tab="页面" itemKey="page">
                <Field label="当前页签">
                  <Select
                    value={activeSheetId ?? undefined}
                    optionList={sheetConfigs.map((sheet) => ({ value: sheet.id, label: sheet.name }))}
                    onChange={(value) => setActiveSheetId((value as string) ?? null)}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Field label="纸张">
                  <Select value={activePageConfig.paper ?? 'A4'} optionList={PAPER_OPTIONS} onChange={(value) => patchActiveSheetConfig({ paper: value as ReportPrintPageConfig['paper'] })} style={{ width: '100%' }} />
                </Field>
                <Field label="方向">
                  <Select
                    value={activePageConfig.orientation ?? 'portrait'}
                    optionList={[{ value: 'portrait', label: '纵向' }, { value: 'landscape', label: '横向' }]}
                    onChange={(value) => patchActiveSheetConfig({ orientation: value as ReportPrintPageConfig['orientation'] })}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Field label="页边距（mm）">
                  <Space wrap>
                    <InputNumber prefix="上" value={activePageConfig.margin?.top ?? 12} min={0} onChange={(value) => patchMargin('top', value)} style={{ width: 150 }} />
                    <InputNumber prefix="右" value={activePageConfig.margin?.right ?? 12} min={0} onChange={(value) => patchMargin('right', value)} style={{ width: 150 }} />
                    <InputNumber prefix="下" value={activePageConfig.margin?.bottom ?? 12} min={0} onChange={(value) => patchMargin('bottom', value)} style={{ width: 150 }} />
                    <InputNumber prefix="左" value={activePageConfig.margin?.left ?? 12} min={0} onChange={(value) => patchMargin('left', value)} style={{ width: 150 }} />
                  </Space>
                </Field>
                <Field label="页眉">
                  <Input value={activePageConfig.header ?? ''} onChange={(value) => patchActiveSheetConfig({ header: value || undefined })} showClear placeholder="支持 ${param}、{date}、{page}/{pages}" />
                </Field>
                <Field label="页脚">
                  <Input value={activePageConfig.footer ?? ''} onChange={(value) => patchActiveSheetConfig({ footer: value || undefined })} showClear />
                </Field>
                <Field label="背景图 URL">
                  <Input value={activePageConfig.backgroundImage ?? ''} onChange={(value) => patchActiveSheetConfig({ backgroundImage: value || undefined })} showClear />
                </Field>
                <Field label="明细方向">
                  <Select
                    value={activePageConfig.detailDirection ?? 'vertical'}
                    optionList={[{ value: 'vertical', label: '纵向明细' }, { value: 'horizontal', label: '横向扩列' }]}
                    onChange={(value) => patchActiveSheetConfig({ detailDirection: value as ReportPrintPageConfig['detailDirection'] })}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Field label="固定每页行数">
                  <InputNumber value={activePageConfig.rowsPerPage ?? undefined} min={1} max={10000} style={{ width: '100%' }} onChange={(value) => patchActiveSheetConfig({ rowsPerPage: value == null ? undefined : Number(value) })} />
                </Field>
                <Field label="自动按纸张分页">
                  <Switch checked={!!activePageConfig.calculateRowsPerPage} onChange={(checked) => patchActiveSheetConfig({ calculateRowsPerPage: checked })} size="small" />
                </Field>
                <Field label="强制分页行">
                  <Input
                    value={(activePageConfig.pageBreaks ?? []).join(',')}
                    onChange={(value) => patchActiveSheetConfig({ pageBreaks: value ? value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0) : undefined })}
                    showClear
                    placeholder="例如 20,40（正文逻辑行，1 开始）"
                  />
                </Field>
                <Field label="分组字段">
                  <Input
                    value={(activePageConfig.groupByFields ?? []).join(',')}
                    onChange={(value) => patchActiveSheetConfig({ groupByFields: value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined })}
                    showClear
                    placeholder="例如 deptCode,category"
                  />
                </Field>
                <RangeInputs label="重复表头" range={activePageConfig.repeatHeaderRows} onChange={(range) => patchActiveSheetConfig({ repeatHeaderRows: range })} />
                <RangeInputs label="组头模板行" range={activePageConfig.groupHeaderRows} onChange={(range) => patchActiveSheetConfig({ groupHeaderRows: range })} />
                <RangeInputs label="组尾 / 组小计" range={activePageConfig.groupFooterRows} onChange={(range) => patchActiveSheetConfig({ groupFooterRows: range })} />
                <RangeInputs label="页小计" range={activePageConfig.pageSubtotalRows} onChange={(range) => patchActiveSheetConfig({ pageSubtotalRows: range })} />
                <RangeInputs label="总计" range={activePageConfig.totalRows} onChange={(range) => patchActiveSheetConfig({ totalRows: range })} />
                <Field label="备注">
                  <TextArea value={remark} onChange={setRemark} maxCount={256} autosize={{ minRows: 2, maxRows: 4 }} />
                </Field>
              </Tabs.TabPane>
            </Tabs>
          </div>
        )}
      </div>

      <ReportParamDialog
        visible={paramDialogVisible}
        title="预览参数"
        params={params}
        initialValues={previewParams}
        loading={renderMutation.isPending}
        confirmText="生成预览"
        onCancel={() => setParamDialogVisible(false)}
        onSubmit={(values) => void handlePreviewSubmit(values)}
      />

      <AppModal
        title="打印预览"
        visible={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width="92vw"
        style={{ maxWidth: 1180 }}
      >
        {renderMutation.isPending && <div style={{ padding: 32, textAlign: 'center' }}>正在生成预览...</div>}
        {!renderMutation.isPending && previewResult && <PrintReportView result={previewResult} params={previewParams} />}
        {!renderMutation.isPending && !previewResult && <div style={{ padding: 32, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>暂无预览内容</div>}
      </AppModal>

      <Modal
        visible={!canSave}
        title="只读提示"
        footer={<Button onClick={() => navigate('/report/print')}>返回列表</Button>}
        onCancel={() => navigate('/report/print')}
        closeOnEsc
      >
        当前账号没有打印模板设计权限。
      </Modal>
    </div>
  );
}
