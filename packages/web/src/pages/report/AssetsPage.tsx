import { useMemo, useState } from 'react';
import { Banner, Col, Empty, Form, Input, Modal, Row, Select, SideSheet, Space, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ReportAssetCatalogItem, ReportAssetTemplate, ReportAssetTemplateType, ReportAssetUsageSummary, ReportAssetUsageTrendPoint, ReportDeprecationNotice, ReportResourceType } from '@zenith/shared/report';
import { REPORT_DASHBOARD_LIFECYCLE_LABELS } from '@zenith/shared/report';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { useListSearch } from '@/hooks/useListSearch';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { compactParams } from '@/lib/query';
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
import { ReportFolderFilter, ReportOwnerFilter } from './report-filters';
import { useReportOwnerFolderOptions } from './report-lookups';
import { formatDateTime, formatDateTimeForApi, formatDateTimeRangeValuesForApi } from '@/utils/date';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis, renderEnabledStatusTag } from '@/utils/table-columns';
import { normalizeTemplateApplyValues, parseJsonObject } from './report-platform-utils';
import { REPORT_RESOURCE_TYPE_OPTIONS } from './report-platform-options';
import { CreateButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput, type FilterOption } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { abortSubmit } from '@/lib/abort-submit';
import { JsonBlock } from '@/components/JsonBlock';

import { useUrlTabState } from '@/hooks/useUrlTabState';
const resourceTypeOptions = REPORT_RESOURCE_TYPE_OPTIONS;
const templateTypeOptions: FilterOption<ReportAssetTemplateType>[] = [
  { value: 'dashboard', label: '仪表盘模板' },
  { value: 'widget', label: '组件模板' },
  { value: 'print', label: '打印模板' },
  { value: 'semantic_model', label: '语义模型' },
];

interface CatalogSearchParams {
  keyword: string;
  types: ReportResourceType[];
  ownerId?: number;
  folderId?: number;
  lifecycle?: string;
  timeRange: [Date, Date] | null;
}

const defaultCatalogSearch: CatalogSearchParams = {
  keyword: '', types: [], ownerId: undefined, folderId: undefined, lifecycle: undefined, timeRange: null,
};

interface TemplateSearchParams {
  keyword: string;
  type?: ReportAssetTemplateType;
}

const defaultTemplateSearch: TemplateSearchParams = { keyword: '', type: undefined };

export default function AssetsPage() {
  const { hasPermission } = usePermission();
  // 三个 Tab 各自分页：资产目录 / 可复用模板走 useListSearch，「使用与弃用」Tab 的闲置资产与弃用公告共用一份分页
  const catalog = useListSearch<CatalogSearchParams>({ defaults: defaultCatalogSearch, listKey: reportAssetKeys.lists });
  const templates = useListSearch<TemplateSearchParams>({ defaults: defaultTemplateSearch, listKey: reportAssetKeys.templateLists });
  const usagePagination = usePagination();
  const [activeTab, setActiveTab] = useUrlTabState(['catalog', 'templates', 'usage'] as const, 'catalog');
  const [usageTarget, setUsageTarget] = useState<ReportAssetCatalogItem | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<ReportAssetTemplate | null>(null);
  const [usageDays, setUsageDays] = useState(30);

  const { userOptions, folders } = useReportOwnerFolderOptions();
  const templateFoldersQuery = useReportFolderTree({ resourceType: 'asset_template' });
  const templateFolders = flattenReportFolders(templateFoldersQuery.data ?? []);
  // 已提交筛选 → 契约查询参数：只映射一次，列表与导出共用
  const catalogFilterQuery = useMemo(() => {
    const submitted = catalog.submittedParams;
    const [updatedStart, updatedEnd] = formatDateTimeRangeValuesForApi(submitted.timeRange);
    return compactParams({
      keyword: submitted.keyword,
      types: submitted.types.length ? submitted.types.join(',') : undefined,
      ownerId: submitted.ownerId,
      folderId: submitted.folderId,
      lifecycle: submitted.lifecycle,
      updatedStart,
      updatedEnd,
    });
  }, [catalog.submittedParams]);
  const templateFilterQuery = useMemo(() => compactParams({
    keyword: templates.submittedParams.keyword,
    type: templates.submittedParams.type,
  }), [templates.submittedParams]);
  const catalogQuery = useReportAssetCatalog({ page: catalog.page, pageSize: catalog.pageSize, ...catalogFilterQuery });
  const usageQuery = useReportAssetUsage(usageTarget?.resourceType, usageTarget?.resourceId, usageDays, !!usageTarget);
  const templatesQuery = useReportAssetTemplateList({ page: templates.page, pageSize: templates.pageSize, ...templateFilterQuery });
  const { page, pageSize, buildPagination } = usagePagination;
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

  const templateModal = useEditModal<ReportAssetTemplate, Record<string, unknown>>({
    entityName: '资产模板',
    save: saveTemplateMutation,
    defaults: { type: 'dashboard', content: '{}', status: 'enabled' },
    labelWidth: 92,
    toValues: (record) => ({ ...record, content: JSON.stringify(record.content, null, 2) }),
    beforeSave: (values) => {
      const content = parseJsonObject(String(values.content ?? '{}'), '模板内容');
      return {
        ...values,
        code: values.code,
        folderId: values.folderId || null,
        ownerId: values.ownerId || null,
        description: values.description || null,
        content,
        previewFileId: null,
      };
    },
    successMessage: ({ isEdit }) => isEdit ? '模板已更新' : '模板已创建',
  });
  const openTemplate = (record?: ReportAssetTemplate) => {
    if (record) templateModal.openEdit(record);
    else templateModal.openCreate();
  };
  const cloneTemplate = (record: ReportAssetTemplate) => {
    Modal.confirm({
      title: `克隆模板「${record.name}」？`,
      content: <Input id="asset-template-clone-name" defaultValue={`${record.name} 副本`} />,
      onOk: async () => {
        const name = (document.querySelector('#asset-template-clone-name') as HTMLInputElement | null)?.value.trim();
        if (!name) { Toast.error('请输入副本名称'); abortSubmit(); }
        await cloneTemplateMutation.mutateAsync({ params: { id: record.id }, body: { name, folderId: record.folderId } });
        Toast.success('模板已克隆');
      },
    });
  };
  const applyTemplate = (record: ReportAssetTemplate) => {
    Modal.confirm({
      title: `应用模板「${record.name}」？`,
      content: '系统将按模板类型创建对应资源；如需指定名称，可在创建后继续编辑。',
      onOk: async () => {
        const result = await applyTemplateMutation.mutateAsync({ params: { id: record.id }, body: normalizeTemplateApplyValues({}) });
        Toast.success(`已创建${resourceTypeOptions.find((item) => item.value === result.resourceType)?.label ?? '资源'}：${result.name}`);
      },
    });
  };

  const deprecationModal = useEditModal<ReportDeprecationNotice, Record<string, unknown>>({
    entityName: '弃用公告',
    save: saveNoticeMutation,
    defaults: {},
    labelWidth: 105,
    beforeSave: (values, { isEdit }) => {
      const common = {
        title: values.title,
        message: values.message,
        replacementResourceType: values.replacementResourceType || null,
        replacementResourceId: values.replacementResourceId || null,
        effectiveAt: formatDateTimeForApi(values.effectiveAt as Date),
        expiresAt: values.expiresAt ? formatDateTimeForApi(values.expiresAt as Date) : null,
      };
      return isEdit ? common : { ...common, resourceType: values.resourceType, resourceId: Number(values.resourceId) };
    },
    successMessage: ({ isEdit }) => isEdit ? '弃用公告已更新' : '弃用公告已创建',
  });
  const openNotice = (record?: ReportDeprecationNotice) => {
    if (record) deprecationModal.openEdit(record);
    else deprecationModal.openCreate();
  };

  const catalogColumns: ColumnProps<ReportAssetCatalogItem>[] = [
    { title: '资产名称', dataIndex: 'name', minWidth: 210, render: renderEllipsis },
    { title: '类型', dataIndex: 'resourceType', width: 130, render: (v) => resourceTypeOptions.find((item) => item.value === v)?.label ?? v },
    { title: '负责人', dataIndex: 'ownerName', width: 130, render: (v) => v || EMPTY_PLACEHOLDER },
    { title: '目录', dataIndex: 'folderName', width: 150, render: (v) => v || EMPTY_PLACEHOLDER },
    { title: '生命周期', dataIndex: 'lifecycleStatus', width: 110, render: (v: string | null) => v ? <Tag>{REPORT_DASHBOARD_LIFECYCLE_LABELS[v as keyof typeof REPORT_DASHBOARD_LIFECYCLE_LABELS] ?? v}</Tag> : EMPTY_PLACEHOLDER },
    dateTimeColumn('更新时间', 'updatedAt'),
    {
      title: '状态', dataIndex: 'status', width: 100, fixed: 'right',
      render: (v: string | null, r) => r.deprecationEffectiveAt
        ? <Tag color="orange">即将弃用</Tag>
        // eslint-disable-next-line no-restricted-syntax -- 三态：enabled / disabled / 其它生命周期值（正常）
        : <Tag color={v === 'enabled' ? 'green' : v === 'disabled' ? 'grey' : undefined}>{v === 'enabled' ? '启用' : v === 'disabled' ? '停用' : v || '正常'}</Tag>,
    },
    createOperationColumn<ReportAssetCatalogItem>({
      width: 150,
      desktopInlineKeys: ['impact'],
      actions: (record) => [
        { key: 'impact', label: '使用影响', hidden: !hasPermission('report:asset:usage'), onClick: () => setUsageTarget(record) },
        {
          key: 'deprecate', label: '发布弃用', danger: true, hidden: !hasPermission('report:deprecation:create'),
          onClick: () => {
            deprecationModal.openCreate();
            setTimeout(() => deprecationModal.formApi.current?.setValues({ resourceType: record.resourceType, resourceId: record.resourceId }), 0);
          },
        },
      ],
    }),
  ];
  const templateColumns: ColumnProps<ReportAssetTemplate>[] = [
    { title: '模板名称', dataIndex: 'name', minWidth: 190, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 150, render: renderEllipsis },
    { title: '类型', dataIndex: 'type', width: 130, render: (v) => templateTypeOptions.find((item) => item.value === v)?.label ?? v },
    { title: '负责人', dataIndex: 'ownerName', width: 120, render: (v) => v || EMPTY_PLACEHOLDER },
    { title: '版本/使用', width: 120, render: (_v, r) => `v${r.version} / ${r.usageCount}` },
    dateTimeColumn('更新时间', 'updatedAt'),
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: renderEnabledStatusTag },
    createOperationColumn<ReportAssetTemplate>({
      width: 180,
      desktopInlineKeys: ['apply', 'edit'],
      actions: (record) => [
        { key: 'apply', label: '应用', hidden: !hasPermission('report:asset-template:apply'), onClick: () => applyTemplate(record) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:asset-template:update'), onClick: () => openTemplate(record) },
        { key: 'preview', label: '预览', onClick: () => setPreviewTemplate(record) },
        { key: 'clone', label: '克隆', hidden: !hasPermission('report:asset-template:create'), onClick: () => cloneTemplate(record) },
        deleteAction({
          hidden: !hasPermission('report:asset-template:delete'),
          title: `删除模板「${record.name}」？`,
          run: () => deleteTemplateMutation.mutateAsync({ params: { id: record.id } }),
          successMessage: '模板已删除',
        }),
      ],
    }),
  ];
  const noticeColumns: ColumnProps<ReportDeprecationNotice>[] = [
    { title: '公告标题', dataIndex: 'title', minWidth: 220, render: renderEllipsis },
    { title: '资源', width: 150, render: (_v, r) => `${r.resourceType} #${r.resourceId}` },
    dateTimeColumn('生效时间', 'effectiveAt'),
    dateTimeColumn('到期时间', 'expiresAt'),
    { title: '状态', dataIndex: 'publishedAt', width: 100, fixed: 'right', render: (v) => <Tag color={v ? 'orange' : 'grey'}>{v ? '已发布' : '草稿'}</Tag> },
    createOperationColumn<ReportDeprecationNotice>({
      width: 210,
      desktopInlineKeys: ['publish', 'edit'],
      actions: (record) => [
        {
          key: 'publish', label: record.publishedAt ? '撤销发布' : '发布', danger: !!record.publishedAt, hidden: !hasPermission('report:deprecation:publish'),
          onClick: () => { Modal.confirm({
            title: record.publishedAt ? '撤销该弃用公告？' : '发布该弃用公告？',
            onOk: async () => {
              await publishNoticeMutation.mutateAsync({ params: { id: record.id }, body: { publish: !record.publishedAt } });
              Toast.success(record.publishedAt ? '已撤销发布' : '已发布');
            },
          }); },
        },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:deprecation:update'), onClick: () => openNotice(record) },
        deleteAction({
          hidden: !hasPermission('report:deprecation:delete'),
          title: '删除弃用公告？',
          run: () => deleteNoticeMutation.mutateAsync({ params: { id: record.id } }),
          successMessage: '公告已删除',
        }),
      ],
    }),
  ];
  const usageColumns: ColumnProps<ReportAssetUsageSummary>[] = [
    { title: '资源', minWidth: 150, render: (_v, r) => `${r.resourceType} #${r.resourceId}` },
    { title: '查看', dataIndex: 'views', width: 90 },
    { title: '查询', dataIndex: 'queries', width: 90 },
    { title: '导出', dataIndex: 'exports', width: 90 },
    { title: '独立用户', dataIndex: 'uniqueUsers', width: 100 },
    dateTimeColumn('最后使用', 'lastUsedAt'),
    { title: '状态', dataIndex: 'deprecated', width: 100, fixed: 'right', render: (v) => <Tag color={v ? 'orange' : 'green'}>{v ? '已弃用' : '正常'}</Tag> },
  ];
  const trendColumns: ColumnProps<ReportAssetUsageTrendPoint>[] = [
    dateTimeColumn('日期', 'bucket'),
    { title: '查看', dataIndex: 'views', width: 90 },
    { title: '查询', dataIndex: 'queries', width: 90 },
    { title: '导出', dataIndex: 'exports', width: 90 },
    { title: '嵌入', dataIndex: 'embeds', width: 90 },
    { title: '分享', dataIndex: 'shares', width: 90 },
    { title: '独立用户', dataIndex: 'uniqueUsers', width: 100 },
  ];

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(key) => { setActiveTab(key as typeof activeTab); catalog.setPage(1); templates.setPage(1); usagePagination.setPage(1); }}>
        <TabPane tab="统一资产目录" itemKey="catalog">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="搜索资产名称" {...catalog.bindKeyword('keyword')} />}
            filters={<>
              <Select multiple placeholder="资产类型" optionList={resourceTypeOptions} style={{ width: 210 }} {...catalog.bind('types', (value) => (value ?? []) as ReportResourceType[])} />
              <ReportOwnerFilter items={userOptions} {...catalog.bind('ownerId')} width={150} />
              <ReportFolderFilter
                items={folders.map((f) => ({ value: f.id, label: `[${f.resourceType}] ${f.name}` }))}
                {...catalog.bind('folderId')}
                width={180}
              />
              <FilterSelect
                placeholder="全部生命周期"
                items={['draft', 'published', 'deprecated'].map((value) => ({ value, label: value === 'deprecated' ? '已弃用' : REPORT_DASHBOARD_LIFECYCLE_LABELS[value as keyof typeof REPORT_DASHBOARD_LIFECYCLE_LABELS] ?? value }))}
                {...catalog.bind('lifecycle')}
                width={140}
              />
              <DateRangeFilter {...catalog.bind('timeRange')} />
            </>}
            onSearch={catalog.handleSearch}
            onReset={catalog.handleReset}
            actions={<ExportButton entity="report.assets" query={catalogFilterQuery} />}
          />
          {catalogQuery.isError && <Banner type="danger" description={catalogQuery.error instanceof Error ? catalogQuery.error.message : '资产目录加载失败'} />}
          <ConfigurableTable<ReportAssetCatalogItem> columns={catalogColumns} {...listTableProps(catalogQuery, { rowKey: (r) => `${r!.resourceType}-${r!.resourceId}`, pagination: catalog.buildPagination, empty: <Empty title="暂无匹配资产" /> })} />
        </TabPane>

        <TabPane tab="可复用模板" itemKey="templates">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="搜索模板名称/编码" {...templates.bindKeyword('keyword')} width={230} />}
            filters={<FilterSelect placeholder="全部模板类型" items={templateTypeOptions} {...templates.bind('type')} width={150} />}
            onSearch={templates.handleSearch}
            onReset={templates.handleReset}
            create={hasPermission('report:asset-template:create') ? <CreateButton onClick={() => openTemplate()} /> : null}
          />
          {templatesQuery.isError && <Banner type="danger" description="资产模板加载失败" />}
          <ConfigurableTable<ReportAssetTemplate> columns={templateColumns} {...listTableProps(templatesQuery, { pagination: templates.buildPagination, empty: <Empty title="暂无资产模板" /> })} />
        </TabPane>

        <TabPane tab="使用与弃用" itemKey="usage">
          <SearchToolbar>
            <Select value={usageDays} optionList={[{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }, { value: 90, label: '近 90 天' }]} style={{ width: 130 }} onChange={(v) => setUsageDays(Number(v))} />
            {hasPermission('report:deprecation:create') ? <CreateButton onClick={() => openNotice()}>新增弃用公告</CreateButton> : null}
          </SearchToolbar>
          {(topQuery.isError || trendQuery.isError || inactiveQuery.isError || noticesQuery.isError) && <Banner type="danger" description="部分资产使用数据加载失败，可点击对应表格刷新重试。" />}
          <Typography.Title heading={5}>高频资产</Typography.Title>
          <ConfigurableTable<ReportAssetUsageSummary> columns={usageColumns} {...listTableProps(topQuery, { rowKey: (r) => `${r!.resourceType}-${r!.resourceId}`, empty: <Empty title="暂无使用数据" /> })} />
          <Typography.Title heading={5} style={{ marginTop: 20 }}>使用趋势</Typography.Title>
          <ConfigurableTable<ReportAssetUsageTrendPoint> columns={trendColumns} {...listTableProps(trendQuery, { rowKey: 'bucket', empty: <Empty title="暂无趋势数据" /> })} />
          <Typography.Title heading={5} style={{ marginTop: 20 }}>闲置资产</Typography.Title>
          <ConfigurableTable<ReportAssetCatalogItem> columns={catalogColumns} {...listTableProps(inactiveQuery, { rowKey: (r) => `${r!.resourceType}-${r!.resourceId}`, pagination: buildPagination, empty: <Empty title="暂无闲置资产" /> })} />
          <Typography.Title heading={5} style={{ marginTop: 20 }}>弃用公告</Typography.Title>
          <ConfigurableTable<ReportDeprecationNotice> columns={noticeColumns} {...listTableProps(noticesQuery, { pagination: buildPagination, empty: <Empty title="暂无弃用公告" /> })} />
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

      <AppModal {...templateModal.modalProps} width={680}>
        <Form key={templateModal.formKey} {...templateModal.formProps}>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Input field="name" label="模板名称" rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Input field="code" label="模板编码" disabled={templateModal.isEdit} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="type" label="模板类型" style={{ width: '100%' }} optionList={templateTypeOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="ownerId" label="负责人" filter showClear style={{ width: '100%' }} optionList={userOptions} /></Col>
            <Col xs={24} md={12}><Form.Select field="folderId" label="模板目录" filter showClear style={{ width: '100%' }} optionList={templateFolders.map((f) => ({ value: f.id, label: f.name }))} /></Col>
          </Row>
          <Form.TextArea field="description" label="说明" autosize rows={2} />
          <Form.TextArea field="content" label="模板 JSON" autosize rows={9} rules={[{ required: true }]} />
        </Form>
      </AppModal>

      <AppModal {...deprecationModal.modalProps} width={680}>
        <Form key={deprecationModal.formKey} {...deprecationModal.formProps}>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Select field="resourceType" label="资源类型" disabled={deprecationModal.isEdit} style={{ width: '100%' }} optionList={resourceTypeOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="resourceId" label="资源 ID" disabled={deprecationModal.isEdit} min={1} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
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
        <JsonBlock value={previewTemplate ? previewTemplate.content : ''} style={{ marginTop: 12 }} maxHeight={480} />
      </SideSheet>
    </div>
  );
}
