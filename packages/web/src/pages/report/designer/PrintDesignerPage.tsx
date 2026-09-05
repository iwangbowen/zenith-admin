import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Divider, Empty, Input, InputNumber, Modal, Select, Space, Switch, Tabs, Tag, TextArea, Toast, Tooltip, Typography,
} from '@douyinfe/semi-ui';
import PageLoading from '@/components/PageLoading';
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
import { reportDatasetKeys, useReportDatasetDetail } from '@/hooks/queries/report-datasets';
import {
  reportPrintKeys,
  useRenderReportPrintTemplate,
  useReportPrintTemplateLookup,
  useReportPrintTemplateDetail,
  useSaveReportPrintTemplate,
} from '@/hooks/queries/report-print';
import { REPORT_FIELD_TYPE_OPTIONS, reportDatasetContract, reportPrintContract } from '@zenith/shared/report';
import type { ReportDataset, ReportDatasetParam, ReportFieldType, ReportPrintContent, ReportPrintCrosstabConfig, ReportPrintDatasetBinding, ReportPrintPageConfig, ReportPrintRenderResult, ReportPrintSheet, ReportPrintTemplate, UpdateReportPrintTemplateInput } from '@zenith/shared/report';
import { useDictItems } from '@/hooks/useDictItems';
import { api } from '@/lib/contract-query';

type UniverBundle = ReturnType<typeof createUniver>;
type PanelKey = 'fields' | 'params' | 'bindings' | 'blocks' | 'page';
type EditableWorkbookSnapshot = IWorkbookData & {
  custom?: { printDatasetBindings?: ReportPrintDatasetBinding[] };
};
type EditableSheetSnapshot = {
  custom?: {
    printPageConfig?: ReportPrintPageConfig;
    printDatasetKey?: string;
    printRepeatBlocks?: ReportPrintSheet['repeatBlocks'];
  };
};

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
const CROSSTAB_AGGREGATE_OPTIONS = AGGREGATIONS.map((value) => ({ value: value.toLowerCase(), label: value }));

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
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const canSave = hasPermission('report:print:update');
  const { isDark } = useThemeController();

  // 用 callback ref 存入 state：容器随查询加载状态延迟渲染，普通 ref 不会重跑挂载 effect，
  // 冷加载（详情/数据集查询未缓存）时 Univer 将永远不初始化
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const bundleRef = useRef<UniverBundle | null>(null);
  const univerAPIRef = useRef<UniverBundle['univerAPI'] | null>(null);
  const seededTemplateId = useRef<number | null>(null);

  const [template, setTemplate] = useState<ReportPrintTemplate | null>(null);
  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [status, setStatus] = useState<ReportPrintTemplate['status']>('enabled');
  const [remark, setRemark] = useState('');
  const [params, setParams] = useState<ReportDatasetParam[]>([]);
  const [datasetBindings, setDatasetBindings] = useState<ReportPrintDatasetBinding[]>([]);
  const [sheetConfigs, setSheetConfigs] = useState<ReportPrintSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [panelVisible, setPanelVisible] = useState(true);
  const [activePanel, setActivePanel] = useState<PanelKey>('fields');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewResult, setPreviewResult] = useState<ReportPrintRenderResult | null>(null);
  const [previewParams, setPreviewParams] = useState<Record<string, unknown>>({});
  const [paramDialogVisible, setParamDialogVisible] = useState(false);
  const [workbookSeed, setWorkbookSeed] = useState<Partial<IWorkbookData> | null>(null);
  const [selectedBindingIndex, setSelectedBindingIndex] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedCellDatasetKey, setSelectedCellDatasetKey] = useState('');
  const [selectedSubreportTemplateId, setSelectedSubreportTemplateId] = useState<number | null>(null);
  const [subreportParamBindings, setSubreportParamBindings] = useState<Record<string, string>>({});

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
  const configuredCrosstab = activePageConfig.crosstab ?? { rowFields: [], columnFields: [], valueFields: [] };
  const activeCrosstab: ReportPrintCrosstabConfig = configuredCrosstab.valueFields?.length || !configuredCrosstab.valueField || !configuredCrosstab.aggregate
    ? configuredCrosstab
    : {
        ...configuredCrosstab,
        valueFields: [{ field: configuredCrosstab.valueField, aggregate: configuredCrosstab.aggregate, label: configuredCrosstab.valueField }],
      };
  const selectedBinding = datasetBindings[selectedBindingIndex] ?? null;
  const activeDatasetId = activeSheet?.datasetKey
    ? datasetBindings.find((binding) => binding.key === activeSheet.datasetKey)?.datasetId
    : datasetId;
  const activeDatasetDetailQuery = useReportDatasetDetail(activeDatasetId ?? undefined, !!activeDatasetId);
  const bindingDatasetDetailQuery = useReportDatasetDetail(selectedBinding?.datasetId, !!selectedBinding?.datasetId);
  const selectedParentBinding = selectedBinding?.parentKey && selectedBinding.parentKey !== 'main'
    ? datasetBindings.find((binding) => binding.key === selectedBinding.parentKey)
    : null;
  const parentDatasetDetailQuery = useReportDatasetDetail(
    selectedBinding?.parentKey === 'main' ? (datasetId ?? undefined) : selectedParentBinding?.datasetId,
    !!selectedBinding?.parentKey,
  );
  const printTemplatesQuery = useReportPrintTemplateLookup({ status: 'enabled', limit: 50 });
  const subreportTemplateQuery = useReportPrintTemplateDetail(selectedSubreportTemplateId ?? undefined, !!selectedSubreportTemplateId);
  const activeDataset = activeDatasetDetailQuery.data ?? (activeDatasetId === datasetId ? selectedDataset : null);
  const activeFields = activeDataset?.fields ?? [];
  const activeFieldOptions = activeFields.map((field) => ({ value: field.name, label: field.label ? `${field.label} (${field.name})` : field.name }));

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
    setDatasetBindings(content.datasetBindings ?? []);
    setSelectedBindingIndex(0);
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
    if (!containerEl || !workbookSeed) return;
    bundleRef.current?.univer.dispose();
    const bundle = createUniver({
      locale: LocaleType.ZH_CN,
      darkMode: isDark,
      locales: { [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN) },
      presets: [
        UniverSheetsCorePreset({
          container: containerEl,
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
  }, [containerEl, workbookSeed, isDark]);

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
      const target = snapshot.sheets?.[sheet.id] as EditableSheetSnapshot | undefined;
      if (!target) return;
      const custom = { ...(target.custom ?? {}), printPageConfig: sheet.pageConfig };
      if (sheet.datasetKey) custom.printDatasetKey = sheet.datasetKey;
      else delete custom.printDatasetKey;
      if (sheet.repeatBlocks?.length) custom.printRepeatBlocks = sheet.repeatBlocks;
      else delete custom.printRepeatBlocks;
      target.custom = custom;
    });
    const editableSnapshot = snapshot as EditableWorkbookSnapshot;
    editableSnapshot.custom = {
      ...(editableSnapshot.custom ?? {}),
      printDatasetBindings: datasetBindings.length ? datasetBindings : undefined,
    };
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
  }, [datasetBindings, sheetConfigs]);

  const syncSheetsFromWorkbook = useCallback(() => {
    const extracted = extractSnapshot();
    if (!extracted) return;
    setSheetConfigs(extracted.content.sheets ?? []);
    setActiveSheetId((current) => current && extracted.content.sheets?.some((sheet) => sheet.id === current) ? current : (extracted.content.sheets?.[0]?.id ?? null));
    Toast.success('已同步页签配置');
  }, [extractSnapshot]);

  const validateAdvancedConfig = useCallback(async (content: ReportPrintContent, normalizedParams: ReportDatasetParam[]) => {
    const normalizedKeys = datasetBindings.map((binding) => binding.key.trim().toLowerCase());
    if (normalizedKeys.some((key) => !key || key === 'main' || key.startsWith('__'))) {
      Toast.error('数据集绑定 key 不能为空，且不能使用 main 或 __ 开头的保留名称');
      return false;
    }
    if (new Set(normalizedKeys).size !== normalizedKeys.length) {
      Toast.error('数据集绑定 key 不能重复（不区分大小写）');
      return false;
    }
    const bindingByKey = new Map(datasetBindings.map((binding) => [binding.key.toLowerCase(), binding]));
    for (const sheet of content.sheets ?? []) {
      const sheetKey = sheet.datasetKey?.toLowerCase();
      if (sheetKey && sheetKey !== 'main' && !bindingByKey.has(sheetKey)) {
        Toast.error(`页签「${sheet.name}」引用了不存在的数据集绑定 ${sheet.datasetKey}`);
        return false;
      }
      for (const block of sheet.repeatBlocks ?? []) {
        const blockKey = block.datasetKey.toLowerCase();
        if (blockKey !== 'main' && !bindingByKey.has(blockKey)) {
          Toast.error(`重复块「${block.id}」引用了不存在的数据集绑定 ${block.datasetKey}`);
          return false;
        }
      }
      for (const cell of sheet.grid.cells) {
        for (const key of [cell.datasetKey, cell.subreport?.datasetKey]) {
          const normalizedKey = key?.toLowerCase();
          if (normalizedKey && normalizedKey !== 'main' && !bindingByKey.has(normalizedKey)) {
            Toast.error(`页签「${sheet.name}」的单元格引用了不存在的数据集绑定 ${key}`);
            return false;
          }
        }
      }
    }

    const datasetIds = [...new Set([
      ...(datasetId ? [datasetId] : []),
      ...datasetBindings.map((binding) => binding.datasetId),
    ])];
    const details = await Promise.all(datasetIds.map((id) => queryClient.ensureQueryData({
      queryKey: reportDatasetKeys.detail(id),
      queryFn: () => api(reportDatasetContract.detail, { params: { id } }),
    })));
    const detailsById = new Map(details.map((detail) => [detail.id, detail]));
    const sourceParamNames = new Set(normalizedParams.map((param) => param.name));
    for (const binding of datasetBindings) {
      const detail = detailsById.get(binding.datasetId);
      if (!detail) {
        Toast.error(`无法读取数据集绑定 ${binding.key}`);
        return false;
      }
      const targetParamNames = new Set((detail.params ?? []).map((param) => param.name));
      const invalidTarget = [...Object.keys(binding.params ?? {}), ...Object.keys(binding.paramBindings ?? {})]
        .find((name) => !targetParamNames.has(name));
      const invalidSource = Object.values(binding.paramBindings ?? {}).find((name) => !sourceParamNames.has(name));
      if (invalidTarget || invalidSource) {
        Toast.error(`数据集绑定 ${binding.key} 的参数映射必须使用已声明参数`);
        return false;
      }
    }

    const subreportCells = (content.sheets ?? []).flatMap((sheet) => sheet.grid.cells.filter((cell) => cell.subreport));
    const subreportIds = [...new Set(subreportCells.map((cell) => cell.subreport!.templateId))];
    const subreportTemplates = await Promise.all(subreportIds.map((id) => queryClient.ensureQueryData({
      queryKey: reportPrintKeys.detail(id),
      queryFn: () => api(reportPrintContract.detail, { params: { id } }),
    })));
    const subreportById = new Map(subreportTemplates.map((item) => [item.id, item]));
    for (const cell of subreportCells) {
      const subreport = cell.subreport!;
      const targetNames = new Set((subreportById.get(subreport.templateId)?.params ?? []).map((param) => param.name));
      const invalidTarget = Object.keys(subreport.paramBindings ?? {}).find((name) => !targetNames.has(name));
      const invalidSource = Object.values(subreport.paramBindings ?? {}).find((name) => !sourceParamNames.has(name));
      if (invalidTarget || invalidSource) {
        Toast.error(`子报表 #${subreport.templateId} 的参数映射必须使用父子模板已声明参数`);
        return false;
      }
    }

    for (const sheet of content.sheets ?? []) {
      if (sheet.pageConfig?.detailDirection !== 'crosstab' || !sheet.pageConfig.crosstab) continue;
      const binding = sheet.datasetKey ? bindingByKey.get(sheet.datasetKey.toLowerCase()) : null;
      const detail = detailsById.get(binding?.datasetId ?? datasetId ?? 0);
      const fieldNames = new Set((detail?.fields ?? []).map((field) => field.name));
      const crosstab = sheet.pageConfig.crosstab;
      const referencedFields = [
        ...crosstab.rowFields,
        ...crosstab.columnFields,
        ...(crosstab.valueFields?.map((value) => value.field) ?? (crosstab.valueField ? [crosstab.valueField] : [])),
      ];
      if (!detail || referencedFields.some((field) => !fieldNames.has(field))) {
        Toast.error(`页签「${sheet.name}」的交叉表字段不属于所绑定的数据集`);
        return false;
      }
      const valueFieldCount = crosstab.valueFields?.length ?? (crosstab.valueField ? 1 : 0);
      if (!crosstab.rowFields.length || !crosstab.columnFields.length || valueFieldCount === 0) {
        Toast.error(`页签「${sheet.name}」的交叉表需配置行、列和指标字段`);
        return false;
      }
    }
    return true;
  }, [datasetBindings, datasetId, queryClient]);

  const saveTemplate = useCallback(async (options?: { toast?: boolean }) => {
    const extracted = extractSnapshot();
    if (!extracted) return null;
    const normalizedParams = normalizeParams(params);
    if (normalizedParams.some((param) => !param.name || !param.label)) {
      Toast.error('请完整填写参数名称和标签');
      return null;
    }
    try {
      if (!await validateAdvancedConfig(extracted.content, normalizedParams)) return null;
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
  }, [datasetId, extractSnapshot, name, params, remark, saveMutation, status, templateId, validateAdvancedConfig]);

  async function handlePreview() {
    const saved = await saveTemplate({ toast: false });
    if (!saved) return;
    // 无参数模板直接生成预览，跳过参数弹窗
    if ((saved.params ?? []).length === 0) {
      await handlePreviewSubmit({});
      return;
    }
    setPreviewParams(buildReportParamInitialValues(saved.params ?? []));
    setParamDialogVisible(true);
  }

  async function handlePreviewSubmit(values: Record<string, unknown>) {
    setParamDialogVisible(false);
    setPreviewVisible(true);
    setPreviewResult(null);
    setPreviewParams(values);
    const result = await renderMutation.mutateAsync({ params: { id: templateId }, body: { params: values, limit: 300 } });
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

  function patchActiveSheet(patch: Partial<ReportPrintSheet>) {
    setSheetConfigs((prev) => prev.map((sheet) => sheet.id === activeSheet?.id ? { ...sheet, ...patch } : sheet));
  }

  function patchCrosstab(patch: Partial<ReportPrintCrosstabConfig>) {
    const current = activePageConfig.crosstab ?? { rowFields: [], columnFields: [], valueFields: [] };
    patchActiveSheetConfig({ crosstab: { ...current, ...patch } });
  }

  function addDatasetBinding() {
    if (!datasets.length) {
      Toast.warning('暂无可绑定的数据集');
      return;
    }
    const used = new Set(datasetBindings.map((binding) => binding.key.toLowerCase()));
    let index = datasetBindings.length + 1;
    while (used.has(`dataset${index}`)) index += 1;
    setDatasetBindings((prev) => [...prev, { key: `dataset${index}`, datasetId: datasets[0]?.id ?? 0, rowLimit: 300 }]);
    setSelectedBindingIndex(datasetBindings.length);
  }

  function updateDatasetBinding(index: number, patch: Partial<ReportPrintDatasetBinding>) {
    setDatasetBindings((prev) => prev.map((binding, currentIndex) => currentIndex === index ? { ...binding, ...patch } : binding));
  }

  function removeDatasetBinding(index: number) {
    const removed = datasetBindings[index];
    setDatasetBindings((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    setSelectedBindingIndex((current) => Math.max(0, Math.min(current, datasetBindings.length - 2)));
    if (removed) {
      setSheetConfigs((prev) => prev.map((sheet) => ({
        ...sheet,
        ...(sheet.datasetKey === removed.key ? { datasetKey: undefined } : {}),
        repeatBlocks: sheet.repeatBlocks?.filter((block) => block.datasetKey !== removed.key),
      })));
    }
  }

  function addRepeatBlock() {
    if (!activeSheet) return;
    const datasetKey = activeSheet.datasetKey || datasetBindings[0]?.key || 'main';
    patchActiveSheet({
      repeatBlocks: [
        ...(activeSheet.repeatBlocks ?? []),
        { id: `repeat-${crypto.randomUUID().slice(0, 8)}`, datasetKey, range: { start: 0, end: 0 } },
      ],
    });
  }

  function updateRepeatBlock(index: number, patch: Partial<NonNullable<ReportPrintSheet['repeatBlocks']>[number]>) {
    patchActiveSheet({
      repeatBlocks: (activeSheet?.repeatBlocks ?? []).map((block, currentIndex) => currentIndex === index ? { ...block, ...patch } : block),
    });
  }

  function removeRepeatBlock(index: number) {
    patchActiveSheet({ repeatBlocks: (activeSheet?.repeatBlocks ?? []).filter((_, currentIndex) => currentIndex !== index) });
  }

  function getActiveCellRange() {
    const workbook = univerAPIRef.current?.getActiveWorkbook();
    return workbook?.getActiveRange() ?? workbook?.getActiveSheet().getActiveRange() ?? null;
  }

  function readSelectedCellConfig() {
    const range = getActiveCellRange();
    if (!range) {
      Toast.warning('请先选择一个单元格');
      return;
    }
    const metadata = range.getCustomMetaData() ?? {};
    const subreport = metadata.printSubreport;
    setSelectedCell({ row: range.getRow(), col: range.getColumn() });
    setSelectedCellDatasetKey(typeof metadata.printDatasetKey === 'string' ? metadata.printDatasetKey : '');
    setSelectedSubreportTemplateId(
      subreport && typeof subreport === 'object' && typeof subreport.templateId === 'number'
        ? subreport.templateId
        : null,
    );
    setSubreportParamBindings(
      subreport && typeof subreport === 'object' && subreport.paramBindings && typeof subreport.paramBindings === 'object'
        ? subreport.paramBindings
        : {},
    );
  }

  function applySelectedCellConfig(withSubreport: boolean) {
    const range = getActiveCellRange();
    if (!range) {
      Toast.warning('请先选择一个单元格');
      return;
    }
    if (withSubreport && !selectedSubreportTemplateId) {
      Toast.warning('请选择子报表模板');
      return;
    }
    const metadata = { ...(range.getCustomMetaData() ?? {}) };
    if (selectedCellDatasetKey) metadata.printDatasetKey = selectedCellDatasetKey;
    else delete metadata.printDatasetKey;
    if (withSubreport) {
      metadata.printKind = 'subreport';
      metadata.printSubreport = {
        templateId: selectedSubreportTemplateId,
        ...(selectedCellDatasetKey ? { datasetKey: selectedCellDatasetKey } : {}),
        ...(Object.keys(subreportParamBindings).length ? { paramBindings: subreportParamBindings } : {}),
      };
    }
    range.setCustomMetaData(metadata);
    setSelectedCell({ row: range.getRow(), col: range.getColumn() });
    Toast.success(withSubreport ? '已配置子报表单元格' : '已配置单元格数据集');
  }

  function clearSelectedCellConfig() {
    const range = getActiveCellRange();
    if (!range) return;
    const metadata = { ...(range.getCustomMetaData() ?? {}) };
    delete metadata.printDatasetKey;
    delete metadata.printSubreport;
    if (metadata.printKind === 'subreport') delete metadata.printKind;
    range.setCustomMetaData(metadata);
    setSelectedCellDatasetKey('');
    setSelectedSubreportTemplateId(null);
    setSubreportParamBindings({});
    Toast.success('已清除单元格高级配置');
  }

  function patchMargin(key: keyof NonNullable<ReportPrintPageConfig['margin']>, value: unknown) {
    const margin = { ...DEFAULT_MARGIN, ...(activePageConfig.margin ?? {}) };
    patchActiveSheetConfig({ margin: { ...margin, [key]: typeof value === 'number' ? value : 0 } });
  }

  if ((!!templateId && templateQuery.isPending) || datasetsQuery.isPending) {
    return <PageLoading inline />;
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
        <Button icon={<Settings2 size={14} />} onClick={() => { setPanelVisible(true); setActivePanel('bindings'); }}>数据绑定</Button>
        <Button icon={<Settings2 size={14} />} onClick={() => { setPanelVisible(true); setActivePanel('page'); }}>页面设置</Button>
        <Button icon={<Eye size={14} />} onClick={() => void handlePreview()}>预览</Button>
        <Button type="primary" icon={<Save size={14} />} loading={saveMutation.isPending} disabled={!canSave} onClick={() => void saveTemplate()}>保存</Button>
      </div>

      <div className="report-designer__main">
        <div className="report-designer__canvas" style={{ padding: 0 }}>
          <div ref={setContainerEl} style={{ width: '100%', height: '100%', minHeight: 560 }} />
        </div>

        {panelVisible && (
          <div className="report-designer__config" style={{ width: 380 }}>
            <Tabs collapsible="auto" activeKey={activePanel} onChange={(key) => setActivePanel(key as PanelKey)} type="line" size="small">
              <Tabs.TabPane tab="字段" itemKey="fields">
                <Typography.Title heading={6} style={{ marginTop: 0 }}>字段插入</Typography.Title>
                <Typography.Text type="tertiary" size="small">
                  支持明细、标量、总计、组小计、页小计，以及二维码 / Code128 条码表达式。
                </Typography.Text>
                <Divider margin={12} />
                {activeFields.length ? (
                  <Space vertical align="start" style={{ width: '100%' }}>
                    {activeFields.map((field) => (
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
                  <Empty description={activeDatasetId ? '当前绑定数据集没有字段' : '请先绑定数据集'} />
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

              <Tabs.TabPane tab="绑定" itemKey="bindings">
                <Space style={{ marginBottom: 12 }}>
                  <Button size="small" icon={<Plus size={14} />} disabled={!datasets.length} onClick={addDatasetBinding}>添加绑定</Button>
                  <Typography.Text type="tertiary" size="small">主数据集固定使用 main</Typography.Text>
                </Space>
                {datasetBindings.length === 0 ? <Empty description="暂无附加数据集绑定" /> : (
                  <>
                    <Field label="当前绑定">
                      <Select
                        value={selectedBindingIndex}
                        optionList={datasetBindings.map((binding, index) => ({ value: index, label: `${binding.key} · #${binding.datasetId}` }))}
                        onChange={(value) => setSelectedBindingIndex(Number(value))}
                        style={{ width: '100%' }}
                      />
                    </Field>
                    {selectedBinding && (
                      <div style={{ padding: 10, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                        <Field label="绑定 key">
                          <Input
                            value={selectedBinding.key}
                            onChange={(value) => updateDatasetBinding(selectedBindingIndex, { key: value.trim() })}
                            placeholder="例如 details"
                            showClear
                          />
                        </Field>
                        <Field label="数据集">
                          <Select
                            value={selectedBinding.datasetId || undefined}
                            optionList={datasets.map((dataset) => ({ value: dataset.id, label: dataset.name }))}
                            onChange={(value) => updateDatasetBinding(selectedBindingIndex, {
                              datasetId: Number(value),
                              paramBindings: {},
                              params: undefined,
                            })}
                            style={{ width: '100%' }}
                            filter
                          />
                        </Field>
                        <Field label="单绑定行数上限">
                          <InputNumber
                            min={1}
                            max={5000}
                            value={selectedBinding.rowLimit ?? 300}
                            onChange={(value) => updateDatasetBinding(selectedBindingIndex, { rowLimit: value == null ? undefined : Number(value) })}
                            style={{ width: '100%' }}
                          />
                        </Field>
                        <Field label="父数据集（可选）">
                          <Select
                            value={selectedBinding.parentKey ?? undefined}
                            optionList={[
                              { value: 'main', label: 'main（主数据集）' },
                              ...datasetBindings
                                .filter((binding) => binding.key !== selectedBinding.key)
                                .map((binding) => ({ value: binding.key, label: binding.key })),
                            ]}
                            onChange={(value) => updateDatasetBinding(selectedBindingIndex, {
                              parentKey: (value as string) || null,
                              parentField: null,
                              childField: null,
                            })}
                            showClear
                            style={{ width: '100%' }}
                          />
                        </Field>
                        {selectedBinding.parentKey && (
                          <Space wrap style={{ width: '100%' }}>
                            <Field label="父字段">
                              <Select
                                value={selectedBinding.parentField ?? undefined}
                                optionList={(parentDatasetDetailQuery.data?.fields ?? []).map((field) => ({ value: field.name, label: field.label || field.name }))}
                                onChange={(value) => updateDatasetBinding(selectedBindingIndex, { parentField: (value as string) || null })}
                                style={{ width: 155 }}
                                showClear
                              />
                            </Field>
                            <Field label="子字段">
                              <Select
                                value={selectedBinding.childField ?? undefined}
                                optionList={(bindingDatasetDetailQuery.data?.fields ?? []).map((field) => ({ value: field.name, label: field.label || field.name }))}
                                onChange={(value) => updateDatasetBinding(selectedBindingIndex, { childField: (value as string) || null })}
                                style={{ width: 155 }}
                                showClear
                              />
                            </Field>
                          </Space>
                        )}
                        <Divider margin={10}>参数映射</Divider>
                        {(bindingDatasetDetailQuery.data?.params ?? []).length === 0 ? (
                          <Typography.Text type="tertiary" size="small">目标数据集没有声明参数。</Typography.Text>
                        ) : (
                          (bindingDatasetDetailQuery.data?.params ?? []).map((targetParam) => (
                            <Field key={targetParam.name} label={`${targetParam.label || targetParam.name} (${targetParam.name})`}>
                              <Select
                                value={selectedBinding.paramBindings?.[targetParam.name]}
                                optionList={params.filter((param) => param.name).map((param) => ({ value: param.name, label: `${param.label || param.name} (${param.name})` }))}
                                onChange={(value) => {
                                  const mappings = { ...(selectedBinding.paramBindings ?? {}) };
                                  if (value) mappings[targetParam.name] = String(value);
                                  else delete mappings[targetParam.name];
                                  updateDatasetBinding(selectedBindingIndex, { paramBindings: mappings });
                                }}
                                placeholder="选择打印模板参数"
                                showClear
                                style={{ width: '100%' }}
                              />
                            </Field>
                          ))
                        )}
                        <Button theme="borderless" type="danger" size="small" onClick={() => removeDatasetBinding(selectedBindingIndex)}>删除此绑定</Button>
                      </div>
                    )}
                  </>
                )}
              </Tabs.TabPane>

              <Tabs.TabPane tab="块/子报表" itemKey="blocks">
                <Field label="当前页签">
                  <Select
                    value={activeSheetId ?? undefined}
                    optionList={sheetConfigs.map((sheet) => ({ value: sheet.id, label: sheet.name }))}
                    onChange={(value) => setActiveSheetId((value as string) ?? null)}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Field label="页签默认数据集">
                  <Select
                    value={activeSheet?.datasetKey || 'main'}
                    optionList={[
                      { value: 'main', label: 'main（主数据集）' },
                      ...datasetBindings.map((binding) => ({ value: binding.key, label: binding.key })),
                    ]}
                    onChange={(value) => patchActiveSheet({ datasetKey: value === 'main' ? undefined : String(value) })}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Divider margin={12}>重复块</Divider>
                <Button size="small" icon={<Plus size={14} />} onClick={addRepeatBlock} style={{ marginBottom: 10 }}>添加重复块</Button>
                {(activeSheet?.repeatBlocks ?? []).map((block, index) => (
                  <div key={block.id} style={{ padding: 10, marginBottom: 10, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                    <Field label="块名称">
                      <Input value={block.id} onChange={(value) => updateRepeatBlock(index, { id: value.trim() })} />
                    </Field>
                    <Field label="数据集">
                      <Select
                        value={block.datasetKey}
                        optionList={[
                          { value: 'main', label: 'main' },
                          ...datasetBindings.map((binding) => ({ value: binding.key, label: binding.key })),
                        ]}
                        onChange={(value) => updateRepeatBlock(index, { datasetKey: String(value) })}
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <RangeInputs label="模板行范围" range={block.range} onChange={(range) => range && updateRepeatBlock(index, { range })} />
                    <Button theme="borderless" type="danger" size="small" onClick={() => removeRepeatBlock(index)}>删除</Button>
                  </div>
                ))}
                <Divider margin={12}>选中单元格</Divider>
                <Button size="small" onClick={readSelectedCellConfig}>读取当前选中单元格</Button>
                {selectedCell && (
                  <Typography.Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
                    R{selectedCell.row + 1}C{selectedCell.col + 1}
                  </Typography.Text>
                )}
                <Field label="单元格数据集">
                  <Select
                    value={selectedCellDatasetKey || 'main'}
                    optionList={[
                      { value: 'main', label: 'main' },
                      ...datasetBindings.map((binding) => ({ value: binding.key, label: binding.key })),
                    ]}
                    onChange={(value) => setSelectedCellDatasetKey(value === 'main' ? '' : String(value))}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Field label="子报表模板">
                  <Select
                    value={selectedSubreportTemplateId ?? undefined}
                    optionList={(printTemplatesQuery.data ?? [])
                      .filter((item) => item.id !== templateId)
                      .map((item) => ({ value: item.id, label: item.name }))}
                    onChange={(value) => {
                      setSelectedSubreportTemplateId(value ? Number(value) : null);
                      setSubreportParamBindings({});
                    }}
                    showClear
                    filter
                    style={{ width: '100%' }}
                  />
                </Field>
                {(subreportTemplateQuery.data?.params ?? []).map((targetParam) => (
                  <Field key={targetParam.name} label={`子报表参数：${targetParam.label || targetParam.name}`}>
                    <Select
                      value={subreportParamBindings[targetParam.name]}
                      optionList={params.filter((param) => param.name).map((param) => ({ value: param.name, label: `${param.label || param.name} (${param.name})` }))}
                      onChange={(value) => setSubreportParamBindings((prev) => {
                        const next = { ...prev };
                        if (value) next[targetParam.name] = String(value);
                        else delete next[targetParam.name];
                        return next;
                      })}
                      placeholder="选择当前模板参数"
                      showClear
                      style={{ width: '100%' }}
                    />
                  </Field>
                ))}
                <Space wrap>
                  <Button size="small" onClick={() => applySelectedCellConfig(false)}>应用数据集</Button>
                  <Button size="small" type="primary" onClick={() => applySelectedCellConfig(true)}>应用子报表</Button>
                  <Button size="small" theme="borderless" type="danger" onClick={clearSelectedCellConfig}>清除配置</Button>
                </Space>
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
                    optionList={[
                      { value: 'vertical', label: '纵向明细' },
                      { value: 'horizontal', label: '横向扩列' },
                      { value: 'crosstab', label: '交叉表 / 透视表' },
                    ]}
                    onChange={(value) => patchActiveSheetConfig({
                      detailDirection: value as ReportPrintPageConfig['detailDirection'],
                      ...(value === 'crosstab' && !activePageConfig.crosstab
                        ? { crosstab: { rowFields: [], columnFields: [], valueFields: [] } }
                        : {}),
                    })}
                    style={{ width: '100%' }}
                  />
                </Field>
                {activePageConfig.detailDirection === 'crosstab' && (
                  <div style={{ padding: 10, marginBottom: 12, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                    <Typography.Title heading={6} style={{ marginTop: 0 }}>交叉表配置</Typography.Title>
                    <Typography.Text type="tertiary" size="small">
                      字段来自当前页签绑定的数据集；动态列、单元格和内存大小由共享引擎强制限额。
                    </Typography.Text>
                    <Field label="行维度">
                      <Select
                        multiple
                        value={activeCrosstab.rowFields}
                        optionList={activeFieldOptions}
                        onChange={(value) => patchCrosstab({ rowFields: (value as string[]) ?? [] })}
                        filter
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Field label="列维度">
                      <Select
                        multiple
                        value={activeCrosstab.columnFields}
                        optionList={activeFieldOptions}
                        onChange={(value) => patchCrosstab({ columnFields: (value as string[]) ?? [] })}
                        filter
                        style={{ width: '100%' }}
                      />
                    </Field>
                    <Divider margin={10}>指标</Divider>
                    {(activeCrosstab.valueFields ?? []).map((valueField, index) => (
                      <div key={`${valueField.field}-${index}`} style={{ padding: 8, marginBottom: 8, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-small)' }}>
                        <Space vertical align="start" style={{ width: '100%' }}>
                          <Select
                            value={valueField.field}
                            optionList={activeFieldOptions}
                            onChange={(value) => patchCrosstab({
                              valueFields: (activeCrosstab.valueFields ?? []).map((item, currentIndex) =>
                                currentIndex === index ? { ...item, field: String(value) } : item),
                            })}
                            filter
                            style={{ width: '100%' }}
                          />
                          <Space wrap>
                            <Select
                              value={valueField.aggregate}
                              optionList={CROSSTAB_AGGREGATE_OPTIONS}
                              onChange={(value) => patchCrosstab({
                                valueFields: (activeCrosstab.valueFields ?? []).map((item, currentIndex) =>
                                  currentIndex === index
                                    ? { ...item, aggregate: value as NonNullable<ReportPrintCrosstabConfig['valueFields']>[number]['aggregate'] }
                                    : item),
                              })}
                              style={{ width: 110 }}
                            />
                            <Input
                              value={valueField.label ?? ''}
                              onChange={(value) => patchCrosstab({
                                valueFields: (activeCrosstab.valueFields ?? []).map((item, currentIndex) =>
                                  currentIndex === index ? { ...item, label: value || undefined } : item),
                              })}
                              placeholder="指标标签"
                              style={{ width: 140 }}
                              showClear
                            />
                            <Button
                              theme="borderless"
                              type="danger"
                              size="small"
                              onClick={() => patchCrosstab({ valueFields: (activeCrosstab.valueFields ?? []).filter((_, currentIndex) => currentIndex !== index) })}
                            >
                              删除
                            </Button>
                          </Space>
                        </Space>
                      </div>
                    ))}
                    <Button
                      size="small"
                      icon={<Plus size={14} />}
                      disabled={!activeFieldOptions.length}
                      onClick={() => patchCrosstab({
                        valueFields: [
                          ...(activeCrosstab.valueFields ?? []),
                          { field: activeFieldOptions[0]?.value ?? '', aggregate: 'sum' },
                        ],
                      })}
                    >
                      添加指标
                    </Button>
                    <Divider margin={10}>总计与模板位置</Divider>
                    <Space wrap style={{ marginBottom: 10 }}>
                      <Switch checked={!!activeCrosstab.showRowTotals} onChange={(checked) => patchCrosstab({ showRowTotals: checked })} size="small" />
                      <Typography.Text size="small">行总计</Typography.Text>
                      <Switch checked={!!activeCrosstab.showColumnTotals} onChange={(checked) => patchCrosstab({ showColumnTotals: checked })} size="small" />
                      <Typography.Text size="small">列总计</Typography.Text>
                    </Space>
                    <Space wrap>
                      <InputNumber prefix="表头行" min={0} value={activeCrosstab.headerRow} onChange={(value) => patchCrosstab({ headerRow: value == null ? undefined : Number(value) })} style={{ width: 150 }} />
                      <InputNumber prefix="数据行" min={0} value={activeCrosstab.dataRow} onChange={(value) => patchCrosstab({ dataRow: value == null ? undefined : Number(value) })} style={{ width: 150 }} />
                      <InputNumber prefix="总计行" min={0} value={activeCrosstab.totalRow} onChange={(value) => patchCrosstab({ totalRow: value == null ? undefined : Number(value) })} style={{ width: 150 }} />
                      <InputNumber prefix="起始列" min={0} value={activeCrosstab.startColumn ?? 0} onChange={(value) => patchCrosstab({ startColumn: value == null ? undefined : Number(value) })} style={{ width: 150 }} />
                    </Space>
                    <Space wrap style={{ marginTop: 10 }}>
                      <Input
                        prefix="空维度"
                        value={activeCrosstab.nullLabel ?? ''}
                        onChange={(value) => patchCrosstab({ nullLabel: value || undefined })}
                        placeholder="(空)"
                        style={{ width: 150 }}
                      />
                      <Input
                        prefix="空指标"
                        value={activeCrosstab.emptyValue == null ? '' : String(activeCrosstab.emptyValue)}
                        onChange={(value) => patchCrosstab({ emptyValue: value || null })}
                        placeholder="留空"
                        style={{ width: 150 }}
                      />
                    </Space>
                  </div>
                )}
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
