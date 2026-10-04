import { useEffect, useRef, useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Button, Form, Tag, Tabs, TabPane, SideSheet, Typography, withField } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ChevronsDownUp, ChevronsUpDown, LayoutGrid, List as ListIcon, ListTree, Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { formatDateTimeForApi, formatDateTimeRangeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { useTreeExpansion, type TreeRowKey } from '@/hooks/useTreeExpansion';
import { useListSearch } from '@/hooks/useListSearch';
import {
  useCmsAdSlots, useSaveCmsAdSlot, useDeleteCmsAdSlot,
  useCmsAdList, useSaveCmsAd, useDeleteCmsAds,
  cmsAdKeys, cmsAdEventKeys, useCleanupCmsAdEvents, useCmsAdEventList, useCmsAdEventStats,
} from '@/hooks/queries/cms';
import { CMS_AD_EVENT_TYPE_LABELS, CMS_DEVICE_TYPE_LABELS, CMS_AD_EVENT_TYPE_OPTIONS, CMS_DEVICE_TYPE_OPTIONS } from '@zenith/shared/cms';
import type { CmsAdEvent, CmsAdSlot, CmsAd } from '@zenith/shared/cms';
import { percentOf } from '@zenith/shared/core';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { EMPTY_PLACEHOLDER, dateColumn, dateTimeColumn, renderEllipsis, enabledStatusColumn } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';
import { confirmAndDelete, deleteAction, listTableProps, ListSearchToolbar } from '@/components/list-page';
import { compactParams } from '@/lib/query';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import { EditFormModal, EditFormSheet } from '@/components/EditFormModal';
import { CmsAssetUrlField } from './CmsAssetUrlField';

/** 广告图片：外链手填与上传/选择共用同一 `image` 值（留空显示文字条） */
const FormAdImage = withField(CmsAssetUrlField);
// ─── 广告位管理：独立抽屉内做广告位 CRUD，避免广告 Tab 承载两套实体的表单 ──
function AdSlotSheet({ siteId, visible, onClose }: Readonly<{
  siteId: number | undefined; visible: boolean; onClose: () => void;
}>) {
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
    { title: '广告位名称', dataIndex: 'name', width: 220, render: renderEllipsis },
    { title: '模板引用标识', dataIndex: 'code', width: 160, render: (v: string) => <Tag size="small">{v}</Tag> },
    { title: '投放广告数', dataIndex: 'adCount', width: 110, align: 'right' },
    { title: '备注', dataIndex: 'remark', minWidth: 220, render: renderEllipsis },
    createOperationColumn<CmsAdSlot>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => slotModal.openEdit(record) },
        // eslint-disable-next-line no-restricted-syntax -- 按权限条件拼装的动作数组，保留 createOperationColumn
        deleteAction({
          title: '确定要删除该广告位吗？',
          content: '需先清空广告位下的广告',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
        }),
      ] : [],
    }),
  ];

  return (
    <SideSheet title="广告位管理" visible={visible} onCancel={onClose} width={620}>
      <div style={{ marginBottom: 12 }}>
        <CreateButton permission="cms:ad:manage" onClick={slotModal.openCreate}>新增广告位</CreateButton>
      </div>
      <ConfigurableTable<CmsAdSlot>
        columns={columns}
        {...listTableProps(slotsQuery, { empty: '暂无广告位；默认主题支持 home-ad（首页横幅下方）' })}
      />
      <EditFormModal modal={slotModal} width={480}>
        <Form.Input field="name" label="广告位名称" rules={[{ required: true, message: '请输入名称' }]} />
        <Form.Input field="code" label="引用标识" disabled={slotModal.isEdit} placeholder="如 home-ad（主题模板中引用）" rules={[{ required: true, message: '请输入标识' }]} />
        <Form.Input field="remark" label="备注" />
      </EditFormModal>
    </SideSheet>
  );
}

// ─── 广告投放 Tab（仿友情链接：列表视图 / 分组视图 + 广告位管理抽屉）───────────
interface AdSearchParams { keyword: string; slotId?: number }
const defaultAdSearch: AdSearchParams = { keyword: '', slotId: undefined };

function AdsTab({ siteId, setSiteId }: Readonly<{
  siteId: number | undefined;
  setSiteId: (siteId: number | undefined) => void;
}>) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, setPage, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<AdSearchParams>({ defaults: defaultAdSearch, listKey: cmsAdKeys.lists });
  const [slotView, setSlotView] = useState(false);
  const [slotSheetVisible, setSlotSheetVisible] = useState(false);
  const slotsData = useCmsAdSlots(siteId).data;
  const slotOptions = useMemo(() => slotsData ?? [], [slotsData]);

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useFilterQuery({
    keyword: submittedParams.keyword,
    slotId: submittedParams.slotId,
  });
  const listQuery = useCmsAdList({
    page, pageSize, siteId: siteId ?? 0,
    ...filterQuery,
  }, siteId !== undefined && !slotView);
  // 分组视图不分页（同友链分组视图惯例）：一次取全量（接口上限 200），按广告位聚合展示
  const groupListQuery = useCmsAdList({
    page: 1, pageSize: 200, siteId: siteId ?? 0,
    ...filterQuery,
  }, siteId !== undefined && slotView);
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
      // 空图片归一为 null（与 nullable 列语义一致，避免存空串）
      image: typeof values.image === 'string' && values.image.trim() ? values.image : null,
      // DatePicker clearing is an explicit null mutation; undefined would be
      // omitted by JSON serialization and leave the previous window in place.
      startAt: values.startAt instanceof Date ? formatDateTimeForApi(values.startAt) : (values.startAt ?? null),
      endAt: values.endAt instanceof Date ? formatDateTimeForApi(values.endAt) : (values.endAt ?? null),
    }),
  });
  const deleteMutation = useDeleteCmsAds();
  const canManage = hasPermission('cms:ad:manage');

  // 分组视图：按广告位排序（广告位下拉源顺序），位内按排序 → id
  const slotOrder = useMemo(() => {
    const order = new Map<number, number>();
    slotOptions.forEach((slot, index) => order.set(slot.id, index));
    return order;
  }, [slotOptions]);
  const groupedData = useMemo(() => {
    const list = groupListQuery.data?.list ?? [];
    const orderOf = (slotId: number) => slotOrder.get(slotId) ?? Number.MAX_SAFE_INTEGER;
    return [...list].sort((a, b) => orderOf(a.slotId) - orderOf(b.slotId) || a.sort - b.sort || a.id - b.id);
  }, [groupListQuery.data, slotOrder]);

  const {
    expandedRowKeys, allRowKeys: allSlotKeys,
    isAllExpanded, toggleExpandAll, setExpandedRowKeys, onExpandedRowsChange,
  } = useTreeExpansion(groupedData, {
    // 展开态的 key 是广告位 id；onExpandedRowsChange 回传 { slotKey } 行
    collectKeys: (rows) => [...new Set(rows.map((row) => row.slotId))],
    getRowKey: (row) => (row && typeof row === 'object' && 'slotKey' in row
      ? (row as { slotKey: TreeRowKey }).slotKey
      : undefined),
  });

  // 首次出现的广告位自动展开；已见过的保持用户展开/折叠状态，避免刷新时弹回展开
  const seenSlotKeysRef = useRef<Set<TreeRowKey>>(new Set());
  useEffect(() => {
    const newKeys = allSlotKeys.filter((key) => !seenSlotKeysRef.current.has(key));
    if (newKeys.length === 0) return;
    newKeys.forEach((key) => seenSlotKeysRef.current.add(key));
    setExpandedRowKeys((prev) => [...prev, ...newKeys]);
  }, [allSlotKeys, setExpandedRowKeys]);

  const slotNameMap = useMemo(() => new Map(slotOptions.map((slot) => [slot.id, slot.name] as const)), [slotOptions]);
  const slotCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of groupedData) {
      counts.set(item.slotId, (counts.get(item.slotId) ?? 0) + 1);
    }
    return counts;
  }, [groupedData]);
  const slotNameOf = (key: number): string => slotNameMap.get(key)
    ?? groupedData.find((item) => item.slotId === key)?.slotName
    ?? `广告位 #${key}`;

  const columns: ColumnProps<CmsAd>[] = [
    { title: '广告名称', dataIndex: 'name', width: 220, render: renderEllipsis },
    {
      title: '图片', dataIndex: 'image', width: 72,
      render: (v: string | null, record: CmsAd) => (v
        ? <img src={v} alt={record.name} draggable={false} style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 'var(--semi-border-radius-small)', background: 'var(--semi-color-fill-0)' }} />
        : EMPTY_PLACEHOLDER),
    },
    { title: '广告位', dataIndex: 'slotName', width: 180, render: renderEllipsis },
    { title: '跳转地址', dataIndex: 'linkUrl', minWidth: 200, render: renderEllipsis },
    { title: '曝光量', dataIndex: 'viewCount', width: 90, align: 'right' },
    { title: '点击量', dataIndex: 'clickCount', width: 90, align: 'right' },
    {
      title: 'CTR', dataIndex: 'ctr', width: 90, align: 'right',
      render: (_: unknown, record) => record.viewCount > 0 ? `${percentOf(record.clickCount, record.viewCount)}%` : EMPTY_PLACEHOLDER,
    },
    dateTimeColumn('开始时间', 'startAt', { empty: '不限' }),
    dateTimeColumn('结束时间', 'endAt', { empty: '不限' }),
    { title: '排序', dataIndex: 'sort', width: 70 },
    enabledStatusColumn(),
    createOperationColumn<CmsAd>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => adModal.openEdit(record) },
        // eslint-disable-next-line no-restricted-syntax -- 按权限条件拼装的动作数组，保留 createOperationColumn
        deleteAction({
          title: '确定要删除该广告吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ] : [],
    }),
  ];

  // 分组视图下广告位名已展示在组头，广告位列不再重复
  const viewColumns = slotView ? columns.filter((column) => column.dataIndex !== 'slotName') : columns;

  return (
    <>
      <ListSearchToolbar
        keyword={(
          <>
            <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} width={180} />
            <KeywordInput placeholder="搜索广告名称..." {...bindKeyword('keyword')} width={200} />
          </>
        )}
        filters={(
          <FilterSelect
            placeholder="全部广告位"
            items={slotOptions.map((s) => ({ value: s.id, label: s.name }))}
            {...bind('slotId')}
            width={160}
            disabled={!siteId}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton permission="cms:ad:manage" onClick={adModal.openCreate}>新增广告</CreateButton>}
        actions={(
          <>
            <Button
              type="tertiary"
              icon={slotView ? <ListIcon size={14} /> : <ListTree size={14} />}
              onClick={() => { setSlotView((value) => !value); setPage(1); }}
            >
              {slotView ? '列表视图' : '分组视图'}
            </Button>
            {slotView ? (
              <Button
                type="tertiary"
                icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                onClick={toggleExpandAll}
              >
                {isAllExpanded ? '全部折叠' : '全部展开'}
              </Button>
            ) : null}
            <Button icon={<LayoutGrid size={14} />} disabled={!siteId} onClick={() => setSlotSheetVisible(true)}>广告位管理</Button>
          </>
        )}
      />

      {slotView ? (
        // 与列表视图不同 key：Semi Table 会把 expandedRowKeys 存内部 state，
        // 同实例切回列表视图时旧展开 key 残留，第一行会多出一个展开图标
        <ConfigurableTable<CmsAd>
          key="grouped"
          columns={viewColumns}
          {...listTableProps(groupListQuery, { empty: '暂无广告' })}
          dataSource={groupedData}
          groupBy={(record?: CmsAd) => record?.slotId ?? 0}
          clickGroupedRowToExpand
          renderGroupSection={(slotKey) => {
            const key = Number(slotKey ?? 0);
            return (
              <>
                <strong>{slotNameOf(key)}</strong>
                <Typography.Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
                  {slotCounts.get(key) ?? 0} 个广告
                </Typography.Text>
              </>
            );
          }}
          expandedRowKeys={expandedRowKeys}
          onExpandedRowsChange={onExpandedRowsChange}
        />
      ) : (
        <ConfigurableTable<CmsAd>
          key="list"
          columns={viewColumns}
          {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无广告' })}
        />
      )}
      <EditFormSheet modal={adModal} width={720}>
        <Form.Select field="slotId" label="广告位" style={{ width: '100%' }} rules={[{ required: true, message: '请选择广告位' }]}
          optionList={slotOptions.map((s) => ({ value: s.id, label: s.name }))} />
        <Form.Input field="name" label="广告名称" rules={[{ required: true, message: '请输入名称' }]} />
        <FormAdImage field="image" label="图片" siteId={siteId} allowUpload={hasPermission('cms:resource:upload')}
          urlPlaceholder="外链图片地址（可选），或下方上传/选择；留空显示文字条" />
        <Form.Input field="linkUrl" label="跳转地址" placeholder="/products/enterprise.html 或 https://..." />
        <Form.DatePicker field="startAt" label="开始时间" type="dateTime" density="compact" style={{ width: '100%' }} placeholder="不限" />
        <Form.DatePicker field="endAt" label="结束时间" type="dateTime" density="compact" style={{ width: '100%' }} placeholder="不限" />
        <Form.InputNumber field="sort" label="排序" style={{ width: 160 }} />
        <FormStatusRadioGroup />
      </EditFormSheet>

      <AdSlotSheet
        siteId={siteId}
        visible={slotSheetVisible}
        onClose={() => setSlotSheetVisible(false)}
      />
    </>
  );
}

interface AdEventSearch {
  adId?: number;
  slotId?: number;
  eventType?: 'impression' | 'click';
  device?: 'pc' | 'mobile' | 'bot';
  timeRange?: [Date, Date] | null;
}

function EventsTab({ siteId, setSiteId }: Readonly<{
  siteId: number | undefined;
  setSiteId: (siteId: number | undefined) => void;
}>) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    bind, submittedParams: submitted,
    handleSearch, handleReset, applySearch,
  } = useListSearch<AdEventSearch>({ defaults: {}, listKey: cmsAdEventKeys.lists });
  const [detail, setDetail] = useState<CmsAdEvent | null>(null);
  const slotsQuery = useCmsAdSlots(siteId);
  // The API caps paginated lists at 200. Keep the lookup request within that
  // contract; the event table itself remains independently paginated.
  const adsQuery = useCmsAdList({ page: 1, pageSize: 200, siteId: siteId ?? 0 }, !!siteId);
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => ({
    siteId: siteId ?? 0,
    ...compactParams({
      adId: submitted.adId,
      slotId: submitted.slotId,
      eventType: submitted.eventType,
      device: submitted.device,
      ...formatDateTimeRangeForApi(submitted.timeRange),
    }),
  }), [submitted, siteId]);
  const listQuery = useCmsAdEventList({ page, pageSize, ...filterQuery }, !!siteId);
  const cleanupMutation = useCleanupCmsAdEvents();

  const handleSiteChange = (value: number | undefined) => {
    setSiteId(value);
    // Ad and slot IDs are site-scoped; never carry them into another site.
    applySearch({});
    setDetail(null);
  };

  const filterFields = (
    <>
      <FilterSelect
        placeholder="全部广告"
        items={(adsQuery.data?.list ?? []).map((ad) => ({ value: ad.id, label: ad.name }))}
        {...bind('adId')}
        width={160}
      />
      <FilterSelect
        placeholder="全部广告位"
        items={(slotsQuery.data ?? []).map((slot) => ({ value: slot.id, label: slot.name }))}
        {...bind('slotId')}
        width={160}
      />
      <FilterSelect
        placeholder="全部事件类型"
        items={CMS_AD_EVENT_TYPE_OPTIONS}
        {...bind('eventType')}
        width={140}
      />
      <FilterSelect
        placeholder="全部设备"
        items={CMS_DEVICE_TYPE_OPTIONS}
        {...bind('device')}
      />
      <DateRangeFilter placeholder={['发生开始时间', '发生结束时间']} {...bind('timeRange')} />
    </>
  );

  const columns: ColumnProps<CmsAdEvent>[] = [
    dateTimeColumn('发生时间', 'occurredAt'),
    {
      title: '事件', dataIndex: 'eventType', width: 90,
      render: (value: CmsAdEvent['eventType']) => <Tag size="small">{CMS_AD_EVENT_TYPE_LABELS[value]}</Tag>,
    },
    { title: '广告', dataIndex: 'adName', width: 220, render: renderEllipsis },
    { title: '广告位', dataIndex: 'slotName', width: 220, render: renderEllipsis },
    {
      title: '设备', dataIndex: 'device', width: 100,
      render: (value: CmsAdEvent['device']) => CMS_DEVICE_TYPE_LABELS[value],
    },
    { title: '页面路径', dataIndex: 'path', minWidth: 220, render: renderEllipsis },
    { title: '会员 ID', dataIndex: 'memberId', width: 100, render: (value: number | null) => value ?? EMPTY_PLACEHOLDER },
    createOperationColumn<CmsAdEvent>({
      width: 100,
      desktopInlineKeys: ['view'],
      actions: (record) => [{ key: 'view', label: '查看', onClick: () => setDetail(record) }],
    }),
  ];


  return (
    <>
      <ListSearchToolbar
        keyword={(<CmsSiteSelect value={siteId} onChange={handleSiteChange} />)}
        filters={filterFields}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={(
          <>
            {siteId ? <ExportButton entity="cms.ad-events" permission="cms:ad-event:export" query={filterQuery} /> : null}
            {hasPermission('cms:ad-event:cleanup') ? (
              <Button
                type="danger"
                icon={<Trash2 size={14} />}
                loading={cleanupMutation.isPending}
                disabled={!siteId}
                onClick={() => {
                  confirmAndDelete({
                    title: '按保留策略清理广告事件？',
                    content: '将提交到任务中心分批执行，可查看进度、取消或重试。',
                    run: () => cleanupMutation.mutateAsync({ body: { siteId } }),
                    successMessage: '清理任务已提交',
                  });
                }}
              >
                保留期清理
              </Button>
            ) : null}
          </>
        )}
        mobileActions={(siteId ? <ExportButton entity="cms.ad-events" permission="cms:ad-event:export" query={filterQuery} /> : null)}
        filterTitle="广告事件筛选"
      />
      <ConfigurableTable<CmsAdEvent>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: siteId ? '暂无广告事件' : '请先选择站点' })}
      />
      <SideSheet title="广告事件详情" visible={!!detail} onCancel={() => setDetail(null)} width={520}>
        {detail ? (
          <dl className="detail-fields" style={{ '--detail-label-width': '110px' } as CSSProperties}>
            <dt>事件</dt><dd>{CMS_AD_EVENT_TYPE_LABELS[detail.eventType]}</dd>
            <dt>发生时间</dt><dd>{detail.occurredAt}</dd>
            <dt>广告</dt><dd>{detail.adName}</dd>
            <dt>页面路径</dt><dd>{detail.path ?? EMPTY_PLACEHOLDER}</dd>
            <dt>来源</dt><dd style={{ wordBreak: 'break-all' }}>{detail.referrer ?? EMPTY_PLACEHOLDER}</dd>
            <dt>访客哈希</dt><dd style={{ margin: 0, minWidth: 0, overflow: 'hidden' }}><Typography.Text code ellipsis={{ showTooltip: true }} copyable style={{ maxWidth: '100%' }}>{detail.visitorHash}</Typography.Text></dd>
            <dt>IP 哈希</dt><dd style={{ margin: 0, minWidth: 0, overflow: 'hidden' }}><Typography.Text code ellipsis={{ showTooltip: true }} copyable style={{ maxWidth: '100%' }}>{detail.ipHash}</Typography.Text></dd>
            <dt>User-Agent</dt><dd style={{ wordBreak: 'break-word' }}>{detail.userAgent ?? EMPTY_PLACEHOLDER}</dd>
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
  const { bind, submittedParams: submitted, handleSearch, handleReset } = useListSearch<AdEventSearch>({ defaults: {}, listKey: cmsAdEventKeys.statsAll });
  const statsFilterQuery = useMemo(() => ({
    siteId: siteId ?? 0,
    ...compactParams({
      adId: submitted.adId,
      slotId: submitted.slotId,
      eventType: submitted.eventType,
      device: submitted.device,
      ...formatDateTimeRangeForApi(submitted.timeRange),
    }),
  }), [submitted, siteId]);
  const statsQuery = useCmsAdEventStats(statsFilterQuery, !!siteId);
  const columns: ColumnProps<NonNullable<typeof statsQuery.data>['trend'][number]>[] = [
    dateColumn('日期', 'date'),
    { title: '曝光', dataIndex: 'impressions', width: 120, align: 'right' },
    { title: '点击', dataIndex: 'clicks', width: 120, align: 'right' },
    { title: 'CTR', dataIndex: 'ctr', width: 120, align: 'right', render: (value: number) => `${value}%` },
  ];
  return (
    <>
      <ListSearchToolbar
        keyword={<CmsSiteSelect value={siteId} onChange={setSiteId} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部事件类型"
              items={CMS_AD_EVENT_TYPE_OPTIONS}
              {...bind('eventType')}
              width={140}
            />
            <FilterSelect
              placeholder="全部设备"
              items={CMS_DEVICE_TYPE_OPTIONS}
              {...bind('device')}
              width={140}
            />
            <DateRangeFilter placeholder={['统计开始时间', '统计结束时间']} {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
      />
      {statsQuery.data ? (
        <div style={{ display: 'flex', gap: 24, marginBottom: 12 }} aria-label="广告事件统计摘要">
          <Typography.Text>曝光 <strong>{statsQuery.data.summary.impressions}</strong></Typography.Text>
          <Typography.Text>点击 <strong>{statsQuery.data.summary.clicks}</strong></Typography.Text>
          <Typography.Text>CTR <strong>{statsQuery.data.summary.ctr}%</strong></Typography.Text>
        </div>
      ) : null}
      <ConfigurableTable<NonNullable<typeof statsQuery.data>['trend'][number]>
        columns={columns}
        {...listTableProps({ ...statsQuery, data: statsQuery.data?.trend }, {
          rowKey: 'date',
          empty: siteId ? '暂无统计数据' : '请先选择站点',
        })}
      />
    </>
  );
}

function AdsManagementTab({ siteId, setSiteId }: Readonly<{
  siteId: number | undefined;
  setSiteId: (siteId: number | undefined) => void;
}>) {
  return <AdsTab siteId={siteId} setSiteId={setSiteId} />;
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
