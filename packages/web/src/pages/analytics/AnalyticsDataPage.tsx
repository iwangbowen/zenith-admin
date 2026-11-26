import { useState } from 'react';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { useQueryClient } from '@tanstack/react-query';
import { useListSearch } from '@/hooks/useListSearch';
import { Tabs, TabPane, Select, Button, Toast, Form, Switch, Slider, Input, InputNumber, TagInput, Tag, Typography, SplitButtonGroup, Dropdown, SideSheet, Descriptions, Card, Banner } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { Trash2, ChevronDown } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import AppModal from '@/components/AppModal';
import { formatDateTime, formatDateTimeRangeValuesForApi } from '@/utils/date';
import {
  analyticsKeys,
  eventMetaReferencesQueryOptions,
  useAnalyticsEventDetail,
  useAnalyticsEventMeta,
  useAnalyticsEvents,
  useAnalyticsRollup,
  useCleanAnalyticsEvents,
  useDeleteAnalyticsEventMeta,
  useEventMetaReferences,
  useFrontendAdminUsers,
  useRebuildAnalyticsRollup,
  useSaveAnalyticsEventMeta,
} from '@/hooks/queries/analytics';
import type { AnalyticsEventMeta, AnalyticsEventMetaReferences, AnalyticsRollupItem, EventListItem, UserBehaviorEventType } from '@zenith/shared/analytics';
import type { AnalyticsSettings } from '@zenith/shared/settings';
import { ANALYTICS_DEVICE_TYPES, ANALYTICS_DEVICE_TYPE_OPTIONS, ANALYTICS_EVENT_META_STATUS_LABELS, ANALYTICS_EVENT_META_STATUS_OPTIONS, ANALYTICS_EVENT_PROPERTY_TYPES, USER_BEHAVIOR_EVENT_TYPE_LABELS, USER_BEHAVIOR_EVENT_TYPE_OPTIONS, userBehaviorEventTypeEnum } from '@zenith/shared/analytics';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import AnalyticsQualityTab from './AnalyticsQualityTab';
import AnalyticsDebugTab from './AnalyticsDebugTab';
import AnalyticsSegmentsTab from './AnalyticsSegmentsTab';
import AnalyticsSitesTab from './AnalyticsSitesTab';
import { CreateButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';
import { toUserOptions } from '@/hooks/queries/users';
import { EMPTY_PLACEHOLDER, copyableNoColumn, dateColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { JsonBlock } from '@/components/JsonBlock';
import { msToReadable, nullableText, trimToNull } from './analytics-format';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { useSaveSettings, useSettings } from '@/hooks/queries/settings';
import { SettingsEditorTools } from '@/components/settings/SettingsEditorTools';
import { useSettingsEditor } from '@/hooks/useSettingsEditor';

const PAGE_SIZE = 20;

function referencePart(label: string, items: Array<{ name: string }>) {
  if (items.length === 0) return null;
  const names = items.slice(0, 3).map((item) => `「${item.name}」`).join('、');
  return `${items.length} 个${label}（${names}${items.length > 3 ? ' 等' : ''}）`;
}

/** 下游引用摘要：如「2 个漏斗报表（「注册转化」）、1 个 A/B 实验（「新首页」）」 */
function referencesSummaryText(refs: AnalyticsEventMetaReferences) {
  return [
    referencePart('漏斗报表', refs.savedReports),
    referencePart('用户分群', refs.segments),
    referencePart('A/B 实验', refs.experiments),
  ].filter(Boolean).join('、');
}

const EVENT_TYPE_COLOR: Record<UserBehaviorEventType, TagColor> = {
  page_view: 'blue',
  page_leave: 'teal',
  feature_use: 'green',
  area_click: 'orange',
  custom: 'violet',
  perf: 'cyan',
  api_request: 'amber',
  identify: 'grey',
};

// 中文标签取 shared SSOT，颜色属 UI 表现留在页面侧
const DEVICE_OPTIONS = ANALYTICS_DEVICE_TYPE_OPTIONS;
const META_STATUS_COLORS: Record<AnalyticsEventMeta['status'], TagColor> = {
  active: 'green',
  deprecated: 'orange',
  blocked: 'red',
};
const META_STATUS_OPTIONS = ANALYTICS_EVENT_META_STATUS_OPTIONS;
const ROLLUP_DAY_OPTIONS = [30, 90, 180].map((value) => ({ value, label: `${value} 天` }));
const CLEAN_DAY_OPTIONS = [
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 180, label: '180 天' },
  { value: 365, label: '365 天' },
  { value: 0, label: '全部' },
];

interface EventSearchParams {
  eventType?: string;
  eventName: string;
  username: string;
  pagePath: string;
  deviceType?: string;
  timeRange: [Date, Date] | null;
}

interface MetaSearchParams {
  keyword: string;
  status?: AnalyticsEventMeta['status'];
  category: string;
}

type EventMetaProperty = NonNullable<AnalyticsEventMeta['propertySchema']>[number];
type EventMetaPayload = {
  eventName: string;
  displayName: string | null;
  category: string | null;
  description: string | null;
  status: AnalyticsEventMeta['status'];
  propertySchema: AnalyticsEventMeta['propertySchema'];
  /** Tracking Plan 契约负责人（平台用户 id）；ownerName 由服务端解析，不接受客户端传值 */
  ownerId: number | null;
  /** 严格模式：开启后不符合 propertySchema 的事件将被拒收 */
  strictMode: boolean;
};
type EventMetaFormValues = Omit<EventMetaPayload, 'propertySchema'> & { propertySchemaText?: string };
type SettingsPayload = AnalyticsSettings;

const defaultEventSearch: EventSearchParams = {
  eventType: undefined,
  eventName: '',
  username: '',
  pagePath: '',
  deviceType: undefined,
  timeRange: null,
};
const defaultMetaSearch: MetaSearchParams = { keyword: '', status: undefined, category: '' };

function parsePropertySchema(text: string | undefined): AnalyticsEventMeta['propertySchema'] {
  if (!text?.trim()) return null;
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('属性 Schema 必须是数组');
  const seenKeys = new Set<string>();
  return parsed.map((item): EventMetaProperty => {
    if (!item || typeof item !== 'object') throw new Error('属性 Schema 每项必须是对象');
    const record = item as Record<string, unknown>;
    if (typeof record.key !== 'string' || typeof record.type !== 'string') {
      throw new Error('属性 Schema 每项必须包含 key 和 type');
    }
    if (seenKeys.has(record.key)) throw new Error(`属性 key「${record.key}」重复，同一事件的属性 schema 中 key 必须唯一`);
    seenKeys.add(record.key);
    if (!ANALYTICS_EVENT_PROPERTY_TYPES.includes(record.type as (typeof ANALYTICS_EVENT_PROPERTY_TYPES)[number])) {
      throw new Error(`属性类型必须是以下之一：${ANALYTICS_EVENT_PROPERTY_TYPES.join(' / ')}`);
    }
    if (record.enumValues !== undefined && !Array.isArray(record.enumValues)) {
      throw new Error(`属性「${record.key}」的 enumValues 必须是字符串数组`);
    }
    return {
      key: record.key,
      type: record.type as (typeof ANALYTICS_EVENT_PROPERTY_TYPES)[number],
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      ...(typeof record.required === 'boolean' ? { required: record.required } : {}),
      ...(Array.isArray(record.enumValues) ? { enumValues: record.enumValues.map(String) } : {}),
      ...(typeof record.pii === 'boolean' ? { pii: record.pii } : {}),
    };
  });
}

function numberValue(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function EventTypeTag({ value }: Readonly<{ value: string }>) {
  const eventType = enumValueOf(userBehaviorEventTypeEnum.options, value);
  const label = eventType ? USER_BEHAVIOR_EVENT_TYPE_LABELS[eventType] : value;
  const color = eventType ? EVENT_TYPE_COLOR[eventType] : 'grey';
  return <Tag color={color} size="small">{label}</Tag>;
}

function MetaStatusTag({ value }: Readonly<{ value: AnalyticsEventMeta['status'] }>) {
  return <Tag color={META_STATUS_COLORS[value] ?? 'grey'} size="small">{ANALYTICS_EVENT_META_STATUS_LABELS[value] ?? value}</Tag>;
}

const DATA_TABS = ['events', 'meta', 'quality', 'debug', 'segments', 'sites', 'rollup', 'settings'] as const;

export default function AnalyticsDataPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const canManage = hasPermission('analytics:manage');
  const canClean = hasPermission('analytics:clean');
  const [activeTab, setActiveTab] = useUrlTabState(DATA_TABS, 'events');

  const eventList = useListSearch<EventSearchParams>({ defaults: defaultEventSearch, listKey: analyticsKeys.data.eventsLists, pageSize: PAGE_SIZE });
  const { submittedParams: submittedEventSearch } = eventList;
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailEventId, setDetailEventId] = useState<number | undefined>(undefined);

  const metaList = useListSearch<MetaSearchParams>({ defaults: defaultMetaSearch, listKey: analyticsKeys.data.metaLists, pageSize: PAGE_SIZE });
  const { submittedParams: submittedMetaSearch } = metaList;

  const [rollupDays, setRollupDays] = useState(30);

  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const [startTime, endTime] = formatDateTimeRangeValuesForApi(submittedEventSearch.timeRange);
  const eventFilterQuery = useFilterQuery({
    eventType: enumValueOf(userBehaviorEventTypeEnum.options, submittedEventSearch.eventType),
    eventName: submittedEventSearch.eventName,
    username: submittedEventSearch.username,
    pagePath: submittedEventSearch.pagePath,
    deviceType: enumValueOf(ANALYTICS_DEVICE_TYPES, submittedEventSearch.deviceType),
    startTime,
    endTime,
  });

  const eventsQuery = useAnalyticsEvents({
    page: eventList.page,
    pageSize: eventList.pageSize,
    ...eventFilterQuery,
  });
  const detailQuery = useAnalyticsEventDetail(detailEventId, detailVisible);
  const eventDetail = detailQuery.data ?? null;
  const detailLoading = detailQuery.isFetching;

  const metaFilterQuery = useFilterQuery({
    keyword: submittedMetaSearch.keyword,
    status: submittedMetaSearch.status,
    category: submittedMetaSearch.category,
  });

  const metaQuery = useAnalyticsEventMeta({
    page: metaList.page,
    pageSize: metaList.pageSize,
    ...metaFilterQuery,
  });

  const rollupQuery = useAnalyticsRollup(rollupDays, activeTab === 'rollup');
  const rollupItems = rollupQuery.data?.items ?? [];
  const settingsQuery = useSettings('analytics', activeTab === 'settings');
  const settingsEditor = useSettingsEditor('analytics', settingsQuery.data);
  const settings = settingsQuery.data ? settingsEditor.value : null;

  const cleanMutation = useCleanAnalyticsEvents();
  const saveMetaMutation = useSaveAnalyticsEventMeta();
  const deleteMetaMutation = useDeleteAnalyticsEventMeta();
  const rebuildRollupMutation = useRebuildAnalyticsRollup();
  const saveSettingsMutation = useSaveSettings('analytics');
  const canEditSettings = canManage && !saveSettingsMutation.isPending;
  const metaModal = useEditModal<AnalyticsEventMeta, EventMetaFormValues, EventMetaPayload>({
    entityName: '事件字典',
    save: saveMetaMutation,
    defaults: {
      eventName: '',
      displayName: null,
      category: null,
      description: null,
      status: 'active',
      propertySchemaText: '[]',
      ownerId: null,
      strictMode: false,
    },
    toValues: (record) => ({
      eventName: record.eventName,
      displayName: record.displayName,
      category: record.category,
      description: record.description,
      status: record.status,
      propertySchemaText: JSON.stringify(record.propertySchema ?? [], null, 2),
      ownerId: record.ownerId,
      strictMode: record.strictMode,
    }),
    beforeSave: (values) => {
      let propertySchema: AnalyticsEventMeta['propertySchema'];
      try {
        propertySchema = parsePropertySchema(values.propertySchemaText);
      } catch (error) {
        Toast.error(error instanceof Error ? error.message : '属性 Schema 格式错误');
        abortSubmit();
      }
      return {
        eventName: values.eventName.trim(),
        displayName: trimToNull(values.displayName),
        category: trimToNull(values.category),
        description: trimToNull(values.description),
        status: values.status,
        propertySchema,
        ownerId: values.ownerId ?? null,
        strictMode: !!values.strictMode,
      };
    },
    labelWidth: 110,
  });
  const ownerUsersQuery = useFrontendAdminUsers(activeTab === 'meta' && metaModal.visible);
  const ownerOptions = toUserOptions(ownerUsersQuery.data?.list ?? []);
  const metaReferencesQuery = useEventMetaReferences(metaModal.editing?.eventName, metaModal.visible);


  const handleClean = (days: number) => {
    const option = CLEAN_DAY_OPTIONS.find((item) => item.value === days);
    confirmDanger({
      title: `确认清除${days === 0 ? '全部' : `${option?.label ?? `${days} 天`}前的`}埋点数据？`,
      content: '清除后数据不可恢复，请谨慎操作。',
      okText: '确认清除',
      closeOnEsc: true,
      onOk: async () => {
        await cleanMutation.mutateAsync({ query: { days } });
        Toast.success('清除成功');
        eventList.setPage(1);
      },
    });
  };

  const openEventDetail = (record: EventListItem) => {
    setDetailVisible(true);
    setDetailEventId(record.id);
  };

  const handleMetaDelete = async (record: AnalyticsEventMeta) => {
    await deleteMetaMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('删除成功');
  };

  /** 删除前拉取下游引用：有引用时在确认框中警示，引用查询失败不阻断删除入口 */
  const openMetaDeleteConfirm = async (record: AnalyticsEventMeta) => {
    const refs = await queryClient
      .fetchQuery(eventMetaReferencesQueryOptions(record.eventName))
      .catch(() => null);
    const summary = refs && refs.total > 0 ? referencesSummaryText(refs) : null;
    confirmDelete({
      title: `确定删除事件「${record.eventName}」吗？`,
      content: summary ? (
        <Typography.Text type="danger">
          该事件正被 {summary} 引用，删除后契约与属性 Schema 将丢失，请先确认这些分析是否仍需该事件。
        </Typography.Text>
      ) : '删除仅移除字典契约，不影响已采集的事件数据。',
      onOk: () => handleMetaDelete(record),
    });
  };

  const handleRollupDaysChange = (value: unknown) => {
    const days = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(days)) return;
    setRollupDays(days);
  };

  const handleRebuildRollup = async () => {
    await rebuildRollupMutation.mutateAsync({ query: { days: rollupDays } });
    Toast.success('任务已提交，可在顶部任务中心查看进度');
  };

  const updateSettings = <K extends keyof SettingsPayload>(key: K, value: SettingsPayload[K]) => {
    settingsEditor.setField(key, value);
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    if (await settingsEditor.save((body) => saveSettingsMutation.mutateAsync({ body }))) Toast.success('保存成功');
  };

  const eventColumns: ColumnProps<EventListItem>[] = [
    {
      title: '事件类型',
      dataIndex: 'eventType',
      width: 100,
      render: (value: string) => <EventTypeTag value={value} />,
    },
    { title: '用户', dataIndex: 'username', width: 110, render: (value: string | null) => nullableText(value) },
    { title: '事件名', dataIndex: 'eventName', minWidth: 150, render: renderEllipsis },
    {
      title: '页面',
      dataIndex: 'pagePath',
      width: 320,
      // 单行「标题 · 路径」，超宽整体省略 + tooltip 完整展示：行高统一，标题与路径都不丢
      render: (_: unknown, record) => renderEllipsis(
        record.pageTitle ? `${record.pageTitle} · ${record.pagePath}` : record.pagePath,
      ),
    },
    {
      title: '功能/区域',
      dataIndex: 'elementLabel',
      width: 170,
      render: (_: unknown, record) => (
        <div>
          {renderEllipsis(record.elementLabel || record.elementKey)}
          {record.componentArea && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
              {record.componentArea}
            </Typography.Text>
          )}
        </div>
      ),
    },
    { title: '设备', dataIndex: 'deviceType', width: 90, render: (value: string | null) => nullableText(value) },
    { title: '浏览器', dataIndex: 'browser', width: 100, render: (value: string | null) => nullableText(value) },
    {
      title: '接口',
      dataIndex: 'apiUrl',
      width: 180,
      render: (_: unknown, record) => {
        if (record.apiUrl == null && record.apiStatus == null) return EMPTY_PLACEHOLDER;
        const status = record.apiStatus;
        const color = status == null ? 'grey' : status >= 500 ? 'red' : status >= 400 ? 'orange' : 'green';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {status != null && <Tag color={color} size="small" style={{ flexShrink: 0 }}>{status}</Tag>}
            <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ minWidth: 0 }}>
              {record.apiUrl ?? EMPTY_PLACEHOLDER}
            </Typography.Text>
          </div>
        );
      },
    },
    { title: '时长', dataIndex: 'durationMs', width: 90, align: 'right', render: (value: number | null) => msToReadable(value) },
    dateTimeColumn('时间', 'createdAt'),
    createOperationColumn<EventListItem>({
      width: 100,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => { void openEventDetail(record); },
        },
      ],
    }),
  ];

  const metaColumns: ColumnProps<AnalyticsEventMeta>[] = [
    copyableNoColumn('事件名', 'eventName', { width: 200 }),
    { title: '显示名', dataIndex: 'displayName', minWidth: 150, render: (value: string | null) => (value || <Typography.Text type="tertiary" size="small">未设置</Typography.Text>) },
    { title: '分类', dataIndex: 'category', width: 130, render: (value: string | null) => (value ? (USER_BEHAVIOR_EVENT_TYPE_LABELS[value as UserBehaviorEventType] ?? value) : EMPTY_PLACEHOLDER) },
    { title: '触发次数', dataIndex: 'eventCount', width: 100, align: 'right' },
    dateTimeColumn('首次出现', 'firstSeenAt'),
    dateTimeColumn('最近出现', 'lastSeenAt'),
    {
      title: '状态',
      dataIndex: 'status',
      fixed: 'right',
      width: 90,
      render: (value: AnalyticsEventMeta['status']) => <MetaStatusTag value={value} />,
    },
    createOperationColumn<AnalyticsEventMeta>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        {
          key: 'edit',
          label: '编辑',
          onClick: () => metaModal.openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            void openMetaDeleteConfirm(record);
          },
        },
      ] : [],
    }),
  ];

  const rollupColumns: ColumnProps<AnalyticsRollupItem>[] = [
    dateColumn('日期', 'statDate'),
    { title: 'PV', dataIndex: 'pv', width: 100, align: 'right' },
    { title: 'UV', dataIndex: 'uv', width: 100, align: 'right' },
    { title: '会话', dataIndex: 'sessions', width: 100 },
    { title: '事件', dataIndex: 'events', width: 100 },
    { title: '跳出会话', dataIndex: 'bounceSessions', width: 110 },
    { title: '总停留', dataIndex: 'totalDwellMs', minWidth: 140, align: 'right', render: (value: number) => msToReadable(value) },
  ];

  const renderEventDetail = () => {
    if (detailLoading) return <Typography.Text type="tertiary">加载中...</Typography.Text>;
    if (!eventDetail) return <Typography.Text type="tertiary">暂无详情</Typography.Text>;
    // 与异常事件详情抽屉同一套版式：分节 + size="small" 网格 Description；
    // [标签, 原始值, 定制渲染]：原始值为空的字段不平铺 30+ 个「–」，统一收进底部「未采集」一行
    const fields: Array<[string, unknown, React.ReactNode?]> = [];
    const description = (...items: Array<[string, unknown, React.ReactNode?]>) => {
      const data = items.filter((item) => item[1] != null && item[1] !== '').map(([key, raw, node]) => ({ key, value: node ?? String(raw) }));
      if (!data.length) return null;
      fields.push(...items);
      return <Descriptions size="small" data={data} />;
    };
    const longText = (value: string) => (
      <Typography.Paragraph style={{ margin: 0, wordBreak: 'break-all' }} copyable>
        {value}
      </Typography.Paragraph>
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
        <Descriptions size="small" data={[
          { key: 'ID', value: String(eventDetail.id) },
          { key: '事件类型', value: <EventTypeTag value={eventDetail.eventType} /> },
          { key: '事件名', value: eventDetail.eventName },
          ...(eventDetail.userId != null ? [{ key: '用户', value: `${eventDetail.username ?? '匿名'}（#${eventDetail.userId}）` }] : []),
          ...(eventDetail.durationMs != null ? [{ key: '停留时长', value: msToReadable(eventDetail.durationMs) }] : []),
          { key: '创建时间', value: formatDateTime(eventDetail.createdAt) },
        ]} />
        <div>
          <Typography.Title heading={6} style={{ marginBottom: 8 }}>页面与元素</Typography.Title>
          {description(
            ['页面路径', eventDetail.pagePath],
            ['页面标题', eventDetail.pageTitle],
            ['元素 Key', eventDetail.elementKey],
            ['元素标签', eventDetail.elementLabel],
            ['组件区域', eventDetail.componentArea],
            ['滚动深度', eventDetail.scrollDepth],
          ) ?? <Typography.Text type="tertiary" size="small">未采集</Typography.Text>}
        </div>
        <div>
          <Typography.Title heading={6} style={{ marginBottom: 8 }}>环境与设备</Typography.Title>
          {description(
            ['浏览器', eventDetail.browser, eventDetail.browser ? `${eventDetail.browser}${eventDetail.browserVersion ? ` ${eventDetail.browserVersion}` : ''}` : null],
            ['操作系统', eventDetail.os, eventDetail.os ? `${eventDetail.os}${eventDetail.osVersion ? ` ${eventDetail.osVersion}` : ''}` : null],
            ['设备类型', eventDetail.deviceType],
            ['屏幕', eventDetail.screenW != null && eventDetail.screenH != null ? `${eventDetail.screenW} × ${eventDetail.screenH}` : null],
            ['语言', eventDetail.language],
            ['User Agent', eventDetail.userAgent, eventDetail.userAgent ? longText(eventDetail.userAgent) : null],
          ) ?? <Typography.Text type="tertiary" size="small">未采集</Typography.Text>}
        </div>
        <div>
          <Typography.Title heading={6} style={{ marginBottom: 8 }}>位置与来源</Typography.Title>
          {description(
            ['IP', eventDetail.ip],
            ['国家 / 省市', eventDetail.country, [eventDetail.country, eventDetail.region, eventDetail.city].filter(Boolean).join(' / ') || null],
            ['来源页', eventDetail.referrer, longText(eventDetail.referrer ?? '')],
            ['UTM Source', eventDetail.utmSource],
            ['UTM Medium', eventDetail.utmMedium],
            ['UTM Campaign', eventDetail.utmCampaign],
          ) ?? <Typography.Text type="tertiary" size="small">未采集</Typography.Text>}
        </div>
        <div>
          <Typography.Title heading={6} style={{ marginBottom: 8 }}>会话与标识</Typography.Title>
          {description(
            ['会话 ID', eventDetail.sessionId, eventDetail.sessionId ? longText(eventDetail.sessionId) : null],
            ['Distinct ID', eventDetail.distinctId, eventDetail.distinctId ? longText(eventDetail.distinctId) : null],
            ['匿名 ID', eventDetail.anonymousId, eventDetail.anonymousId ? longText(eventDetail.anonymousId) : null],
          ) ?? <Typography.Text type="tertiary" size="small">未采集</Typography.Text>}
        </div>
        {eventDetail.metricName != null && (
          <div>
            <Typography.Title heading={6} style={{ marginBottom: 8 }}>指标</Typography.Title>
            <Descriptions size="small" data={[
              { key: '指标名', value: eventDetail.metricName },
              { key: '指标值', value: eventDetail.metricValue ?? EMPTY_PLACEHOLDER },
            ]} />
          </div>
        )}
        {(() => {
          const emptyKeys = fields.filter((f) => f[1] == null || f[1] === '').map(([key]) => key);
          if (eventDetail.metricName == null) emptyKeys.push('指标名', '指标值');
          return emptyKeys.length > 0 ? (
            <Typography.Text type="tertiary" size="small">未采集：{emptyKeys.join('、')}</Typography.Text>
          ) : null;
        })()}
        <div>
          <Typography.Title heading={6}>事件属性</Typography.Title>
          <JsonBlock value={eventDetail.properties ?? {}} />
        </div>
      </div>
    );
  };

  const renderSettings = () => {
    if (!settings) {
      return (
        <Card>
          <Typography.Text type="tertiary">{settingsQuery.isFetching ? '加载中...' : '暂无设置'}</Typography.Text>
        </Card>
      );
    }

    return (
      <Card>
        <SettingsEditorTools module="analytics" editor={settingsEditor} canWrite={canManage} saving={saveSettingsMutation.isPending} onReload={settingsQuery.refetch} />
        <Form labelPosition="left" labelWidth={150} disabled={!canEditSettings}>
          <Form.Slot label="启用采集">
            <Switch disabled={!canEditSettings} checked={settings.enabled} onChange={(checked) => updateSettings('enabled', checked)} />
          </Form.Slot>
          <Form.Slot label="采样率">
            <div className="zx-slider-row">
              <Slider
                disabled={!canEditSettings}
                min={0}
                max={1}
                step={0.05}
                value={settings.sampleRate}
                onChange={(value) => {
                  if (typeof value === 'number' && Number.isFinite(value)) updateSettings('sampleRate', Number(value.toFixed(2)));
                }}
              />
              <Typography.Text strong>{Math.round(settings.sampleRate * 100)}%</Typography.Text>
            </div>
          </Form.Slot>
          <Form.Slot label="页面浏览">
            <Switch disabled={!canEditSettings} checked={settings.trackPageviews} onChange={(checked) => updateSettings('trackPageviews', checked)} />
          </Form.Slot>
          <Form.Slot label="点击行为">
            <Switch disabled={!canEditSettings} checked={settings.trackClicks} onChange={(checked) => updateSettings('trackClicks', checked)} />
          </Form.Slot>
          <Form.Slot label="性能指标">
            <Switch disabled={!canEditSettings} checked={settings.trackPerformance} onChange={(checked) => updateSettings('trackPerformance', checked)} />
          </Form.Slot>
          <Form.Slot label="错误采集">
            <Switch disabled={!canEditSettings} checked={settings.trackErrors} onChange={(checked) => updateSettings('trackErrors', checked)} />
          </Form.Slot>
          <Form.Slot label="API 请求">
            <Switch disabled={!canEditSettings} checked={settings.trackApi} onChange={(checked) => updateSettings('trackApi', checked)} />
          </Form.Slot>
          <Form.Slot label="脱敏输入内容">
            <Switch disabled={!canEditSettings} checked={settings.maskInputs} onChange={(checked) => updateSettings('maskInputs', checked)} />
          </Form.Slot>
          <Form.Slot label="尊重 DNT">
            <Switch disabled={!canEditSettings} checked={settings.respectDnt} onChange={(checked) => updateSettings('respectDnt', checked)} />
          </Form.Slot>
          <Form.Slot label="IP 匿名化">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch disabled={!canEditSettings} checked={settings.anonymizeIp} onChange={(checked) => updateSettings('anonymizeIp', checked)} />
              <Typography.Text type="tertiary" size="small">开启后仅存储网段（IPv4 抹掉末段），地理解析不受影响</Typography.Text>
            </div>
          </Form.Slot>
          <Form.Slot label="黑名单路径">
            <TagInput
                disabled={!canEditSettings}
              value={settings.blacklistPaths}
              placeholder="输入路径后回车，如 /login"
              onChange={(value: string[]) => updateSettings('blacklistPaths', value)}
              style={{ width: 520 }}
            />
          </Form.Slot>
          <Form.Slot label="错误忽略规则">
            <div>
              <TagInput
                disabled={!canEditSettings}
                value={settings.errorIgnorePatterns}
                placeholder="输入正则后回车，如 Invalid DOM property"
                onChange={(value: string[]) => updateSettings('errorIgnorePatterns', value)}
                style={{ width: 520 }}
              />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                命中任一正则（对错误 message 不区分大小写匹配）的前端错误上报会被直接丢弃，用于压制框架开发告警、浏览器插件等已知噪音
              </Typography.Text>
            </div>
          </Form.Slot>
          <Form.Slot label="事件保留天数">
            <InputNumber
                disabled={!canEditSettings}
              min={1}
              value={settings.retentionDays}
              onChange={(value) => updateSettings('retentionDays', numberValue(value, settings.retentionDays))}
              style={{ width: 180 }}
            />
          </Form.Slot>
          <Form.Slot label="错误保留天数">
            <InputNumber
                disabled={!canEditSettings}
              min={1}
              value={settings.errorRetentionDays}
              onChange={(value) => updateSettings('errorRetentionDays', numberValue(value, settings.errorRetentionDays))}
              style={{ width: 180 }}
            />
          </Form.Slot>
          <Form.Slot label="会话超时分钟">
            <InputNumber
                disabled={!canEditSettings}
              min={1}
              value={settings.sessionTimeoutMinutes}
              onChange={(value) => updateSettings('sessionTimeoutMinutes', numberValue(value, settings.sessionTimeoutMinutes))}
              style={{ width: 180 }}
            />
          </Form.Slot>
          <Form.Slot label="会话回放">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch disabled={!canEditSettings} checked={settings.trackReplay} onChange={(checked) => updateSettings('trackReplay', checked)} />
              <Typography.Text type="tertiary" size="small">开启后 SDK 按需加载 rrweb 录制器（关闭时零开销）</Typography.Text>
            </div>
          </Form.Slot>
          {settings.trackReplay && (
            <>
              <Form.Slot label="错误触发回放">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch disabled={!canEditSettings} checked={settings.replayOnError} onChange={(checked) => updateSettings('replayOnError', checked)} />
                  <Typography.Text type="tertiary" size="small">报错时上传错误前约 60s 缓冲现场并继续录制</Typography.Text>
                </div>
              </Form.Slot>
              <Form.Slot label="全程录制采样率">
                <div className="zx-slider-row">
                  <Slider
                disabled={!canEditSettings}
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.replaySessionSampleRate}
                    onChange={(value) => {
                      if (typeof value === 'number' && Number.isFinite(value)) updateSettings('replaySessionSampleRate', Number(value.toFixed(2)));
                    }}
                  />
                  <Typography.Text strong>{Math.round(settings.replaySessionSampleRate * 100)}%</Typography.Text>
                </div>
              </Form.Slot>
              <Form.Slot label="回放打码所有文本">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch disabled={!canEditSettings} checked={settings.replayMaskAllText} onChange={(checked) => updateSettings('replayMaskAllText', checked)} />
                  <Typography.Text type="tertiary" size="small">输入框始终打码；开启后页面全部文本一并脱敏</Typography.Text>
                </div>
              </Form.Slot>
              <Form.Slot label="回放屏蔽选择器">
                <Input
                disabled={!canEditSettings}
                  value={settings.replayBlockSelector}
                  placeholder="CSS 选择器，如 .sensitive-area（命中元素整块不录制）"
                  onChange={(value) => updateSettings('replayBlockSelector', value)}
                  style={{ width: 520 }}
                />
              </Form.Slot>
              <Form.Slot label="回放保留天数">
                <InputNumber
                disabled={!canEditSettings}
                  min={1}
                  value={settings.replayRetentionDays}
                  onChange={(value) => updateSettings('replayRetentionDays', numberValue(value, settings.replayRetentionDays))}
                  style={{ width: 180 }}
                />
              </Form.Slot>
              <Form.Slot label="回放存储配额">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <InputNumber
                disabled={!canEditSettings}
                    min={0}
                    step={512}
                    value={settings.replayStorageQuotaMb}
                    onChange={(value) => updateSettings('replayStorageQuotaMb', numberValue(value, settings.replayStorageQuotaMb))}
                    style={{ width: 180 }}
                    suffix="MB"
                  />
                  <Typography.Text type="tertiary" size="small">
                    超配额自动滚动淘汰最旧回放（无错误的优先）；超 120% 时暂停采样录制（错误现场不受限）；0 = 不限制
                  </Typography.Text>
                </div>
              </Form.Slot>
            </>
          )}
          <Form.Slot label=" ">
            {canManage ? <Button type="primary" disabled={!settingsEditor.dirty} loading={saveSettingsMutation.isPending} onClick={() => void handleSaveSettings()}>保存</Button> : null}
          </Form.Slot>
        </Form>
      </Card>
    );
  };

  const renderRollupDaysFilter = () => (
    <Select value={rollupDays} onChange={handleRollupDaysChange} optionList={ROLLUP_DAY_OPTIONS} style={{ width: 130 }} />
  );
  const renderRebuildRollupButton = () => canManage && (
    <Button type="primary" loading={rebuildRollupMutation.isPending} onClick={() => void handleRebuildRollup()}>重建聚合</Button>
  );

  return (
    <div className="page-container page-tabs-page zx-flat-panels">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} type="line" lazyRender keepDOM={false}>
        <TabPane tab="事件明细" itemKey="events">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="事件名" {...eventList.bindKeyword('eventName')} width={160} />}
            filters={
              <>
                <FilterSelect
                  placeholder="全部事件类型"
                  items={USER_BEHAVIOR_EVENT_TYPE_OPTIONS}
                  {...eventList.bind('eventType')}
                  width={150}
                />
                <KeywordInput placeholder="用户名" {...eventList.bindKeyword('username')} width={140} />
                <KeywordInput placeholder="页面路径" {...eventList.bindKeyword('pagePath')} width={180} />
                <FilterSelect
                  placeholder="全部设备"
                  items={DEVICE_OPTIONS}
                  {...eventList.bind('deviceType')}
                />
                <DateRangeFilter {...eventList.bind('timeRange')} />
              </>
            }
            onSearch={eventList.handleSearch}
            onReset={eventList.handleReset}
            actions={
              <>
                <ExportButton entity="analytics.events" query={eventFilterQuery} permission="analytics:export" />
                {canClean ? (
                  <SplitButtonGroup>
                    <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={cleanMutation.isPending} onClick={() => handleClean(90)}>清除数据</Button>
                    <Dropdown trigger="click" position="bottomRight" clickToHide render={(
                      <Dropdown.Menu>
                        {CLEAN_DAY_OPTIONS.map((item) => (
                          <Dropdown.Item
                            key={item.value}
                            type={item.value === 0 ? 'danger' : 'primary'}
                            onClick={() => handleClean(item.value)}
                          >
                            清除{item.label === '全部' ? '全部数据' : `${item.label}前数据`}
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    )}>
                      <Button type="danger" theme="light" icon={<ChevronDown size={14} />} />
                    </Dropdown>
                  </SplitButtonGroup>
                ) : null}
              </>
            }
            mobileActions={(
              <>
                <ExportButton entity="analytics.events" query={eventFilterQuery} permission="analytics:export" />
                {canClean && CLEAN_DAY_OPTIONS.map((item) => (
                  <Button
                    key={item.value}
                    type={item.value === 0 ? 'danger' : 'tertiary'}
                    theme="light"
                    icon={<Trash2 size={14} />}
                    loading={cleanMutation.isPending}
                    onClick={() => handleClean(item.value)}
                  >
                    清除{item.label === '全部' ? '全部数据' : `${item.label}前数据`}
                  </Button>
                ))}
              </>
            )}
            filterTitle="事件筛选"
            actionTitle="事件操作"
          />

          <ConfigurableTable
            columns={eventColumns}
            {...listTableProps(eventsQuery, { pagination: eventList.buildPagination, empty: '暂无数据' })}
          />

          <SideSheet
            title={`事件详情${eventDetail ? ` #${eventDetail.id}` : ''}`}
            visible={detailVisible}
            onCancel={() => setDetailVisible(false)}
            width={760}
          >
            {renderEventDetail()}
          </SideSheet>
        </TabPane>
        <TabPane tab="事件字典" itemKey="meta">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="关键词" {...metaList.bindKeyword('keyword')} width={180} />}
            filters={
              <>
                <KeywordInput placeholder="分类" {...metaList.bindKeyword('category')} width={140} />
                <StatusSelect
                  items={META_STATUS_OPTIONS}
                  {...metaList.bind('status')}
                />
              </>
            }
            onSearch={metaList.handleSearch}
            onReset={metaList.handleReset}
            create={<CreateButton permission="analytics:manage" onClick={metaModal.openCreate} />}
            filterTitle="事件字典筛选"
          />

          <ConfigurableTable
            columns={metaColumns}
            {...listTableProps(metaQuery, { pagination: metaList.buildPagination, empty: '暂无数据' })}
          />

          <AppModal {...metaModal.modalProps} width={640}>
            {metaModal.editing && metaReferencesQuery.data && (
              metaReferencesQuery.data.total > 0 ? (
                <Banner
                  fullMode={false}
                  type="warning"
                  closeIcon={null}
                  description={`该事件正被 ${referencesSummaryText(metaReferencesQuery.data)} 引用，屏蔽、重命名或修改契约将直接影响这些分析的取数。`}
                  style={{ marginBottom: 12 }}
                />
              ) : (
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
                  暂无漏斗报表 / 用户分群 / A/B 实验引用该事件。
                </Typography.Text>
              )
            )}
            {/* eslint-disable-next-line no-restricted-syntax -- 表单之前按引用统计条件渲染 Banner，之后还有独立说明区，属复合弹窗 */}
            <Form key={metaModal.formKey} {...metaModal.formProps}>
              <Form.Input field="eventName" label="事件名" placeholder="如 page_view" rules={[{ required: true, message: '请输入事件名' }]} />
              <Form.Input field="displayName" label="显示名" placeholder="可选，如 页面进入" />
              <Form.Input field="category" label="分类" placeholder="可选，如 页面行为" />
              <Form.Select field="status" label="状态" optionList={META_STATUS_OPTIONS} style={{ width: '100%' }} />
              <Form.Select
                field="ownerId"
                label="负责人"
                placeholder="可选，契约负责人"
                optionList={ownerOptions}
                loading={ownerUsersQuery.isFetching}
                showClear
                filter
                style={{ width: '100%' }}
              />
              <Form.Switch field="strictMode" label="严格模式" extraText="开启后，不符合属性 Schema 的事件将被拒收（而非仅记录质量问题）" />
              <Form.TextArea field="description" label="描述" placeholder="请输入描述" maxCount={256} />
              <Form.TextArea
                field="propertySchemaText"
                label="属性 Schema"
                placeholder='JSON 数组，每项支持 key/type/description/required/enumValues/pii，如 [{"key":"amount","type":"number","required":true}]'
                autosize={{ minRows: 4, maxRows: 10 }}
              />
              <Typography.Text type="tertiary" size="small">
                type 支持 string / number / boolean / datetime / object / array；required 标记必填（严格模式下缺失将拒收）；
                enumValues 仅对 string 生效；pii 标记敏感信息仅供采集/导出侧参考。严格模式开启后，不符合 Schema 的事件将被拒收并记入质量看板。
              </Typography.Text>
            </Form>
          </AppModal>
        </TabPane>
        <TabPane tab="数据质量" itemKey="quality">
          <AnalyticsQualityTab />
        </TabPane>
        <TabPane tab="事件调试" itemKey="debug">
          <AnalyticsDebugTab active={activeTab === 'debug'} />
        </TabPane>
        <TabPane tab="用户分群" itemKey="segments">
          <AnalyticsSegmentsTab />
        </TabPane>
        <TabPane tab="站点管理" itemKey="sites">
          <AnalyticsSitesTab />
        </TabPane>
        <TabPane tab="数据聚合" itemKey="rollup">
          <SearchToolbar
            primary={(
              <>
                {renderRollupDaysFilter()}
                {renderRebuildRollupButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderRollupDaysFilter()}
                {renderRebuildRollupButton()}
              </>
            )}
          />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '0 0 8px' }}>
            仅统计已结束的完整自然日（不含今天）；今天的数据请在「行为分析 · 概览 / 实时」查看，每日 01:00 自动聚合前一天。
          </Typography.Text>
          <ConfigurableTable
            bordered
            rowKey="statDate"
            loading={rollupQuery.isFetching}
            columns={rollupColumns}
            dataSource={rollupItems}
            onRefresh={() => void rollupQuery.refetch()}
            refreshLoading={rollupQuery.isFetching}
            pagination={false}
            scroll={{ y: 560 }}
            empty="暂无数据"
          />
        </TabPane>
        <TabPane tab="采集设置" itemKey="settings">
          {renderSettings()}
        </TabPane>
      </Tabs>
    </div>
  );
}
