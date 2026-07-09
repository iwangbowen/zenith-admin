import { useState, useRef, useMemo } from 'react';
import { Button, Form, Input, Select, Table, Tag, Toast, Modal, Space, Typography, Empty, Switch, InputNumber, TextArea } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, Play, Upload as UploadIcon, Sparkles, Blocks } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import ExportButton from '@/components/ExportButton';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useQueryClient } from '@tanstack/react-query';
import {
  reportDatasetKeys,
  useDeleteReportDataset,
  useEnabledReportDatasources,
  useGenerateReportDatasetSql,
  useParseReportDatasetFile,
  usePreviewReportDataset,
  useRefreshReportDatasetMaterialize,
  useReportDatasetList,
  useSaveReportDataset,
} from '@/hooks/queries/report-datasets';
import type {
  ReportDataset, ReportDatasource, ReportDatasourceType, ReportField, ReportDataResult,
  ReportApiDatasetContent, ReportSqlDatasetContent, ReportComputedField,
  ReportStaticDatasetContent, ReportFieldFormat, ReportDatasetParam, ReportRowRule, ReportVisualModel,
} from '@zenith/shared';
import { useAllRoles } from '@/hooks/queries/roles';
import VisualModelBuilder from './components/VisualModelBuilder';
import DatasetRefsModal from './components/DatasetRefsModal';
import { useDictItems } from '@/hooks/useDictItems';

interface SearchParams { keyword: string; status: string }
const defaultSearchParams: SearchParams = { keyword: '', status: '' };

function isSqlAuthoringType(type: ReportDatasourceType | null) {
  return type === 'sql' || type === 'mysql' || type === 'postgresql' || type === 'sqlserver';
}

function datasourceTypeLabel(type: ReportDatasourceType) {
  if (type === 'api') return 'API';
  if (type === 'sql') return 'SQL';
  if (type === 'mysql') return 'MySQL';
  if (type === 'postgresql') return 'PostgreSQL';
  if (type === 'sqlserver') return 'SQL Server';
  return '静态';
}

function datasourceTypeTag(type: ReportDatasourceType) {
  if (type === 'api') return <Tag color="blue" size="small">API</Tag>;
  if (type === 'sql') return <Tag color="violet" size="small">SQL</Tag>;
  if (type === 'mysql') return <Tag color="cyan" size="small">MySQL</Tag>;
  if (type === 'postgresql') return <Tag color="indigo" size="small">PostgreSQL</Tag>;
  if (type === 'sqlserver') return <Tag color="orange" size="small">SQL Server</Tag>;
  return <Tag color="grey" size="small">静态</Tag>;
}

const COMPUTED_FIELD_TYPE_OPTIONS = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'boolean', label: '布尔' },
];

const FIELD_FORMAT_KIND_OPTIONS = [
  { value: '', label: '无' },
  { value: 'number', label: '数字' },
  { value: 'percent', label: '百分比' },
  { value: 'currency', label: '货币' },
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'dict', label: '字典' },
];

function inferColumns(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => set.add(key)));
  return Array.from(set);
}

function inferFieldType(rows: Record<string, unknown>[], name: string): ReportField['type'] {
  const sample = rows.find((row) => row[name] !== null && row[name] !== undefined)?.[name];
  if (typeof sample === 'number') return 'number';
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sample)) return 'date';
  return 'string';
}

function fieldsFromColumns(columns: string[], rows: Record<string, unknown>[] = []): ReportField[] {
  return columns.map((name) => ({ name, label: name, type: inferFieldType(rows, name) }));
}

export default function DatasetsPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const staticFileInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const datasourcesQuery = useEnabledReportDatasources();
  const datasources = useMemo<ReportDatasource[]>(() => datasourcesQuery.data ?? [], [datasourcesQuery.data]);
  const dsTypeMap = useMemo(() => {
    const m = new Map<number, ReportDatasourceType>();
    datasources.forEach((d) => m.set(d.id, d.type));
    return m;
  }, [datasources]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDataset | null>(null);
  const [selectedDsId, setSelectedDsId] = useState<number | null>(null);
  const [fields, setFields] = useState<ReportField[]>([]);
  const [computedFields, setComputedFields] = useState<ReportComputedField[]>([]);
  const [paramDefs, setParamDefs] = useState<ReportDatasetParam[]>([]);
  const [previewParamValues, setPreviewParamValues] = useState<Record<string, unknown>>({});
  const [rowRules, setRowRules] = useState<ReportRowRule[]>([]);
  const [visualVisible, setVisualVisible] = useState(false);
  const [visualModel, setVisualModel] = useState<ReportVisualModel | null>(null);
  const [refsTarget, setRefsTarget] = useState<ReportDataset | null>(null);
  const [materialize, setMaterialize] = useState<{ enabled: boolean; cron?: string }>({ enabled: false, cron: '' });
  const [staticJsonText, setStaticJsonText] = useState('[]');
  const [staticColumns, setStaticColumns] = useState<string[]>([]);
  const [preview, setPreview] = useState<ReportDataResult | null>(null);
  const [aiAskVisible, setAiAskVisible] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');

  const selectedType: ReportDatasourceType | null = selectedDsId ? dsTypeMap.get(selectedDsId) ?? editing?.type ?? null : null;

  const rolesQuery = useAllRoles({ enabled: modalVisible });
  const roleOptions = (rolesQuery.data ?? []).map((role) => ({ value: role.code, label: role.name }));

  const listQuery = useReportDatasetList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data ?? null;
  const saveMutation = useSaveReportDataset();
  const deleteMutation = useDeleteReportDataset();
  const previewMutation = usePreviewReportDataset();
  const parseFileMutation = useParseReportDatasetFile();
  const generateSqlMutation = useGenerateReportDatasetSql();
  const refreshMaterializeMutation = useRefreshReportDatasetMaterialize();

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: reportDatasetKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearchParams); setSubmittedParams(defaultSearchParams); setPage(1); void queryClient.invalidateQueries({ queryKey: reportDatasetKeys.lists }); }

  function resetModalExtra(ds: ReportDataset | null) {
    setSelectedDsId(ds?.datasourceId ?? null);
    setFields(ds?.fields ?? []);
    setComputedFields(ds?.computedFields ?? []);
    setParamDefs(ds?.params ?? []);
    setPreviewParamValues({});
    setRowRules(ds?.rowRules ?? []);
    setVisualVisible(false);
    setVisualModel(((ds?.content ?? {}) as ReportSqlDatasetContent).visual ?? null);
    setMaterialize({ enabled: ds?.materialize?.enabled ?? false, cron: ds?.materialize?.cron ?? '' });
    setAiAskVisible(false);
    setAiQuestion('');
    if (ds?.type === 'static') {
      const content = (ds.content ?? {}) as ReportStaticDatasetContent;
      const rows = Array.isArray(content.data) ? content.data : [];
      const columns = content.columns?.length ? content.columns : inferColumns(rows);
      setStaticJsonText(JSON.stringify(rows, null, 2));
      setStaticColumns(columns);
      setPreview(columns.length || rows.length ? { columns, rows: rows.slice(0, 50), total: rows.length } : null);
      return;
    }
    setStaticJsonText('[]');
    setStaticColumns([]);
    setPreview(null);
  }
  function openCreate() { setEditing(null); resetModalExtra(null); setModalVisible(true); }
  function openEdit(record: ReportDataset) { setEditing(record); resetModalExtra(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); setPreview(null); }

  const sqlContent = (editing?.content ?? {}) as ReportSqlDatasetContent;
  const apiContent = (editing?.content ?? {}) as ReportApiDatasetContent;
  const formInitValues = editing
    ? {
        name: editing.name,
        datasourceId: editing.datasourceId,
        sql: sqlContent.sql ?? '',
        itemsPath: apiContent.itemsPath ?? '',
        paramsText: apiContent.params ? JSON.stringify(apiContent.params, null, 2) : '',
        cacheTtl: editing.cacheTtl ?? 0,
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { status: 'enabled', cacheTtl: 0 };

  function parseStaticRows(showToast = true): Record<string, unknown>[] | null {
    try {
      const parsed = JSON.parse(staticJsonText || '[]') as unknown;
      if (!Array.isArray(parsed)) {
        if (showToast) Toast.error('静态数据必须是 JSON 数组');
        return null;
      }
      const valid = parsed.every((row) => row && typeof row === 'object' && !Array.isArray(row));
      if (!valid) {
        if (showToast) Toast.error('静态数据数组的每一项都必须是对象');
        return null;
      }
      return parsed as Record<string, unknown>[];
    } catch {
      if (showToast) Toast.error('静态数据不是合法 JSON');
      return null;
    }
  }

  function applyStaticPreview(rows: Record<string, unknown>[], columns?: string[]) {
    const cols = columns?.length ? columns : inferColumns(rows);
    setStaticColumns(cols);
    setPreview({ columns: cols, rows: rows.slice(0, 50), total: rows.length });
  }

  function handleStaticJsonBlur() {
    const rows = parseStaticRows(true);
    if (!rows) return;
    applyStaticPreview(rows);
  }

  async function handleStaticFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await parseFileMutation.mutateAsync(formData);
      setStaticJsonText(JSON.stringify(res.rows, null, 2));
      applyStaticPreview(res.rows, res.columns);
      setFields(fieldsFromColumns(res.columns, res.rows));
      Toast.success(`解析成功，共 ${res.total} 行`);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '文件解析失败');
    }
  }

  /** 根据当前表单值构造 content（按选中数据源类型）*/
  function buildContent(values: Record<string, unknown>): Record<string, unknown> | null {
    if (isSqlAuthoringType(selectedType)) {
      return { sql: String(values.sql ?? ''), ...(visualModel ? { visual: visualModel } : {}) };
    }
    if (selectedType === 'api') {
      let params: Record<string, string> | undefined;
      const txt = String(values.paramsText ?? '').trim();
      if (txt) {
        try { params = JSON.parse(txt); }
        catch { Toast.error('参数不是合法 JSON'); return null; }
      }
      return { itemsPath: String(values.itemsPath ?? '') || null, params: params ?? null };
    }
    if (selectedType === 'static') {
      const rows = parseStaticRows(true);
      if (!rows) return null;
      const inferred = inferColumns(rows);
      const columns = staticColumns.length && inferred.every((col) => staticColumns.includes(col)) ? staticColumns : inferred;
      return { data: rows, columns };
    }
    return {};
  }

  function normalizeComputedFields(): ReportComputedField[] | null {
    const list = computedFields
      .map((field) => ({
        name: field.name.trim(),
        label: field.label.trim(),
        expression: field.expression.trim(),
        type: field.type,
      }))
      .filter((field) => field.name || field.label || field.expression);
    const invalid = list.some((field) => !field.name || !field.label || !field.expression);
    if (invalid) {
      Toast.error('请完整填写计算字段的字段名、标题和表达式');
      return null;
    }
    return list;
  }

  function normalizeFields(): ReportField[] {
    return fields.map((field) => ({
      ...field,
      name: field.name.trim(),
      label: field.label.trim() || field.name.trim(),
      ...(field.format ? { format: field.format } : {}),
    }));
  }

  function normalizeParamDefs(): ReportDatasetParam[] | null {
    const list = paramDefs
      .map((p) => ({ ...p, name: p.name.trim(), label: p.label.trim() || p.name.trim() }))
      .filter((p) => p.name || p.label);
    if (list.some((p) => !p.name)) {
      Toast.error('请完整填写参数的参数名');
      return null;
    }
    if (list.some((p) => p.name.startsWith('__'))) {
      Toast.error('参数名不能以 __ 开头（系统变量保留前缀）');
      return null;
    }
    return list;
  }

  function normalizeRowRules(): ReportRowRule[] | null {
    const list = rowRules
      .map((r) => ({ ...r, where: r.where.trim() }))
      .filter((r) => r.where || r.roles?.length || r.remark);
    if (list.some((r) => !r.where)) {
      Toast.error('请填写行级规则的 WHERE 片段');
      return null;
    }
    if (list.some((r) => r.where.includes(';'))) {
      Toast.error('行级规则的 WHERE 片段不能包含分号');
      return null;
    }
    return list;
  }

  /** 试跑预览用的参数值：显式输入优先，其次参数默认值 */
  function buildPreviewParams(defs: ReportDatasetParam[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const d of defs) {
      const v = previewParamValues[d.name];
      if (v !== undefined && v !== '') out[d.name] = v;
      else if (d.defaultValue !== undefined && d.defaultValue !== null) out[d.name] = d.defaultValue;
    }
    return out;
  }

  async function handlePreview() {
    const values = formApi.current?.getValues() as Record<string, unknown>;
    if (!selectedDsId) { Toast.warning('请先选择数据源'); return; }
    if (selectedType === 'static') {
      const rows = parseStaticRows(true);
      if (!rows) return;
      applyStaticPreview(rows);
      return;
    }
    const content = buildContent(values ?? {});
    if (content === null) return;
    const normalizedComputedFields = normalizeComputedFields();
    if (normalizedComputedFields === null) return;
    const normalizedParams = normalizeParamDefs();
    if (normalizedParams === null) return;
    try {
      const res = await previewMutation.mutateAsync({
        datasourceId: selectedDsId,
        content,
        params: buildPreviewParams(normalizedParams),
        computedFields: normalizedComputedFields,
        limit: 50,
      });
      setPreview(res);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '预览失败');
      setPreview(null);
    }
  }

  async function handleGenerateSql() {
    const question = aiQuestion.trim();
    if (!question) { Toast.warning('请先输入问题'); return; }
    try {
      const res = await generateSqlMutation.mutateAsync({ question, datasetId: editing?.id });
      formApi.current?.setValue('sql', res.sql);
      Toast.success('SQL 已生成');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '生成失败');
    }
  }

  function applyFieldsFromPreview() {
    if (!preview) return;
    setFields(fieldsFromColumns(preview.columns, preview.rows));
    Toast.success(`已生成 ${preview.columns.length} 个字段`);
  }

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; }
    catch { throw new Error('validation'); }
    if (!selectedDsId) { Toast.error('请选择数据源'); throw new Error('ds'); }
    const content = buildContent(values);
    if (content === null) throw new Error('content');
    const normalizedComputedFields = normalizeComputedFields();
    if (normalizedComputedFields === null) throw new Error('computedFields');
    const normalizedParams = normalizeParamDefs();
    if (normalizedParams === null) throw new Error('params');
    const normalizedRowRules = isSqlAuthoringType(selectedType) ? normalizeRowRules() : [];
    if (normalizedRowRules === null) throw new Error('rowRules');

    const payload = {
      name: values.name,
      datasourceId: selectedDsId,
      content,
      fields: normalizeFields(),
      params: normalizedParams,
      computedFields: normalizedComputedFields,
      rowRules: normalizedRowRules,
      cacheTtl: Number(values.cacheTtl) || 0,
      materialize: {
        enabled: materialize.enabled,
        ...(materialize.cron?.trim() ? { cron: materialize.cron.trim() } : {}),
      },
      status: values.status,
      remark: values.remark || undefined,
    };
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  async function handleRefreshMaterialize(record: ReportDataset) {
    await refreshMaterializeMutation.mutateAsync(record.id);
    Toast.success('物化刷新成功');
  }

  function updateField(index: number, patch: Partial<ReportField>) {
    setFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function updateFieldFormat(index: number, kind: ReportFieldFormat['kind'] | '') {
    setFields((prev) => prev.map((field, i) => {
      if (i !== index) return field;
      if (!kind) {
        const { format: _format, ...rest } = field;
        return rest;
      }
      const nextFormat: ReportFieldFormat = {
        kind,
        ...(kind === 'currency' ? { currencySymbol: field.format?.currencySymbol ?? '¥' } : {}),
        ...(field.format?.decimals != null && ['number', 'percent', 'currency'].includes(kind) ? { decimals: field.format.decimals } : {}),
        ...(field.format?.thousands != null && ['number', 'currency'].includes(kind) ? { thousands: field.format.thousands } : {}),
        ...(kind === 'dict' && field.format?.dictCode ? { dictCode: field.format.dictCode } : {}),
      };
      return { ...field, format: nextFormat };
    }));
  }

  function patchFieldFormat(index: number, patch: Partial<ReportFieldFormat>) {
    setFields((prev) => prev.map((field, i) => (i === index && field.format ? { ...field, format: { ...field.format, ...patch } } : field)));
  }

  function updateComputedField(index: number, patch: Partial<ReportComputedField>) {
    setComputedFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function updateParamDef(index: number, patch: Partial<ReportDatasetParam>) {
    setParamDefs((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function updateRowRule(index: number, patch: Partial<ReportRowRule>) {
    setRowRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const columns: ColumnProps<ReportDataset>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '数据源', dataIndex: 'datasourceName', width: 160, render: (v: string) => v || '-' },
    {
      title: '类型', dataIndex: 'type', width: 80,
      render: (t: ReportDatasourceType) => datasourceTypeTag(t),
    },
    { title: '字段数', dataIndex: 'fields', width: 80, render: (f: ReportField[]) => (f?.length ?? 0) },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    ...(hasPermission('report:dataset:list') ? [{
      title: '导出',
      dataIndex: 'id',
      width: 96,
      fixed: 'right' as const,
      render: (_: unknown, record: ReportDataset) => (
        <ExportButton entity="report.dataset" query={{ datasetId: record.id }} formats={['xlsx', 'csv']} variant="flat" />
      ),
    }] : []),
    {
      title: '状态', dataIndex: 'status', width: 70, fixed: 'right',
      render: (s: string) => s === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag>,
    },
    createOperationColumn<ReportDataset>({
      width: 180,
      desktopInlineKeys: ['refreshMaterialize', 'edit', 'delete'],
      actions: (record) => [
        ...(record.materialize?.enabled && hasPermission('report:dataset:update') ? [{ key: 'refreshMaterialize', label: '刷新物化', onClick: () => void handleRefreshMaterialize(record) }] : []),
        ...(hasPermission('report:dataset:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        { key: 'refs', label: '血缘', onClick: () => setRefsTarget(record) },
        ...(hasPermission('report:dataset:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); },
        }] : []),
      ],
    }),
  ];

  const previewColumns: ColumnProps<Record<string, unknown>>[] = (preview?.columns ?? []).map((c) => ({ title: c, dataIndex: c, width: 140 }));
  const previewData = (preview?.rows ?? []).map((r, i) => ({ ...r, __rk: i }));

  const renderKeyword = () => (
    <Input prefix={<Search size={14} />} placeholder="搜索名称/备注..." value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={draftParams.status || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateBtn = () => hasPermission('report:dataset:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={renderCreateBtn()}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={renderStatusFilter()}
        filterTitle="数据集筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        title={editing ? '编辑数据集' : '新增数据集'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={760}
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInitValues}
          labelPosition="left" labelWidth={72} onValueChange={(v) => {
            if (v.datasourceId === undefined) return;
            setSelectedDsId((prev) => {
              const next = v.datasourceId as number;
              if (prev !== next) setPreview(null);
              return next;
            });
          }}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear />
          <Form.Select field="datasourceId" label="数据源" style={{ width: '100%' }} rules={[{ required: true, message: '请选择数据源' }]}
            placeholder="选择数据源"
            optionList={datasources.map((d) => ({ value: d.id, label: `${d.name}（${datasourceTypeLabel(d.type)}）` }))}
          />

          {isSqlAuthoringType(selectedType) && (
            <>
              <Form.TextArea field="sql" label="SQL" placeholder="SELECT col1, col2 FROM your_table WHERE ..."
                autosize={{ minRows: 4, maxRows: 10 }} style={{ fontFamily: 'var(--semi-font-family-mono, monospace)' }}
                rules={[{ required: true, message: '请输入 SQL' }]} />
              <Form.Slot label="辅助生成">
                <div style={{ width: '100%' }}>
                  <Space>
                    <Button icon={<Sparkles size={14} />} onClick={() => { setAiAskVisible((v) => !v); setVisualVisible(false); }}>AI 问数</Button>
                    <Button icon={<Blocks size={14} />} onClick={() => { setVisualVisible((v) => !v); setAiAskVisible(false); }}>可视化建模</Button>
                  </Space>
                  {aiAskVisible && (
                    <Space vertical align="start" style={{ width: '100%', marginTop: 8 }}>
                      <TextArea
                        value={aiQuestion}
                        onChange={setAiQuestion}
                        placeholder="例如：统计最近 7 天每天的订单金额"
                        autosize={{ minRows: 2, maxRows: 4 }}
                      />
                      <Button type="primary" icon={<Sparkles size={14} />} loading={generateSqlMutation.isPending} onClick={handleGenerateSql}>生成 SQL</Button>
                    </Space>
                  )}
                  {visualVisible && (
                    <VisualModelBuilder
                      initial={visualModel}
                      onGenerate={(sql, model) => {
                        formApi.current?.setValue('sql', sql);
                        setVisualModel(model);
                      }}
                    />
                  )}
                </div>
              </Form.Slot>
            </>
          )}
          {selectedType === 'api' && (
            <>
              <Form.Input field="itemsPath" label="数组路径" placeholder="选填，如 data.list；留空表示响应根即数组" showClear />
              <Form.TextArea field="paramsText" label="附加参数" placeholder={'选填，JSON 键值，如：\n{ "status": "paid" }'} autosize={{ minRows: 2, maxRows: 5 }} />
            </>
          )}
          {selectedType === 'static' && (
            <>
              <Form.Slot label="静态数据">
                <TextArea
                  value={staticJsonText}
                  onChange={setStaticJsonText}
                  onBlur={handleStaticJsonBlur}
                  placeholder={'粘贴 JSON 数组，例如：\n[{"city":"北京","sales":120}]'}
                  autosize={{ minRows: 4, maxRows: 10 }}
                  style={{ fontFamily: 'var(--semi-font-family-mono, monospace)' }}
                />
              </Form.Slot>
              <Form.Slot label="文件">
                <Space>
                  <Button icon={<UploadIcon size={14} />} loading={parseFileMutation.isPending} onClick={() => staticFileInputRef.current?.click()}>上传 Excel/CSV</Button>
                  <Typography.Text type="tertiary" size="small">支持 .xlsx / .xls / .csv，解析后自动生成字段</Typography.Text>
                </Space>
                <input
                  ref={staticFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) void handleStaticFile(file);
                    e.currentTarget.value = '';
                  }}
                />
              </Form.Slot>
            </>
          )}

          <Form.InputNumber field="cacheTtl" label="缓存(秒)" min={0} max={86400} style={{ width: '100%' }} helpText="0=不缓存；命中按数据集+参数缓存" />
          <Form.Slot label="物化快照">
            <Space vertical align="start" style={{ width: '100%' }}>
              <Switch checked={materialize.enabled} onChange={(enabled) => setMaterialize((prev) => ({ ...prev, enabled }))} />
              {materialize.enabled && (
                <Input
                  value={materialize.cron ?? ''}
                  onChange={(cron) => setMaterialize((prev) => ({ ...prev, cron }))}
                  placeholder="0 */10 * * * *"
                  showClear
                  style={{ width: '100%' }}
                />
              )}
              <Typography.Text type="tertiary" size="small">启用后取数优先返回快照（忽略运行时参数），适合大屏降压；Cron 留空=仅手动。</Typography.Text>
            </Space>
          </Form.Slot>
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 2 }} />
        </Form>

        <div style={{ borderTop: '1px solid var(--semi-color-border)', marginTop: 8, paddingTop: 12 }}>
          <Space style={{ marginBottom: 8 }}>
            <Button icon={<Play size={14} />} onClick={handlePreview} loading={previewMutation.isPending} disabled={!selectedDsId}>试跑预览</Button>
            <Button onClick={applyFieldsFromPreview} disabled={!preview}>用结果生成字段</Button>
            <Typography.Text type="tertiary" size="small">
              当前字段：{fields.length} 个{fields.length ? `（${fields.slice(0, 6).map((f) => f.name).join(', ')}${fields.length > 6 ? '…' : ''}）` : ''}
            </Typography.Text>
          </Space>
          {selectedType !== 'static' && paramDefs.length > 0 && (
            <Space wrap style={{ marginBottom: 8 }}>
              <Typography.Text type="tertiary" size="small">试跑参数：</Typography.Text>
              {paramDefs.filter((p) => p.name.trim()).map((p) => (
                <Input
                  key={p.name}
                  prefix={p.label || p.name}
                  placeholder={p.defaultValue != null ? `默认 ${p.defaultValue}` : (p.required ? '必填' : '选填')}
                  value={previewParamValues[p.name] == null ? '' : String(previewParamValues[p.name])}
                  onChange={(v) => setPreviewParamValues((prev) => ({ ...prev, [p.name]: v }))}
                  style={{ width: 200 }}
                  showClear
                />
              ))}
            </Space>
          )}
          {preview ? (
            <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
              <Table size="small" bordered={false} columns={previewColumns} dataSource={previewData} rowKey="__rk" pagination={false}
                scroll={{ x: Math.max(600, previewColumns.length * 140) }} />
            </div>
          ) : (
            <Empty description="点击「试跑预览」查看取数结果" style={{ padding: '16px 0' }} />
          )}
        </div>

        {fields.length > 0 && (
          <div style={{ borderTop: '1px solid var(--semi-color-border)', marginTop: 12, paddingTop: 12 }}>
            <Typography.Text strong>字段设置</Typography.Text>
            <Space vertical align="start" style={{ width: '100%', marginTop: 8 }}>
              {fields.map((field, index) => (
                <div key={`${field.name}-${index}`} style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <Typography.Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ width: 110, lineHeight: '32px' }}>{field.name}</Typography.Text>
                  <Input placeholder="标题" value={field.label} onChange={(v) => updateField(index, { label: v })} style={{ width: 120 }} showClear />
                  <Select
                    value={field.type}
                    optionList={COMPUTED_FIELD_TYPE_OPTIONS}
                    onChange={(v) => updateField(index, { type: v as ReportField['type'] })}
                    style={{ width: 105 }}
                  />
                  <Select
                    value={field.format?.kind ?? ''}
                    optionList={FIELD_FORMAT_KIND_OPTIONS}
                    onChange={(v) => updateFieldFormat(index, v as ReportFieldFormat['kind'] | '')}
                    style={{ width: 115 }}
                  />
                  {field.format && ['number', 'percent', 'currency'].includes(field.format.kind) && (
                    <InputNumber
                      value={field.format.decimals}
                      placeholder="小数"
                      min={0}
                      max={8}
                      style={{ width: 88 }}
                      onChange={(v) => patchFieldFormat(index, { decimals: typeof v === 'number' ? v : undefined })}
                    />
                  )}
                  {field.format && ['number', 'currency'].includes(field.format.kind) && (
                    <Space style={{ height: 32 }}>
                      <Typography.Text type="tertiary" size="small">千分位</Typography.Text>
                      <Switch size="small" checked={field.format.thousands ?? true} onChange={(thousands) => patchFieldFormat(index, { thousands })} />
                    </Space>
                  )}
                  {field.format?.kind === 'currency' && (
                    <Input
                      placeholder="符号"
                      value={field.format.currencySymbol ?? '¥'}
                      onChange={(currencySymbol) => patchFieldFormat(index, { currencySymbol })}
                      style={{ width: 78 }}
                    />
                  )}
                  {field.format?.kind === 'dict' && (
                    <Input
                      placeholder="字典编码"
                      value={field.format.dictCode ?? ''}
                      onChange={(dictCode) => patchFieldFormat(index, { dictCode })}
                      style={{ width: 140 }}
                      showClear
                    />
                  )}
                </div>
              ))}
            </Space>
          </div>
        )}

        {selectedType !== 'static' && (
          <div style={{ borderTop: '1px solid var(--semi-color-border)', marginTop: 12, paddingTop: 12 }}>
            <Space style={{ marginBottom: 6 }}>
              <Typography.Text strong>参数定义</Typography.Text>
              <Button size="small" onClick={() => setParamDefs((prev) => [...prev, { name: '', label: '', type: 'string' }])}>添加参数</Button>
            </Space>
            <div>
              <Typography.Text type="tertiary" size="small">
                SQL 中用 {'${参数名}'} 引用（自动绑定参数防注入）；API 数据集作为请求参数注入。仪表盘筛选器可绑定到参数。
              </Typography.Text>
            </div>
            {paramDefs.length > 0 && (
              <Space vertical align="start" style={{ width: '100%', marginTop: 8 }}>
                {paramDefs.map((p, index) => (
                  <Space key={index} align="start" style={{ width: '100%' }}>
                    <Input placeholder="参数名" value={p.name} onChange={(v) => updateParamDef(index, { name: v })} style={{ width: 130 }} showClear />
                    <Input placeholder="标题" value={p.label} onChange={(v) => updateParamDef(index, { label: v })} style={{ width: 110 }} showClear />
                    <Select
                      value={p.type}
                      optionList={COMPUTED_FIELD_TYPE_OPTIONS}
                      onChange={(v) => updateParamDef(index, { type: v as ReportDatasetParam['type'] })}
                      style={{ width: 100 }}
                    />
                    <Input
                      placeholder="默认值"
                      value={p.defaultValue == null ? '' : String(p.defaultValue)}
                      onChange={(v) => updateParamDef(index, { defaultValue: v === '' ? null : v })}
                      style={{ width: 130 }}
                      showClear
                    />
                    <Space style={{ height: 32 }}>
                      <Typography.Text type="tertiary" size="small">必填</Typography.Text>
                      <Switch size="small" checked={p.required ?? false} onChange={(required) => updateParamDef(index, { required })} />
                    </Space>
                    <Button theme="borderless" type="danger" onClick={() => setParamDefs((prev) => prev.filter((_, i) => i !== index))}>删除</Button>
                  </Space>
                ))}
              </Space>
            )}
          </div>
        )}

        {isSqlAuthoringType(selectedType) && (
          <div style={{ borderTop: '1px solid var(--semi-color-border)', marginTop: 12, paddingTop: 12 }}>
            <Space style={{ marginBottom: 6 }}>
              <Typography.Text strong>行级权限</Typography.Text>
              <Button size="small" onClick={() => setRowRules((prev) => [...prev, { roles: [], where: '', enabled: true }])}>添加规则</Button>
            </Space>
            <div>
              <Typography.Text type="tertiary" size="small">
                命中规则的用户仅能看到满足条件的行（多条命中规则按「或」合并）；未命中任何规则或超级管理员不受限。
                WHERE 片段可用 {'${__userId}'} / {'${__deptId}'} 等系统变量，如 dept_id = {'${__deptId}'}。
              </Typography.Text>
            </div>
            {rowRules.length > 0 && (
              <Space vertical align="start" style={{ width: '100%', marginTop: 8 }}>
                {rowRules.map((rule, index) => (
                  <Space key={index} align="start" style={{ width: '100%' }}>
                    <Select multiple filter placeholder="全部角色" value={rule.roles ?? []} style={{ width: 180 }} maxTagCount={2}
                      optionList={roleOptions}
                      onChange={(v) => updateRowRule(index, { roles: (v as string[]) ?? [] })} />
                    <Input placeholder={'WHERE 片段，如 dept_id = ${__deptId}'} value={rule.where} style={{ width: 280 }} showClear
                      onChange={(v) => updateRowRule(index, { where: v })} />
                    <Space style={{ height: 32 }}>
                      <Typography.Text type="tertiary" size="small">启用</Typography.Text>
                      <Switch size="small" checked={rule.enabled ?? true} onChange={(enabled) => updateRowRule(index, { enabled })} />
                    </Space>
                    <Button theme="borderless" type="danger" onClick={() => setRowRules((prev) => prev.filter((_, i) => i !== index))}>删除</Button>
                  </Space>
                ))}
              </Space>
            )}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--semi-color-border)', marginTop: 12, paddingTop: 12 }}>
          <Space style={{ marginBottom: 6 }}>
            <Typography.Text strong>计算字段</Typography.Text>
            <Button size="small" onClick={() => setComputedFields((prev) => [...prev, { name: '', label: '', expression: '', type: 'string' }])}>添加计算字段</Button>
          </Space>
          <div>
            <Typography.Text type="tertiary" size="small">
              表达式支持 + - * / %、比较、三元 ?:、函数 round/concat/upper/coalesce 等，列名直接引用。
            </Typography.Text>
          </div>
          {computedFields.length > 0 && (
            <Space vertical align="start" style={{ width: '100%', marginTop: 8 }}>
              {computedFields.map((field, index) => (
                <Space key={index} align="start" style={{ width: '100%' }}>
                  <Input placeholder="字段名" value={field.name} onChange={(v) => updateComputedField(index, { name: v })} style={{ width: 110 }} showClear />
                  <Input placeholder="标题" value={field.label} onChange={(v) => updateComputedField(index, { label: v })} style={{ width: 110 }} showClear />
                  <Input placeholder="a + b 或 round(amount/100, 2)" value={field.expression} onChange={(v) => updateComputedField(index, { expression: v })} style={{ width: 260 }} showClear />
                  <Select
                    value={field.type ?? 'string'}
                    optionList={COMPUTED_FIELD_TYPE_OPTIONS}
                    onChange={(v) => updateComputedField(index, { type: v as ReportComputedField['type'] })}
                    style={{ width: 110 }}
                  />
                  <Button theme="borderless" type="danger" onClick={() => setComputedFields((prev) => prev.filter((_, i) => i !== index))}>删除</Button>
                </Space>
              ))}
            </Space>
          )}
        </div>
      </AppModal>

      <DatasetRefsModal dataset={refsTarget} onClose={() => setRefsTarget(null)} />
    </div>
  );
}
