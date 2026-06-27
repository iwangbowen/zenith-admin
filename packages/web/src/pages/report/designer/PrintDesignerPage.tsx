import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Divider, Empty, Input, InputNumber, Modal, Select, Space, Spin, Switch, Tabs, Tag, TextArea, Toast, Tooltip, Typography,
} from '@douyinfe/semi-ui';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import type { IWorkbookData } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import { ArrowLeft, Eye, PanelRightOpen, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import '@univerjs/preset-sheets-core/lib/index.css';
import '../report-grid.css';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { useThemeController } from '@/providers/theme-controller';
import AppModal from '@/components/AppModal';
import PrintReportView from '../PrintReportView';
import { createBlankWorkbook, gridToUniver, univerToGrid } from './print-univer';
import type {
  PaginatedResponse,
  ReportDataset,
  ReportDatasetParam,
  ReportFieldType,
  ReportPrintPageConfig,
  ReportPrintRenderResult,
  ReportPrintTemplate,
  UpdateReportPrintTemplateInput,
} from '@zenith/shared';

type UniverBundle = ReturnType<typeof createUniver>;
type PanelKey = 'fields' | 'params' | 'page';

const PARAM_TYPE_OPTIONS = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'boolean', label: '布尔' },
];

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
};

const AGGREGATIONS = ['SUM', 'COUNT', 'AVG', 'MAX', 'MIN'] as const;

function parseDefaultValue(param: ReportDatasetParam): ReportDatasetParam['defaultValue'] {
  if (param.defaultValue === '' || param.defaultValue === undefined) return undefined;
  if (param.type === 'number') {
    const n = Number(param.defaultValue);
    return Number.isFinite(n) ? n : undefined;
  }
  if (param.type === 'boolean') return param.defaultValue === true || param.defaultValue === 'true';
  return param.defaultValue;
}

function normalizeParams(params: ReportDatasetParam[]) {
  return params
    .map((param) => ({
      ...param,
      name: param.name.trim(),
      label: param.label.trim(),
      defaultValue: parseDefaultValue(param),
    }))
    .filter((param) => param.name || param.label);
}

function defaultRenderParams(params: ReportDatasetParam[]) {
  const values: Record<string, unknown> = {};
  params.forEach((param) => {
    const value = parseDefaultValue(param);
    if (value !== undefined) values[param.name] = value;
  });
  return values;
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

export default function PrintDesignerPage() {
  const routeParams = useParams<{ id: string }>();
  const templateId = Number(routeParams.id);
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canSave = hasPermission('report:print:update');
  const { isDark } = useThemeController();

  const containerRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<UniverBundle | null>(null);
  const univerAPIRef = useRef<UniverBundle['univerAPI'] | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<ReportPrintTemplate | null>(null);
  const [datasets, setDatasets] = useState<ReportDataset[]>([]);
  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [status, setStatus] = useState<ReportPrintTemplate['status']>('enabled');
  const [remark, setRemark] = useState('');
  const [params, setParams] = useState<ReportDatasetParam[]>([]);
  const [pageConfig, setPageConfig] = useState<ReportPrintPageConfig>(DEFAULT_PAGE_CONFIG);
  const [panelVisible, setPanelVisible] = useState(true);
  const [activePanel, setActivePanel] = useState<PanelKey>('fields');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<ReportPrintRenderResult | null>(null);
  const [workbookSeed, setWorkbookSeed] = useState<Partial<IWorkbookData> | null>(null);

  const selectedDataset = useMemo(() => datasets.find((d) => d.id === datasetId) ?? null, [datasetId, datasets]);

  useEffect(() => {
    if (!templateId) return;
    setLoading(true);
    Promise.all([
      request.get<ReportPrintTemplate>(`/api/report/print/${templateId}`),
      request.get<PaginatedResponse<ReportDataset>>('/api/report/datasets?page=1&pageSize=200'),
    ]).then(([tplRes, dsRes]) => {
      if (tplRes.code === 0) {
        const tpl = tplRes.data;
        setTemplate(tpl);
        setName(tpl.name);
        setDatasetId(tpl.datasetId ?? null);
        setStatus(tpl.status);
        setRemark(tpl.remark ?? '');
        setParams(tpl.params ?? []);
        setPageConfig({ ...DEFAULT_PAGE_CONFIG, ...(tpl.pageConfig ?? {}), margin: { ...DEFAULT_MARGIN, ...(tpl.pageConfig?.margin ?? {}) } });
        const workbook = tpl.content?.workbook as Partial<IWorkbookData> | undefined;
        setWorkbookSeed(workbook ?? (tpl.content?.grid ? gridToUniver(tpl.content.grid, tpl.name) : createBlankWorkbook(tpl.name)));
      } else {
        Toast.error(tplRes.message || '加载模板失败');
      }
      if (dsRes.code === 0) {
        const list = dsRes.data.list.filter((d) => d.status === 'enabled' || d.id === tplRes.data?.datasetId);
        setDatasets(list);
      }
    }).finally(() => setLoading(false));
  }, [templateId]);

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
    const snapshot = workbook.save();
    return { snapshot, grid: univerToGrid(snapshot) };
  }, []);

  const saveTemplate = useCallback(async (options?: { toast?: boolean }) => {
    const extracted = extractSnapshot();
    if (!extracted) return null;
    const normalizedParams = normalizeParams(params);
    const invalidParam = normalizedParams.some((param) => !param.name || !param.label);
    if (invalidParam) {
      Toast.error('请完整填写参数名称和标签');
      return null;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        datasetId,
        content: { workbook: extracted.snapshot, grid: extracted.grid },
        params: normalizedParams,
        pageConfig,
        status,
        remark: remark || undefined,
      } satisfies UpdateReportPrintTemplateInput;
      const res = await request.put<ReportPrintTemplate>(`/api/report/print/${templateId}`, payload);
      if (res.code === 0) {
        setTemplate(res.data);
        setParams(res.data.params ?? normalizedParams);
        if (options?.toast !== false) Toast.success('已保存');
        return res.data;
      }
      Toast.error(res.message || '保存失败');
      return null;
    } finally {
      setSaving(false);
    }
  }, [datasetId, extractSnapshot, name, pageConfig, params, remark, status, templateId]);

  async function handlePreview() {
    const saved = await saveTemplate({ toast: false });
    if (!saved) return;
    const renderParams = defaultRenderParams(saved.params ?? []);
    setPreviewVisible(true);
    setPreviewResult(null);
    setPreviewLoading(true);
    try {
      const res = await request.post<ReportPrintRenderResult>(`/api/report/print/${templateId}/render`, { params: renderParams, limit: 100 }, { silent: true });
      if (res.code === 0) setPreviewResult(res.data);
      else Toast.error(res.message || '预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }

  function updateParam(index: number, patch: Partial<ReportDatasetParam>) {
    setParams((prev) => prev.map((param, i) => (i === index ? { ...param, ...patch } : param)));
  }

  function handleDatasetChange(value: unknown) {
    const nextId = value ? Number(value) : null;
    setDatasetId(nextId);
    const ds = datasets.find((item) => item.id === nextId);
    if (ds) setParams(ds.params ?? []);
  }

  function patchPageConfig(patch: Partial<ReportPrintPageConfig>) {
    setPageConfig((prev) => ({ ...prev, ...patch }));
  }

  function patchMargin(key: keyof NonNullable<ReportPrintPageConfig['margin']>, value: unknown) {
    const margin = { ...DEFAULT_MARGIN, ...(pageConfig.margin ?? {}) };
    setPageConfig((prev) => ({ ...prev, margin: { ...margin, [key]: typeof value === 'number' ? value : 0 } }));
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;

  return (
    <div className="report-designer">
      <div className="report-designer__topbar">
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/report/print')}>返回</Button>
        <Input value={name} onChange={setName} placeholder="模板名称" style={{ width: 220 }} showClear />
        <Select
          value={datasetId ?? undefined}
          onChange={handleDatasetChange}
          placeholder="选择数据集"
          optionList={datasets.map((d) => ({ value: d.id, label: d.name }))}
          showClear
          style={{ width: 220 }}
        />
        <Select
          value={status}
          onChange={(v) => setStatus((v as ReportPrintTemplate['status']) ?? 'enabled')}
          optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]}
          style={{ width: 110 }}
        />
        <div style={{ flex: 1 }} />
        <Tooltip content="字段面板">
          <Button icon={<PanelRightOpen size={14} />} onClick={() => setPanelVisible((v) => !v)}>{panelVisible ? '隐藏字段' : '显示字段'}</Button>
        </Tooltip>
        <Button icon={<Settings2 size={14} />} onClick={() => { setPanelVisible(true); setActivePanel('params'); }}>参数</Button>
        <Button icon={<Settings2 size={14} />} onClick={() => { setPanelVisible(true); setActivePanel('page'); }}>页面设置</Button>
        <Button icon={<Eye size={14} />} onClick={() => void handlePreview()}>预览</Button>
        <Button type="primary" icon={<Save size={14} />} loading={saving} disabled={!canSave} onClick={() => void saveTemplate()}>保存</Button>
      </div>

      <div className="report-designer__main">
        <div className="report-designer__canvas" style={{ padding: 0 }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 560 }} />
        </div>

        {panelVisible && (
          <div className="report-designer__config" style={{ width: 360 }}>
            <Tabs activeKey={activePanel} onChange={(key) => setActivePanel(key as PanelKey)} type="line" size="small">
              <Tabs.TabPane tab="字段" itemKey="fields">
                <Typography.Title heading={6} style={{ marginTop: 0 }}>字段插入</Typography.Title>
                <Typography.Text type="tertiary" size="small">
                  点击字段写入当前单元格。${'{field}'} 为明细纵向扩展；#{'{field}'} 为标量；聚合函数为标量。
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
                  ${'{field}'}：明细字段/参数；#{'{field}'}：首行标量；${'{SUM(field)}'}、${'{COUNT(field)}'}、${'{AVG(field)}'}、${'{MAX(field)}'}、${'{MIN(field)}'}：聚合；支持“前缀${'{field}'}后缀”混合文本。
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
                      <div key={`${param.name}-${index}`} style={{ width: '100%', padding: 10, border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
                        <Space vertical align="start" style={{ width: '100%' }}>
                          <Input placeholder="参数名，如 startDate" value={param.name} onChange={(v) => updateParam(index, { name: v })} showClear />
                          <Input placeholder="显示名" value={param.label} onChange={(v) => updateParam(index, { label: v })} showClear />
                          <Select value={param.type} optionList={PARAM_TYPE_OPTIONS} onChange={(v) => updateParam(index, { type: v as ReportFieldType })} style={{ width: '100%' }} />
                          <Input
                            placeholder="默认值"
                            value={param.defaultValue == null ? '' : String(param.defaultValue)}
                            onChange={(v) => updateParam(index, { defaultValue: v })}
                            showClear
                          />
                          <Space>
                            <Switch checked={!!param.required} onChange={(checked) => updateParam(index, { required: checked })} size="small" />
                            <Typography.Text size="small">必填</Typography.Text>
                            <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={() => setParams((prev) => prev.filter((_, i) => i !== index))}>删除</Button>
                          </Space>
                        </Space>
                      </div>
                    ))}
                  </Space>
                )}
              </Tabs.TabPane>

              <Tabs.TabPane tab="页面" itemKey="page">
                <Field label="纸张">
                  <Select value={pageConfig.paper ?? 'A4'} optionList={PAPER_OPTIONS} onChange={(v) => patchPageConfig({ paper: v as ReportPrintPageConfig['paper'] })} style={{ width: '100%' }} />
                </Field>
                <Field label="方向">
                  <Select
                    value={pageConfig.orientation ?? 'portrait'}
                    optionList={[{ value: 'portrait', label: '纵向' }, { value: 'landscape', label: '横向' }]}
                    onChange={(v) => patchPageConfig({ orientation: v as ReportPrintPageConfig['orientation'] })}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Field label="页边距（mm）">
                  <Space wrap>
                    <InputNumber prefix="上" value={pageConfig.margin?.top ?? 12} min={0} onChange={(v) => patchMargin('top', v)} style={{ width: 150 }} />
                    <InputNumber prefix="右" value={pageConfig.margin?.right ?? 12} min={0} onChange={(v) => patchMargin('right', v)} style={{ width: 150 }} />
                    <InputNumber prefix="下" value={pageConfig.margin?.bottom ?? 12} min={0} onChange={(v) => patchMargin('bottom', v)} style={{ width: 150 }} />
                    <InputNumber prefix="左" value={pageConfig.margin?.left ?? 12} min={0} onChange={(v) => patchMargin('left', v)} style={{ width: 150 }} />
                  </Space>
                </Field>
                <Field label="页眉">
                  <Input value={pageConfig.header ?? ''} onChange={(v) => patchPageConfig({ header: v || undefined })} showClear placeholder="支持 ${param}、{date}、{page}/{pages}" />
                </Field>
                <Field label="页脚">
                  <Input value={pageConfig.footer ?? ''} onChange={(v) => patchPageConfig({ footer: v || undefined })} showClear />
                </Field>
                <Field label="套打背景图 URL">
                  <Input value={pageConfig.backgroundImage ?? ''} onChange={(v) => patchPageConfig({ backgroundImage: v || undefined })} showClear />
                </Field>
                <Field label="备注">
                  <TextArea value={remark} onChange={setRemark} maxCount={256} autosize={{ minRows: 2, maxRows: 4 }} />
                </Field>
              </Tabs.TabPane>
            </Tabs>
          </div>
        )}
      </div>

      <AppModal
        title="打印预览"
        visible={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width="92vw"
        style={{ maxWidth: 1180 }}
      >
        {previewLoading && <div style={{ padding: 32, textAlign: 'center' }}>正在生成预览...</div>}
        {!previewLoading && previewResult && <PrintReportView result={previewResult} params={defaultRenderParams(params)} />}
        {!previewLoading && !previewResult && <div style={{ padding: 32, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>暂无预览内容</div>}
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
