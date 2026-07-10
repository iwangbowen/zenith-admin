import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  Button,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  SideSheet,
  Space,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type {
  ReportAssetCatalogItem,
  ReportAssetTemplate,
  ReportAssetTemplateType,
  ReportAssetUsageSummary,
  ReportAssetUsageTrendPoint,
  ReportDeprecationNotice,
  ReportResourceType,
} from '@zenith/shared';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  reportAssetKeys,
  useApplyReportAssetTemplate,
  useCloneReportAssetTemplate,
  useDeleteReportAssetTemplate,
  useDeleteReportDeprecation,
  useInactiveReportAssets,
  usePublishReportDeprecation,
  useReportAssetCatalog,
  useReportAssetTemplateList,
  useReportAssetUsage,
  useReportAssetUsageTrend,
  useReportDeprecationList,
  useSaveReportAssetTemplate,
  useSaveReportDeprecation,
  useTopReportAssets,
} from '@/hooks/queries/report-assets';
import { flattenReportFolders, useReportFolderTree } from '@/hooks/queries/report-folders';
import { useAllUsers } from '@/hooks/queries/users';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { normalizeTemplateApplyValues, parseJsonObject } from './report-platform-utils';
import { REPORT_RESOURCE_TYPE_OPTIONS } from './report-platform-options';

const resourceTypeOptions = REPORT_RESOURCE_TYPE_OPTIONS;
const templateTypeOptions = [
  { value: 'dashboard', label: '仪表盘模板' },
  { value: 'widget', label: '组件模板' },
  { value: 'print', label: '打印模板' },
  { value: 'semantic_model', label: '语义模型' },
];

export default function AssetsPage() {
  const qc = useQueryClient();
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [activeTab, setActiveTab] = useState('catalog');
  const [catalogDraft, setCatalogDraft] = useState({
    keyword: '', types: [] as ReportResourceType[], ownerId: undefined as number | undefined,
    folderId: undefined as number | undefined, lifecycle: '', timeRange: null as [Date, Date] | null,
  });
  const [catalogSearch, setCatalogSearch] = useState(catalogDraft);
  const [usageTarget, setUsageTarget] = useState<ReportAssetCatalogItem | null>(null);
  const [templateKeyword, setTemplateKeyword] = useState('');
  const [templateType, setTemplateType] = useState<ReportAssetTemplateType | undefined>();
  const [templateSearch, setTemplateSearch] = useState({ keyword: '', type: undefined as ReportAssetTemplateType | undefined });
  const [templateModal, setTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReportAssetTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<ReportAssetTemplate | null>(null);
  const [deprecationModal, setDeprecationModal] = useState(false);
  const [editingNotice, setEditingNotice] = useState<ReportDeprecationNotice | null>(null);
  const [usageDays, setUsageDays] = useState(30);

  const usersQuery = useAllUsers();
  const foldersQuery = useReportFolderTree();
  const templateFoldersQuery = useReportFolderTree({ resourceType: 'asset_template' });
  const users = usersQuery.data ?? [];
  const folders = flattenReportFolders(foldersQuery.data ?? []);
  const templateFolders = flattenReportFolders(templateFoldersQuery.data ?? []);
  const catalogQueryParams = {
    page, pageSize,
    keyword: catalogSearch.keyword || undefined,
    types: catalogSearch.types.length ? catalogSearch.types.join(',') : undefined,
    ownerId: catalogSearch.ownerId,
    folderId: catalogSearch.folderId,
    lifecycle: catalogSearch.lifecycle || undefined,
    updatedStart: catalogSearch.timeRange ? formatDateTimeForApi(catalogSearch.timeRange[0]) : undefined,
    updatedEnd: catalogSearch.timeRange ? formatDateTimeForApi(catalogSearch.timeRange[1]) : undefined,
  };
  const catalogQuery = useReportAssetCatalog(catalogQueryParams);
  const usageQuery = useReportAssetUsage(usageTarget?.resourceType, usageTarget?.resourceId, usageDays, !!usageTarget);
  const templatesQuery = useReportAssetTemplateList({ page, pageSize, keyword: templateSearch.keyword || undefined, type: templateSearch.type });
  const noticesQuery = useReportDeprecationList({ page, pageSize });
  const topQuery = useTopReportAssets({ days: usageDays, limit: 20 });
  const inactiveQuery = useInactiveReportAssets({ days: Math.max(usageDays, 90), page, pageSize });
  const trendQuery = useReportAssetUsageTrend({ days: usageDays, bucket: 'day' });
  const saveTemplateMutation = useSaveReportAssetTemplate();
  const deleteTemplateMutation = useDeleteReportAssetTemplate();
  const cloneTemplateMutation = useCloneReportAssetTemplate();
  const applyTemplateMutation = useApplyReportAssetTemplate();
  const saveNoticeMutation = useSaveReportDeprecation();
  const publishNoticeMutation = usePublishReportDeprecation();
  const deleteNoticeMutation = useDeleteReportDeprecation();

  const searchCatalog = () => {
    setPage(1);
    setCatalogSearch(catalogDraft);
    void qc.invalidateQueries({ queryKey: reportAssetKeys.lists });
  };
  const resetCatalog = () => {
    const empty = { keyword: '', types: [] as ReportResourceType[], ownerId: undefined, folderId: undefined, lifecycle: '', timeRange: null as [Date, Date] | null };
    setPage(1);
    setCatalogDraft(empty);
    setCatalogSearch(empty);
    void qc.invalidateQueries({ queryKey: reportAssetKeys.lists });
  };
  const searchTemplates = () => {
    setPage(1);
    setTemplateSearch({ keyword: templateKeyword, type: templateType });
    void qc.invalidateQueries({ queryKey: reportAssetKeys.templateLists });
  };
  const resetTemplates = () => {
    setTemplateKeyword('');
    setTemplateType(undefined);
    setTemplateSearch({ keyword: '', type: undefined });
    setPage(1);
    void qc.invalidateQueries({ queryKey: reportAssetKeys.templateLists });
  };

  const openTemplate = (record?: ReportAssetTemplate) => {
    setEditingTemplate(record ?? null);
    setTemplateModal(true);
  };
  const saveTemplate = async () => {
    try {
      const values = await formApi.current!.validate();
      const content = parseJsonObject(String(values.content ?? '{}'), '模板内容');
      await saveTemplateMutation.mutateAsync({
        id: editingTemplate?.id,
        values: {
          ...values,
          code: values.code,
          folderId: values.folderId || null,
          ownerId: values.ownerId || null,
          description: values.description || null,
          content,
          previewFileId: null,
        },
      });
      Toast.success(editingTemplate ? '模板已更新' : '模板已创建');
      setTemplateModal(false);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '模板保存失败');
    }
  };
  const cloneTemplate = (record: ReportAssetTemplate) => {
    Modal.confirm({
      title: `克隆模板「${record.name}」？`,
      content: <Input id="asset-template-clone-name" defaultValue={`${record.name} 副本`} />,
      onOk: async () => {
        const name = (document.querySelector('#asset-template-clone-name') as HTMLInputElement | null)?.value.trim();
        if (!name) throw new Error('请输入副本名称');
        await cloneTemplateMutation.mutateAsync({ id: record.id, name, folderId: record.folderId });
        Toast.success('模板已克隆');
      },
    });
  };
  const applyTemplate = (record: ReportAssetTemplate) => {
    Modal.confirm({
      title: `应用模板「${record.name}」？`,
      content: '系统将按模板类型创建对应资源；如需指定名称，可在创建后继续编辑。',
      onOk: async () => {
        const result = await applyTemplateMutation.mutateAsync({ id: record.id, values: normalizeTemplateApplyValues({}) });
        Toast.success(`已创建${resourceTypeOptions.find((item) => item.value === result.resourceType)?.label ?? '资源'}：${result.name}`);
      },
    });
  };

  const openNotice = (record?: ReportDeprecationNotice) => {
    setEditingNotice(record ?? null);
    setDeprecationModal(true);
  };
  const saveNotice = async () => {
    try {
      const values = await formApi.current!.validate();
      const common = {
        title: values.title,
        message: values.message,
        replacementResourceType: values.replacementResourceType || null,
        replacementResourceId: values.replacementResourceId || null,
        effectiveAt: formatDateTimeForApi(values.effectiveAt as Date),
        expiresAt: values.expiresAt ? formatDateTimeForApi(values.expiresAt as Date) : null,
      };
      await saveNoticeMutation.mutateAsync({
        id: editingNotice?.id,
        values: editingNotice ? common : { ...common, resourceType: values.resourceType, resourceId: Number(values.resourceId) },
      });
      Toast.success(editingNotice ? '弃用公告已更新' : '弃用公告已创建');
      setDeprecationModal(false);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '弃用公告保存失败');
    }
  };

  const catalogColumns: ColumnProps<ReportAssetCatalogItem>[] = [
    { title: '资产名称', dataIndex: 'name', width: 210, render: renderEllipsis },
    { title: '类型', dataIndex: 'resourceType', width: 130, render: (v) => resourceTypeOptions.find((item) => item.value === v)?.label ?? v },
    { title: '负责人', dataIndex: 'ownerName', width: 130, render: (v) => v || '—' },
    { title: '目录', dataIndex: 'folderName', width: 150, render: (v) => v || '—' },
    { title: '生命周期', dataIndex: 'lifecycleStatus', width: 110, render: (v) => v ? <Tag>{v}</Tag> : '—' },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (v) => formatDateTime(v) },
    {
      title: '状态', dataIndex: 'status', width: 100, fixed: 'right',
      render: (v, r) => r.deprecationEffectiveAt ? <Tag color="orange">即将弃用</Tag> : <Tag>{v || '正常'}</Tag>,
    },
    createOperationColumn<ReportAssetCatalogItem>({
      width: 130,
      desktopInlineKeys: ['impact'],
      actions: (record) => [
        { key: 'impact', label: '使用影响', hidden: !hasPermission('report:asset:usage'), onClick: () => setUsageTarget(record) },
        {
          key: 'deprecate', label: '发布弃用', danger: true, hidden: !hasPermission('report:deprecation:create'),
          onClick: () => {
            setEditingNotice(null);
            setDeprecationModal(true);
            setTimeout(() => formApi.current?.setValues({ resourceType: record.resourceType, resourceId: record.resourceId }), 0);
          },
        },
      ],
    }),
  ];
  const templateColumns: ColumnProps<ReportAssetTemplate>[] = [
    { title: '模板名称', dataIndex: 'name', width: 190, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 150, render: renderEllipsis },
    { title: '类型', dataIndex: 'type', width: 130, render: (v) => templateTypeOptions.find((item) => item.value === v)?.label ?? v },
    { title: '负责人', dataIndex: 'ownerName', width: 120, render: (v) => v || '—' },
    { title: '版本/使用', width: 120, render: (_v, r) => `v${r.version} / ${r.usageCount}` },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (v) => formatDateTime(v) },
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v) => <Tag color={v === 'enabled' ? 'green' : 'grey'}>{v === 'enabled' ? '启用' : '停用'}</Tag> },
    createOperationColumn<ReportAssetTemplate>({
      width: 190,
      desktopInlineKeys: ['apply', 'edit'],
      actions: (record) => [
        { key: 'apply', label: '应用', hidden: !hasPermission('report:asset-template:apply'), onClick: () => applyTemplate(record) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:asset-template:update'), onClick: () => openTemplate(record) },
        { key: 'preview', label: '预览', onClick: () => setPreviewTemplate(record) },
        { key: 'clone', label: '克隆', hidden: !hasPermission('report:asset-template:create'), onClick: () => cloneTemplate(record) },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('report:asset-template:delete'),
          onClick: () => { Modal.confirm({
            title: `删除模板「${record.name}」？`,
            okButtonProps: { type: 'danger', theme: 'solid' },
            onOk: async () => { await deleteTemplateMutation.mutateAsync(record.id); Toast.success('模板已删除'); },
          }); },
        },
      ],
    }),
  ];
  const noticeColumns: ColumnProps<ReportDeprecationNotice>[] = [
    { title: '公告标题', dataIndex: 'title', width: 220, render: renderEllipsis },
    { title: '资源', width: 150, render: (_v, r) => `${r.resourceType} #${r.resourceId}` },
    { title: '生效时间', dataIndex: 'effectiveAt', width: 170, render: (v) => formatDateTime(v) },
    { title: '到期时间', dataIndex: 'expiresAt', width: 170, render: (v) => v ? formatDateTime(v) : '—' },
    { title: '状态', dataIndex: 'publishedAt', width: 100, fixed: 'right', render: (v) => <Tag color={v ? 'orange' : 'grey'}>{v ? '已发布' : '草稿'}</Tag> },
    createOperationColumn<ReportDeprecationNotice>({
      width: 170,
      desktopInlineKeys: ['publish', 'edit'],
      actions: (record) => [
        {
          key: 'publish', label: record.publishedAt ? '撤销发布' : '发布', danger: !!record.publishedAt, hidden: !hasPermission('report:deprecation:publish'),
          onClick: () => { Modal.confirm({
            title: record.publishedAt ? '撤销该弃用公告？' : '发布该弃用公告？',
            onOk: async () => {
              await publishNoticeMutation.mutateAsync({ id: record.id, publish: !record.publishedAt });
              Toast.success(record.publishedAt ? '已撤销发布' : '已发布');
            },
          }); },
        },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:deprecation:update'), onClick: () => openNotice(record) },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('report:deprecation:delete'),
          onClick: () => { Modal.confirm({
            title: '删除弃用公告？',
            okButtonProps: { type: 'danger', theme: 'solid' },
            onOk: async () => { await deleteNoticeMutation.mutateAsync(record.id); Toast.success('公告已删除'); },
          }); },
        },
      ],
    }),
  ];
  const usageColumns: ColumnProps<ReportAssetUsageSummary>[] = [
    { title: '资源', width: 150, render: (_v, r) => `${r.resourceType} #${r.resourceId}` },
    { title: '查看', dataIndex: 'views', width: 90 },
    { title: '查询', dataIndex: 'queries', width: 90 },
    { title: '导出', dataIndex: 'exports', width: 90 },
    { title: '独立用户', dataIndex: 'uniqueUsers', width: 100 },
    { title: '最后使用', dataIndex: 'lastUsedAt', width: 170, render: (v) => v ? formatDateTime(v) : '—' },
    { title: '状态', dataIndex: 'deprecated', width: 100, fixed: 'right', render: (v) => <Tag color={v ? 'orange' : 'green'}>{v ? '已弃用' : '正常'}</Tag> },
  ];
  const trendColumns: ColumnProps<ReportAssetUsageTrendPoint>[] = [
    { title: '日期', dataIndex: 'bucket', width: 170 },
    { title: '查看', dataIndex: 'views', width: 90 },
    { title: '查询', dataIndex: 'queries', width: 90 },
    { title: '导出', dataIndex: 'exports', width: 90 },
    { title: '嵌入', dataIndex: 'embeds', width: 90 },
    { title: '分享', dataIndex: 'shares', width: 90 },
    { title: '独立用户', dataIndex: 'uniqueUsers', width: 100 },
  ];

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" activeKey={activeTab} onChange={(key) => { setActiveTab(key); setPage(1); }}>
        <TabPane tab="统一资产目录" itemKey="catalog">
          <SearchToolbar
            primary={<>
              <Input prefix={<Search size={14} />} placeholder="搜索资产名称" value={catalogDraft.keyword} showClear style={{ width: 220 }} onChange={(value) => setCatalogDraft((p) => ({ ...p, keyword: value }))} onEnterPress={searchCatalog} />
              <Button type="primary" icon={<Search size={14} />} onClick={searchCatalog}>查询</Button>
              <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={resetCatalog}>重置</Button>
            </>}
            filters={<>
              <Select multiple placeholder="资产类型" value={catalogDraft.types} optionList={resourceTypeOptions} style={{ width: 210 }} onChange={(value) => setCatalogDraft((p) => ({ ...p, types: value as ReportResourceType[] }))} />
              <Select filter showClear placeholder="负责人" value={catalogDraft.ownerId} optionList={users.map((u) => ({ value: u.id, label: u.nickname || u.username }))} style={{ width: 150 }} onChange={(value) => setCatalogDraft((p) => ({ ...p, ownerId: value as number | undefined }))} />
              <Select filter showClear placeholder="目录" value={catalogDraft.folderId} optionList={folders.map((f) => ({ value: f.id, label: `[${f.resourceType}] ${f.name}` }))} style={{ width: 180 }} onChange={(value) => setCatalogDraft((p) => ({ ...p, folderId: value as number | undefined }))} />
              <Select showClear placeholder="生命周期" value={catalogDraft.lifecycle || undefined} optionList={['draft', 'published', 'deprecated'].map((value) => ({ value, label: value }))} style={{ width: 140 }} onChange={(value) => setCatalogDraft((p) => ({ ...p, lifecycle: (value as string) ?? '' }))} />
              <DatePicker type="dateTimeRange" value={catalogDraft.timeRange ?? undefined} style={{ width: 340 }} onChange={(value) => setCatalogDraft((p) => ({ ...p, timeRange: value ? value as [Date, Date] : null }))} />
            </>}
            actions={<ExportButton entity="report.assets" query={catalogQueryParams} />}
            mobilePrimary={<>
              <Input prefix={<Search size={14} />} placeholder="搜索资产" value={catalogDraft.keyword} showClear onChange={(value) => setCatalogDraft((p) => ({ ...p, keyword: value }))} />
              <Button type="primary" icon={<Search size={14} />} onClick={searchCatalog}>查询</Button>
            </>}
            mobileActions={<ExportButton entity="report.assets" query={catalogQueryParams} variant="flat" />}
            onFilterApply={searchCatalog}
            onFilterReset={resetCatalog}
          />
          {catalogQuery.isError && <Banner type="danger" description={catalogQuery.error instanceof Error ? catalogQuery.error.message : '资产目录加载失败'} />}
          <ConfigurableTable bordered rowKey={(r) => `${r!.resourceType}-${r!.resourceId}`} columns={catalogColumns} dataSource={catalogQuery.data?.list ?? []} loading={catalogQuery.isFetching} empty={<Empty title="暂无匹配资产" />} pagination={buildPagination(catalogQuery.data?.total ?? 0)} onRefresh={() => void catalogQuery.refetch()} refreshLoading={catalogQuery.isFetching} />
        </TabPane>

        <TabPane tab="可复用模板" itemKey="templates">
          <SearchToolbar>
            <Input prefix={<Search size={14} />} placeholder="搜索模板名称/编码" value={templateKeyword} showClear style={{ width: 230 }} onChange={setTemplateKeyword} onEnterPress={searchTemplates} />
            <Select placeholder="模板类型" showClear value={templateType} optionList={templateTypeOptions} style={{ width: 150 }} onChange={(v) => setTemplateType(v as ReportAssetTemplateType | undefined)} />
            <Button type="primary" icon={<Search size={14} />} onClick={searchTemplates}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={resetTemplates}>重置</Button>
            {hasPermission('report:asset-template:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={() => openTemplate()}>新增</Button> : null}
          </SearchToolbar>
          {templatesQuery.isError && <Banner type="danger" description="资产模板加载失败" />}
          <ConfigurableTable bordered rowKey="id" columns={templateColumns} dataSource={templatesQuery.data?.list ?? []} loading={templatesQuery.isFetching} empty={<Empty title="暂无资产模板" />} pagination={buildPagination(templatesQuery.data?.total ?? 0)} onRefresh={() => void templatesQuery.refetch()} refreshLoading={templatesQuery.isFetching} />
        </TabPane>

        <TabPane tab="使用与弃用" itemKey="usage">
          <SearchToolbar>
            <Select value={usageDays} optionList={[{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }, { value: 90, label: '近 90 天' }]} style={{ width: 130 }} onChange={(v) => setUsageDays(Number(v))} />
            {hasPermission('report:deprecation:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={() => openNotice()}>新增弃用公告</Button> : null}
          </SearchToolbar>
          {(topQuery.isError || trendQuery.isError || inactiveQuery.isError || noticesQuery.isError) && <Banner type="danger" description="部分资产使用数据加载失败，可点击对应表格刷新重试。" />}
          <Typography.Title heading={5}>高频资产</Typography.Title>
          <ConfigurableTable bordered rowKey={(r) => `${r!.resourceType}-${r!.resourceId}`} columns={usageColumns} dataSource={topQuery.data ?? []} loading={topQuery.isFetching} empty={<Empty title="暂无使用数据" />} pagination={false} onRefresh={() => void topQuery.refetch()} refreshLoading={topQuery.isFetching} />
          <Typography.Title heading={5} style={{ marginTop: 20 }}>使用趋势</Typography.Title>
          <ConfigurableTable bordered rowKey="bucket" columns={trendColumns} dataSource={trendQuery.data ?? []} loading={trendQuery.isFetching} empty={<Empty title="暂无趋势数据" />} pagination={false} onRefresh={() => void trendQuery.refetch()} refreshLoading={trendQuery.isFetching} />
          <Typography.Title heading={5} style={{ marginTop: 20 }}>闲置资产</Typography.Title>
          <ConfigurableTable bordered rowKey={(r) => `${r!.resourceType}-${r!.resourceId}`} columns={catalogColumns} dataSource={inactiveQuery.data?.list ?? []} loading={inactiveQuery.isFetching} empty={<Empty title="暂无闲置资产" />} pagination={buildPagination(inactiveQuery.data?.total ?? 0)} onRefresh={() => void inactiveQuery.refetch()} refreshLoading={inactiveQuery.isFetching} />
          <Typography.Title heading={5} style={{ marginTop: 20 }}>弃用公告</Typography.Title>
          <ConfigurableTable bordered rowKey="id" columns={noticeColumns} dataSource={noticesQuery.data?.list ?? []} loading={noticesQuery.isFetching} empty={<Empty title="暂无弃用公告" />} pagination={buildPagination(noticesQuery.data?.total ?? 0)} onRefresh={() => void noticesQuery.refetch()} refreshLoading={noticesQuery.isFetching} />
        </TabPane>
      </Tabs>

      <SideSheet title={`使用影响：${usageTarget?.name ?? ''}`} visible={!!usageTarget} width={520} onCancel={() => setUsageTarget(null)}>
        {usageQuery.isError && <Banner type="danger" description="资产使用影响加载失败" />}
        {usageQuery.isFetching && <Typography.Text>正在分析使用影响…</Typography.Text>}
        {usageQuery.data && (
          <Space vertical align="start">
            <Typography.Title heading={4}>{usageQuery.data.views} 次查看 · {usageQuery.data.queries} 次查询</Typography.Title>
            <Typography.Text>导出 {usageQuery.data.exports} 次，独立用户 {usageQuery.data.uniqueUsers} 人</Typography.Text>
            <Typography.Text>最后使用：{usageQuery.data.lastUsedAt ? formatDateTime(usageQuery.data.lastUsedAt) : '从未使用'}</Typography.Text>
            {usageQuery.data.deprecated && <Banner type="warning" description={usageQuery.data.deprecationNotice?.message ?? '该资产已弃用'} />}
          </Space>
        )}
      </SideSheet>

      <AppModal title={editingTemplate ? '编辑资产模板' : '新增资产模板'} visible={templateModal} width={680} confirmLoading={saveTemplateMutation.isPending} onOk={() => void saveTemplate()} onCancel={() => setTemplateModal(false)} closeOnEsc>
        <Form key={editingTemplate?.id ?? 'create'} getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={92} initValues={editingTemplate ? { ...editingTemplate, content: JSON.stringify(editingTemplate.content, null, 2) } : { type: 'dashboard', content: '{}', status: 'enabled' }}>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Input field="name" label="模板名称" rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Input field="code" label="模板编码" disabled={!!editingTemplate} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="type" label="模板类型" style={{ width: '100%' }} optionList={templateTypeOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="ownerId" label="负责人" filter showClear style={{ width: '100%' }} optionList={users.map((u) => ({ value: u.id, label: u.nickname || u.username }))} /></Col>
            <Col xs={24} md={12}><Form.Select field="folderId" label="模板目录" filter showClear style={{ width: '100%' }} optionList={templateFolders.map((f) => ({ value: f.id, label: f.name }))} /></Col>
          </Row>
          <Form.TextArea field="description" label="说明" autosize rows={2} />
          <Form.TextArea field="content" label="模板 JSON" autosize rows={9} rules={[{ required: true }]} />
        </Form>
      </AppModal>

      <AppModal title={editingNotice ? '编辑弃用公告' : '新增弃用公告'} visible={deprecationModal} width={680} confirmLoading={saveNoticeMutation.isPending} onOk={() => void saveNotice()} onCancel={() => setDeprecationModal(false)} closeOnEsc>
        <Form key={editingNotice?.id ?? 'create'} getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={105} initValues={editingNotice ?? {}}>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Select field="resourceType" label="资源类型" disabled={!!editingNotice} style={{ width: '100%' }} optionList={resourceTypeOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="resourceId" label="资源 ID" disabled={!!editingNotice} min={1} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.DatePicker field="effectiveAt" label="生效时间" type="dateTime" style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.DatePicker field="expiresAt" label="到期时间" type="dateTime" style={{ width: '100%' }} /></Col>
            <Col xs={24} md={12}><Form.Select field="replacementResourceType" label="替代资源类型" showClear style={{ width: '100%' }} optionList={resourceTypeOptions} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="replacementResourceId" label="替代资源 ID" min={1} style={{ width: '100%' }} /></Col>
          </Row>
          <Form.Input field="title" label="公告标题" rules={[{ required: true }]} />
          <Form.TextArea field="message" label="公告内容" autosize rows={4} rules={[{ required: true }]} />
        </Form>
      </AppModal>

      <SideSheet title={`模板预览：${previewTemplate?.name ?? ''}`} visible={!!previewTemplate} width={640} onCancel={() => setPreviewTemplate(null)}>
        <Banner type="info" description="以下为模板安全预览，不会创建或修改任何资源。" />
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{previewTemplate ? JSON.stringify(previewTemplate.content, null, 2) : ''}</pre>
      </SideSheet>
    </div>
  );
}
