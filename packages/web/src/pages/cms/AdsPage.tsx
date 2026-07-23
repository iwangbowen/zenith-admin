import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Form, Tag, Toast, Modal, Tabs, TabPane, Select, SideSheet, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsAdSlots, useSaveCmsAdSlot, useDeleteCmsAdSlot,
  useCmsAdList, useSaveCmsAd, useDeleteCmsAd,
  cmsAdEventKeys, useCleanupCmsAdEvents, useCmsAdEventList, useCmsAdEventStats,
  useCmsPublishChannels,
} from '@/hooks/queries/cms';
import {
  CMS_AD_EVENT_TYPE_LABELS,
  CMS_DEVICE_TYPE_LABELS,
  type CmsAdEvent,
  type CmsAdSlot,
  type CmsAd,
} from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

// ─── 广告位 Tab ───────────────────────────────────────────────────────────────
function SlotsTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsAdSlot | null>(null);

  const slotsQuery = useCmsAdSlots(siteId);
  const saveMutation = useSaveCmsAdSlot();
  const deleteMutation = useDeleteCmsAdSlot();
  const canManage = hasPermission('cms:ad:manage');

  async function handleModalOk() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!editingRecord) values.siteId = siteId;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsAdSlot>[] = [
    { title: '广告位名称', dataIndex: 'name', width: 180 },
    { title: '模板引用标识', dataIndex: 'code', width: 160, render: (v: string) => <Tag size="small">{v}</Tag> },
    { title: '投放广告数', dataIndex: 'adCount', width: 110 },
    { title: '备注', dataIndex: 'remark', width: 220, render: (v: string | null) => v ?? '-' },
    createOperationColumn<CmsAdSlot>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => { setEditingRecord(record); setModalVisible(true); } },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该广告位吗？',
              content: '需先清空广告位下的广告',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
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
        {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增广告位</Button> : null}
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
      <AppModal
        title={editingRecord ? '编辑广告位' : '新增广告位'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord ? { code: editingRecord.code, name: editingRecord.name, remark: editingRecord.remark ?? '' } : {}}
          labelPosition="left"
          labelWidth={100}
        >
          <Form.Input field="name" label="广告位名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="code" label="引用标识" disabled={!!editingRecord} placeholder="如 home-ad（主题模板中引用）" rules={[{ required: true, message: '请输入标识' }]} />
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>
    </>
  );
}

// ─── 广告投放 Tab ─────────────────────────────────────────────────────────────
function AdsTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [slotFilter, setSlotFilter] = useState<number | undefined>(undefined);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsAd | null>(null);

  const slotsQuery = useCmsAdSlots(siteId);
  const listQuery = useCmsAdList({ page, pageSize, siteId: siteId ?? 0, slotId: slotFilter }, siteId !== undefined);
  const saveMutation = useSaveCmsAd();
  const deleteMutation = useDeleteCmsAd();
  const canManage = hasPermission('cms:ad:manage');

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (values.startAt instanceof Date) values.startAt = formatDateTimeForApi(values.startAt);
    if (values.endAt instanceof Date) values.endAt = formatDateTimeForApi(values.endAt);
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsAd>[] = [
    { title: '广告名称', dataIndex: 'name', width: 180 },
    { title: '广告位', dataIndex: 'slotName', width: 140 },
    { title: '跳转地址', dataIndex: 'linkUrl', width: 200, render: (v: string | null) => v ?? '-' },
    { title: '曝光量', dataIndex: 'viewCount', width: 90, align: 'right' },
    { title: '点击量', dataIndex: 'clickCount', width: 90, align: 'right' },
    {
      title: 'CTR', dataIndex: 'ctr', width: 90, align: 'right',
      render: (_: unknown, record) => record.viewCount > 0 ? `${Math.round((record.clickCount / record.viewCount) * 1000) / 10}%` : '-',
    },
    { title: '开始时间', dataIndex: 'startAt', width: 180, render: (v: string | null) => v ?? '不限' },
    { title: '结束时间', dataIndex: 'endAt', width: 180, render: (v: string | null) => v ?? '不限' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsAd>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => { setEditingRecord(record); setModalVisible(true); } },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该广告吗？',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
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
        <Select
          placeholder="全部广告位"
          value={slotFilter}
          onChange={(v) => { setSlotFilter(v as number | undefined); setPage(1); }}
          showClear
          style={{ width: 180 }}
          optionList={(slotsQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增广告</Button> : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无广告"
        scroll={{ x: 1210 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />
      <AppModal
        title={editingRecord ? '编辑广告' : '新增广告'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={560}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord
            ? {
                slotId: editingRecord.slotId, name: editingRecord.name, image: editingRecord.image ?? '',
                linkUrl: editingRecord.linkUrl ?? '', startAt: editingRecord.startAt ?? undefined,
                endAt: editingRecord.endAt ?? undefined, sort: editingRecord.sort, status: editingRecord.status,
              }
            : { sort: 0, status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
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
  publishChannelId?: number;
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
  const adsQuery = useCmsAdList({ page: 1, pageSize: 1000, siteId: siteId ?? 0 }, !!siteId);
  const channelsQuery = useCmsPublishChannels(siteId);
  const params = {
    page,
    pageSize,
    siteId: siteId ?? 0,
    ...submitted,
    timeRange: undefined,
    startTime: submitted.timeRange ? formatDateTimeForApi(submitted.timeRange[0]) : undefined,
    endTime: submitted.timeRange ? formatDateTimeForApi(submitted.timeRange[1]) : undefined,
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

  const filterFields = (
    <>
      <Select placeholder="全部广告" showClear value={draft.adId} style={{ width: 160 }}
        optionList={(adsQuery.data?.list ?? []).map((ad) => ({ value: ad.id, label: ad.name }))}
        onChange={(value) => setDraft((current) => ({ ...current, adId: value as number | undefined }))} />
      <Select placeholder="全部广告位" showClear value={draft.slotId} style={{ width: 160 }}
        optionList={(slotsQuery.data ?? []).map((slot) => ({ value: slot.id, label: slot.name }))}
        onChange={(value) => setDraft((current) => ({ ...current, slotId: value as number | undefined }))} />
      <Select placeholder="事件类型" showClear value={draft.eventType} style={{ width: 130 }}
        optionList={Object.entries(CMS_AD_EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(value) => setDraft((current) => ({ ...current, eventType: value as AdEventSearch['eventType'] }))} />
      <Select placeholder="设备" showClear value={draft.device} style={{ width: 130 }}
        optionList={Object.entries(CMS_DEVICE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(value) => setDraft((current) => ({ ...current, device: value as AdEventSearch['device'] }))} />
      <Select placeholder="发布通道" showClear value={draft.publishChannelId} style={{ width: 150 }}
        optionList={(channelsQuery.data ?? []).map((channel) => ({ value: channel.id, label: channel.name }))}
        onChange={(value) => setDraft((current) => ({ ...current, publishChannelId: value as number | undefined }))} />
      <DatePicker type="dateTimeRange" value={draft.timeRange}
        onChange={(value) => setDraft((current) => ({ ...current, timeRange: value as [Date, Date] | undefined }))}
        placeholder={['发生开始时间', '发生结束时间']} style={{ width: 330 }} />
    </>
  );

  const columns: ColumnProps<CmsAdEvent>[] = [
    { title: '发生时间', dataIndex: 'occurredAt', width: 180 },
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
    { title: '发布通道', dataIndex: 'publishChannelName', width: 140, render: (value: string | null) => value ?? '-' },
    { title: '页面路径', dataIndex: 'path', width: 220, render: (value: string | null) => value ?? '-' },
    { title: '会员 ID', dataIndex: 'memberId', width: 100, render: (value: number | null) => value ?? '-' },
    createOperationColumn<CmsAdEvent>({
      width: 90,
      desktopInlineKeys: ['view'],
      actions: (record) => [{ key: 'view', label: '查看', onClick: () => setDetail(record) }],
    }),
  ];

  const exportQuery = {
    siteId,
    ...submitted,
    timeRange: undefined,
    startTime: submitted.timeRange ? formatDateTimeForApi(submitted.timeRange[0]) : undefined,
    endTime: submitted.timeRange ? formatDateTimeForApi(submitted.timeRange[1]) : undefined,
  };

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); setPage(1); }} />
            {filterFields}
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        actions={(
          <>
            {siteId && hasPermission('cms:ad-event:export')
              ? <ExportButton entity="cms.ad-events" query={exportQuery} />
              : null}
            {hasPermission('cms:ad-event:cleanup') ? (
              <Button
                type="danger"
                icon={<Trash2 size={14} />}
                loading={cleanupMutation.isPending}
                disabled={!siteId}
                onClick={() => {
                  Modal.confirm({
                    title: '按保留策略清理广告事件？',
                    content: '将提交到任务中心分批执行，可查看进度、取消或重试。',
                    okButtonProps: { type: 'danger', theme: 'solid' },
                    onOk: async () => {
                      await cleanupMutation.mutateAsync({ siteId });
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
            <CmsSiteSelect value={siteId} onChange={setSiteId} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          </>
        )}
        mobileFilters={filterFields}
        mobileActions={siteId && hasPermission('cms:ad-event:export')
          ? <ExportButton entity="cms.ad-events" query={exportQuery} variant="flat" />
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
        scroll={{ x: 1260 }}
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
    startTime: submitted.timeRange ? formatDateTimeForApi(submitted.timeRange[0]) : undefined,
    endTime: submitted.timeRange ? formatDateTimeForApi(submitted.timeRange[1]) : undefined,
  };
  const statsQuery = useCmsAdEventStats(params, !!siteId);
  const columns: ColumnProps<NonNullable<typeof statsQuery.data>['trend'][number]>[] = [
    { title: '日期', dataIndex: 'date', width: 160 },
    { title: '曝光', dataIndex: 'impressions', width: 120, align: 'right' },
    { title: '点击', dataIndex: 'clicks', width: 120, align: 'right' },
    { title: 'CTR', dataIndex: 'ctr', width: 120, align: 'right', render: (value: number) => `${value}%` },
  ];
  return (
    <>
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} />
        <Select placeholder="事件类型" showClear value={draft.eventType} style={{ width: 140 }}
          optionList={Object.entries(CMS_AD_EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(value) => setDraft((current) => ({ ...current, eventType: value as AdEventSearch['eventType'] }))} />
        <Select placeholder="设备" showClear value={draft.device} style={{ width: 140 }}
          optionList={Object.entries(CMS_DEVICE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(value) => setDraft((current) => ({ ...current, device: value as AdEventSearch['device'] }))} />
        <DatePicker type="dateTimeRange" value={draft.timeRange}
          onChange={(value) => setDraft((current) => ({ ...current, timeRange: value as [Date, Date] | undefined }))}
          placeholder={['统计开始时间', '统计结束时间']} style={{ width: 330 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={() => setSubmitted(draft)}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setDraft({}); setSubmitted({}); }}>重置</Button>
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
  const [activeTab, setActiveTab] = useState('ads');

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={setActiveTab} type="line" lazyRender keepDOM={false}>
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
