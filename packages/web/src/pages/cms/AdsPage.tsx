import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Tag, Toast, Tabs, TabPane, SideSheet, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { formatDateTimeForApi, formatDateTimeRangeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsAdSlots, useSaveCmsAdSlot, useDeleteCmsAdSlot,
  useCmsAdList, useSaveCmsAd, useDeleteCmsAds,
  cmsAdEventKeys, useCleanupCmsAdEvents, useCmsAdEventList, useCmsAdEventStats,
} from '@/hooks/queries/cms';
import { CMS_AD_EVENT_TYPE_LABELS, CMS_DEVICE_TYPE_LABELS, CMS_AD_EVENT_TYPE_OPTIONS, CMS_DEVICE_TYPE_OPTIONS } from '@zenith/shared/cms';
import type { CmsAdEvent, CmsAdSlot, CmsAd } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { dateColumn, dateTimeColumn, renderEllipsis, renderEnabledStatusTag } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';

import { useUrlTabState } from '@/hooks/useUrlTabState';
// ─── 广告位 Tab ───────────────────────────────────────────────────────────────
function SlotsTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const slotsQuery = useCmsAdSlots(siteId);
  const saveMutation = useSaveCmsAdSlot();
  const slotModal = useEditModal<CmsAdSlot, Record<string, unknown>, Record<string, unknown>>({
    entityName: '广告位',
    save: saveMutation,
    labelWidth: 100,
    toValues: (record) => ({ code: record.code, name: record.name, remark: record.remark ?? '' }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      return { ...values, ...(!isEdit ? { siteId } : {}) };
    },
  });
  const deleteMutation = useDeleteCmsAdSlot();
  const canManage = hasPermission('cms:ad:manage');

  const columns: ColumnProps<CmsAdSlot>[] = [
    { title: '广告位名称', dataIndex: 'name', width: 180 },
    { title: '模板引用标识', dataIndex: 'code', width: 160, render: (v: string) => <Tag size="small">{v}</Tag> },
    { title: '投放广告数', dataIndex: 'adCount', width: 110, align: 'right' },
    { title: '备注', dataIndex: 'remark', minWidth: 220, render: (v: string | null) => v ?? '-' },
    createOperationColumn<CmsAdSlot>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => slotModal.openEdit(record) },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该广告位吗？',
              content: '需先清空广告位下的广告',
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('删除成功');
              },
            });
          },
        },
      ] : [],
    }),
  ];

  return (
    <>
      <SearchToolbar>
        {canManage ? <CreateButton onClick={slotModal.openCreate}>新增广告位</CreateButton> : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={slotsQuery.data ?? []}
        loading={slotsQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无广告位；默认主题支持 home-ad（首页横幅下方）"
        onRefresh={() => void slotsQuery.refetch()}
        refreshLoading={slotsQuery.isFetching}
        pagination={false}
      />
      <AppModal {...slotModal.modalProps} width={480}>
        <Form key={slotModal.formKey} {...slotModal.formProps}>
          <Form.Input field="name" label="广告位名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="code" label="引用标识" disabled={slotModal.isEdit} placeholder="如 home-ad（主题模板中引用）" rules={[{ required: true, message: '请输入标识' }]} />
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>
    </>
  );
}

// ─── 广告投放 Tab ─────────────────────────────────────────────────────────────
function AdsTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [slotFilter, setSlotFilter] = useState<number | undefined>(undefined);
  const slotsQuery = useCmsAdSlots(siteId);
  const listQuery = useCmsAdList({ page, pageSize, siteId: siteId ?? 0, slotId: slotFilter }, siteId !== undefined);
  useEffect(() => {
    setSlotFilter(undefined);
    setPage(1);
  }, [setPage, siteId]);
  const saveMutation = useSaveCmsAd();
  const adModal = useEditModal<CmsAd, Record<string, unknown>, Record<string, unknown>>({
    entityName: '广告',
    save: saveMutation,
    defaults: { sort: 0, status: 'enabled' },
    toValues: (record) => ({
      slotId: record.slotId,
      name: record.name,
      image: record.image ?? '',
      linkUrl: record.linkUrl ?? '',
      startAt: record.startAt ?? null,
      endAt: record.endAt ?? null,
      sort: record.sort,
      status: record.status,
    }),
    beforeSave: (values) => ({
      ...values,
      // DatePicker clearing is an explicit null mutation; undefined would be
      // omitted by JSON serialization and leave the previous window in place.
      startAt: values.startAt instanceof Date ? formatDateTimeForApi(values.startAt) : (values.startAt ?? null),
      endAt: values.endAt instanceof Date ? formatDateTimeForApi(values.endAt) : (values.endAt ?? null),
    }),
  });
  const deleteMutation = useDeleteCmsAds();
  const canManage = hasPermission('cms:ad:manage');

  const columns: ColumnProps<CmsAd>[] = [
    { title: '广告名称', dataIndex: 'name', width: 180 },
    { title: '广告位', dataIndex: 'slotName', width: 140 },
    { title: '跳转地址', dataIndex: 'linkUrl', minWidth: 200, render: (v: string | null) => renderEllipsis(v ?? '-') },
    { title: '曝光量', dataIndex: 'viewCount', width: 90, align: 'right' },
    { title: '点击量', dataIndex: 'clickCount', width: 90, align: 'right' },
    {
      title: 'CTR', dataIndex: 'ctr', width: 90, align: 'right',
      render: (_: unknown, record) => record.viewCount > 0 ? `${Math.round((record.clickCount / record.viewCount) * 1000) / 10}%` : '-',
    },
    dateTimeColumn('开始时间', 'startAt', { empty: '不限' }),
    dateTimeColumn('结束时间', 'endAt', { empty: '不限' }),
    { title: '排序', dataIndex: 'sort', width: 70 },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: renderEnabledStatusTag,
    },
    createOperationColumn<CmsAd>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => adModal.openEdit(record) },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该广告吗？',
              onOk: async () => {
                await deleteMutation.mutateAsync([record.id]);
                Toast.success('删除成功');
              },
            });
          },
        },
      ] : [],
    }),
  ];

  return (
    <>
      <SearchToolbar>
        <FilterSelect
          placeholder="全部广告位"
          items={(slotsQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          value={slotFilter}
          onChange={(v) => { setSlotFilter(v as number | undefined); setPage(1); }}
          width={180}
        />
        {canManage ? <CreateButton onClick={adModal.openCreate}>新增广告</CreateButton> : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无广告"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />
      <AppModal {...adModal.modalProps} width={560}>
        <Form key={adModal.formKey} {...adModal.formProps}>
          <Form.Select field="slotId" label="广告位" style={{ width: '100%' }} rules={[{ required: true, message: '请选择广告位' }]}
            optionList={(slotsQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <Form.Input field="name" label="广告名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="image" label="图片 URL" placeholder="留空显示文字条" />
          <Form.Input field="linkUrl" label="跳转地址" placeholder="/products/enterprise.html 或 https://..." />
          <Form.DatePicker field="startAt" label="开始时间" type="dateTime" density="compact" style={{ width: '100%' }} placeholder="不限" />
          <Form.DatePicker field="endAt" label="结束时间" type="dateTime" density="compact" style={{ width: '100%' }} placeholder="不限" />
          <Form.InputNumber field="sort" label="排序" style={{ width: 160 }} />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
        </Form>
      </AppModal>
    </>
  );
}

interface AdEventSearch {
  adId?: number;
  slotId?: number;
  eventType?: 'impression' | 'click';
  device?: 'pc' | 'mobile' | 'bot';
  timeRange?: [Date, Date];
}

function EventsTab({ siteId, setSiteId }: Readonly<{
  siteId: number | undefined;
  setSiteId: (siteId: number | undefined) => void;
}>) {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draft, setDraft] = useState<AdEventSearch>({});
  const [submitted, setSubmitted] = useState<AdEventSearch>({});
  const [detail, setDetail] = useState<CmsAdEvent | null>(null);
  const slotsQuery = useCmsAdSlots(siteId);
  // The API caps paginated lists at 200. Keep the lookup request within that
  // contract; the event table itself remains independently paginated.
  const adsQuery = useCmsAdList({ page: 1, pageSize: 200, siteId: siteId ?? 0 }, !!siteId);
  const params = {
    page,
    pageSize,
    siteId: siteId ?? 0,
    ...submitted,
    timeRange: undefined,
    ...formatDateTimeRangeForApi(submitted.timeRange),
  };
  const listQuery = useCmsAdEventList(params, !!siteId);
  const cleanupMutation = useCleanupCmsAdEvents();

  const handleSearch = () => {
    setPage(1);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: cmsAdEventKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setDraft({});
    setSubmitted({});
    void queryClient.invalidateQueries({ queryKey: cmsAdEventKeys.lists });
  };

  const handleSiteChange = (value: number | undefined) => {
    setSiteId(value);
    setPage(1);
    // Ad and slot IDs are site-scoped; never carry them into another site.
    setDraft({});
    setSubmitted({});
    setDetail(null);
  };

  const filterFields = (
    <>
      <FilterSelect
        placeholder="全部广告"
        items={(adsQuery.data?.list ?? []).map((ad) => ({ value: ad.id, label: ad.name }))}
        value={draft.adId}
        onChange={(value) => setDraft((current) => ({ ...current, adId: value as number | undefined }))}
        width={160}
      />
      <FilterSelect
        placeholder="全部广告位"
        items={(slotsQuery.data ?? []).map((slot) => ({ value: slot.id, label: slot.name }))}
        value={draft.slotId}
        onChange={(value) => setDraft((current) => ({ ...current, slotId: value as number | undefined }))}
        width={160}
      />
      <FilterSelect
        placeholder="全部事件类型"
        items={CMS_AD_EVENT_TYPE_OPTIONS}
        value={draft.eventType}
        onChange={(value) => setDraft((current) => ({ ...current, eventType: value as AdEventSearch['eventType'] }))}
        width={140}
      />
      <FilterSelect
        placeholder="全部设备"
        items={CMS_DEVICE_TYPE_OPTIONS}
        value={draft.device}
        onChange={(value) => setDraft((current) => ({ ...current, device: value as AdEventSearch['device'] }))}
      />
      <DateRangeFilter placeholder={['发生开始时间', '发生结束时间']} value={draft.timeRange} onChange={(value) => setDraft((current) => ({ ...current, timeRange: value as [Date, Date] | undefined }))} width={330} />
    </>
  );

  const columns: ColumnProps<CmsAdEvent>[] = [
    dateTimeColumn('发生时间', 'occurredAt'),
    {
      title: '事件', dataIndex: 'eventType', width: 90,
      render: (value: CmsAdEvent['eventType']) => <Tag size="small">{CMS_AD_EVENT_TYPE_LABELS[value]}</Tag>,
    },
    { title: '广告', dataIndex: 'adName', width: 180 },
    { title: '广告位', dataIndex: 'slotName', width: 150 },
    {
      title: '设备', dataIndex: 'device', width: 100,
      render: (value: CmsAdEvent['device']) => CMS_DEVICE_TYPE_LABELS[value],
    },
    { title: '页面路径', dataIndex: 'path', minWidth: 220, render: (value: string | null) => value ?? '-' },
    { title: '会员 ID', dataIndex: 'memberId', width: 100, render: (value: number | null) => value ?? '-' },
    createOperationColumn<CmsAdEvent>({
      width: 100,
      desktopInlineKeys: ['view'],
      actions: (record) => [{ key: 'view', label: '查看', onClick: () => setDetail(record) }],
    }),
  ];

  const exportQuery = {
    siteId,
    ...submitted,
    timeRange: undefined,
    ...formatDateTimeRangeForApi(submitted.timeRange),
  };

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <CmsSiteSelect value={siteId} onChange={handleSiteChange} />
            {filterFields}
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </>
        )}
        actions={(
          <>
            {siteId && hasPermission('cms:ad-event:export')
              ? <ExportButton entity="cms.ad-events" permission="cms:ad-event:export" query={exportQuery} />
              : null}
            {hasPermission('cms:ad-event:cleanup') ? (
              <Button
                type="danger"
                icon={<Trash2 size={14} />}
                loading={cleanupMutation.isPending}
                disabled={!siteId}
                onClick={() => {
                  confirmDelete({
                    title: '按保留策略清理广告事件？',
                    content: '将提交到任务中心分批执行，可查看进度、取消或重试。',
                    onOk: async () => {
                      await cleanupMutation.mutateAsync({ body: { siteId } });
                      Toast.success('清理任务已提交');
                    },
                  });
                }}
              >
                保留期清理
              </Button>
            ) : null}
          </>
        )}
        mobilePrimary={(
          <>
            <CmsSiteSelect value={siteId} onChange={handleSiteChange} />
            <SearchButton onClick={handleSearch} />
          </>
        )}
        mobileFilters={filterFields}
        mobileActions={siteId && hasPermission('cms:ad-event:export')
          ? <ExportButton entity="cms.ad-events" permission="cms:ad-event:export" query={exportQuery} variant="flat" />
          : null}
        filterTitle="广告事件筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        empty={siteId ? '暂无广告事件' : '请先选择站点'}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />
      <SideSheet title="广告事件详情" visible={!!detail} onCancel={() => setDetail(null)} width={520}>
        {detail ? (
          <dl style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12, margin: 0 }}>
            <dt>事件</dt><dd>{CMS_AD_EVENT_TYPE_LABELS[detail.eventType]}</dd>
            <dt>发生时间</dt><dd>{detail.occurredAt}</dd>
            <dt>广告</dt><dd>{detail.adName}</dd>
            <dt>页面路径</dt><dd>{detail.path ?? '-'}</dd>
            <dt>来源</dt><dd style={{ wordBreak: 'break-all' }}>{detail.referrer ?? '-'}</dd>
            <dt>访客哈希</dt><dd><Typography.Text code copyable>{detail.visitorHash}</Typography.Text></dd>
            <dt>IP 哈希</dt><dd><Typography.Text code copyable>{detail.ipHash}</Typography.Text></dd>
            <dt>User-Agent</dt><dd style={{ wordBreak: 'break-word' }}>{detail.userAgent ?? '-'}</dd>
          </dl>
        ) : null}
      </SideSheet>
    </>
  );
}

function StatsTab({ siteId, setSiteId }: Readonly<{
  siteId: number | undefined;
  setSiteId: (siteId: number | undefined) => void;
}>) {
  const [draft, setDraft] = useState<AdEventSearch>({});
  const [submitted, setSubmitted] = useState<AdEventSearch>({});
  const params = {
    siteId: siteId ?? 0,
    ...submitted,
    timeRange: undefined,
    ...formatDateTimeRangeForApi(submitted.timeRange),
  };
  const statsQuery = useCmsAdEventStats(params, !!siteId);
  const columns: ColumnProps<NonNullable<typeof statsQuery.data>['trend'][number]>[] = [
    dateColumn('日期', 'date'),
    { title: '曝光', dataIndex: 'impressions', width: 120, align: 'right' },
    { title: '点击', dataIndex: 'clicks', width: 120, align: 'right' },
    { title: 'CTR', dataIndex: 'ctr', width: 120, align: 'right', render: (value: number) => `${value}%` },
  ];
  return (
    <>
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} />
        <FilterSelect
          placeholder="全部事件类型"
          items={CMS_AD_EVENT_TYPE_OPTIONS}
          value={draft.eventType}
          onChange={(value) => setDraft((current) => ({ ...current, eventType: value as AdEventSearch['eventType'] }))}
          width={140}
        />
        <FilterSelect
          placeholder="全部设备"
          items={CMS_DEVICE_TYPE_OPTIONS}
          value={draft.device}
          onChange={(value) => setDraft((current) => ({ ...current, device: value as AdEventSearch['device'] }))}
          width={140}
        />
        <DateRangeFilter placeholder={['统计开始时间', '统计结束时间']} value={draft.timeRange} onChange={(value) => setDraft((current) => ({ ...current, timeRange: value as [Date, Date] | undefined }))} width={330} />
        <SearchButton onClick={() => setSubmitted(draft)} />
        <ResetButton onClick={() => { setDraft({}); setSubmitted({}); }} />
      </SearchToolbar>
      {statsQuery.data ? (
        <div style={{ display: 'flex', gap: 24, marginBottom: 12 }} aria-label="广告事件统计摘要">
          <Typography.Text>曝光 <strong>{statsQuery.data.summary.impressions}</strong></Typography.Text>
          <Typography.Text>点击 <strong>{statsQuery.data.summary.clicks}</strong></Typography.Text>
          <Typography.Text>CTR <strong>{statsQuery.data.summary.ctr}%</strong></Typography.Text>
        </div>
      ) : null}
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={statsQuery.data?.trend ?? []}
        loading={statsQuery.isFetching}
        rowKey="date"
        empty={siteId ? '暂无统计数据' : '请先选择站点'}
        onRefresh={() => void statsQuery.refetch()}
        refreshLoading={statsQuery.isFetching}
        pagination={false}
      />
    </>
  );
}

function AdsManagementTab({ siteId, setSiteId }: Readonly<{
  siteId: number | undefined;
  setSiteId: (siteId: number | undefined) => void;
}>) {
  return (
    <>
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
      </SearchToolbar>
      <Typography.Title heading={5}>广告位</Typography.Title>
      <SlotsTab siteId={siteId} />
      <Typography.Title heading={5} style={{ marginTop: 24 }}>广告投放</Typography.Title>
      <AdsTab siteId={siteId} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function AdsPage() {
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useUrlTabState(['ads', 'events', 'stats'] as const, 'ads');

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} type="line" lazyRender keepDOM={false}>
        <TabPane tab="广告" itemKey="ads">
          <AdsManagementTab siteId={siteId} setSiteId={setSiteId} />
        </TabPane>
        <TabPane tab="事件明细" itemKey="events">
          <EventsTab siteId={siteId} setSiteId={setSiteId} />
        </TabPane>
        <TabPane tab="统计" itemKey="stats">
          <StatsTab siteId={siteId} setSiteId={setSiteId} />
        </TabPane>
      </Tabs>
    </div>
  );
}
