import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, TabPane, Select, Button, Toast, Form, Switch, Slider, Input, InputNumber, TagInput, Tag, Typography, SplitButtonGroup, Dropdown, DatePicker, SideSheet, Descriptions, Card, Banner } from '@douyinfe/semi-ui';
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
  useAnalyticsSettings,
  useCleanAnalyticsEvents,
  useDeleteAnalyticsEventMeta,
  useEventMetaReferences,
  useFrontendAdminUsers,
  useRebuildAnalyticsRollup,
  useSaveAnalyticsEventMeta,
  useSaveAnalyticsSettings,
} from '@/hooks/queries/analytics';
import type { AnalyticsEventMeta, AnalyticsEventMetaReferences, AnalyticsRollupItem, AnalyticsSettings, EventListItem, UserBehaviorEventType } from '@zenith/shared/analytics';
import { ANALYTICS_DEVICE_TYPES, ANALYTICS_DEVICE_TYPE_OPTIONS, ANALYTICS_EVENT_PROPERTY_TYPES, USER_BEHAVIOR_EVENT_TYPE_LABELS, userBehaviorEventTypeEnum } from '@zenith/shared/analytics';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import AnalyticsQualityTab from './AnalyticsQualityTab';
import AnalyticsDebugTab from './AnalyticsDebugTab';
import AnalyticsSegmentsTab from './AnalyticsSegmentsTab';
import AnalyticsSitesTab from './AnalyticsSitesTab';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';
import { copyableNoColumn, dateColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { JsonBlock } from '@/components/JsonBlock';

const PAGE_SIZE = 20;

function msToReadable(ms: number | null) {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

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
const EVENT_TYPE_LABEL: Record<string, { label: string; color: TagColor }> = Object.fromEntries(
  (Object.keys(EVENT_TYPE_COLOR) as UserBehaviorEventType[]).map((value) => [
    value,
    { label: USER_BEHAVIOR_EVENT_TYPE_LABELS[value], color: EVENT_TYPE_COLOR[value] },
  ]),
);

const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_LABEL).map(([value, meta]) => ({ value, label: meta.label }));
const DEVICE_OPTIONS = ANALYTICS_DEVICE_TYPE_OPTIONS;
const META_STATUS_LABEL: Record<AnalyticsEventMeta['status'], { label: string; color: TagColor }> = {
  active: { label: '启用', color: 'green' },
  deprecated: { label: '废弃', color: 'orange' },
  blocked: { label: '屏蔽', color: 'red' },
};
const META_STATUS_OPTIONS = Object.entries(META_STATUS_LABEL).map(([value, meta]) => ({ value, label: meta.label }));
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
  startTime: string;
  endTime: string;
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
type SettingsPayload = Omit<AnalyticsSettings, 'id' | 'createdAt' | 'updatedAt'>;

const defaultEventSearch: EventSearchParams = {
  eventType: undefined,
  eventName: '',
  username: '',
  pagePath: '',
  deviceType: undefined,
  startTime: '',
  endTime: '',
  timeRange: null,
};
const defaultMetaSearch: MetaSearchParams = { keyword: '', status: undefined, category: '' };

function nullableText(value: string | number | null | undefined) {
  return value == null || value === '' ? '–' : String(value);
}

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  return query.toString();
}

function parseDateRange(value: unknown): [Date, Date] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [start, end] = value;
  return start instanceof Date && end instanceof Date ? [start, end] : null;
}

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
  const meta: { label: string; color: TagColor } = EVENT_TYPE_LABEL[value] ?? { label: value, color: 'grey' };
  return <Tag color={meta.color} size="small">{meta.label}</Tag>;
}

function MetaStatusTag({ value }: Readonly<{ value: AnalyticsEventMeta['status'] }>) {
  const meta: { label: string; color: TagColor } = META_STATUS_LABEL[value] ?? { label: value, color: 'grey' };
  return <Tag color={meta.color} size="small">{meta.label}</Tag>;
}

const DATA_TABS = ['events', 'meta', 'quality', 'debug', 'segments', 'sites', 'rollup', 'settings'] as const;

export default function AnalyticsDataPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const canClean = hasPermission('analytics:clean');
  const [activeTab, setActiveTab] = useUrlTabState(DATA_TABS, 'events');

  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPageSize, setEventsPageSize] = useState(PAGE_SIZE);
  const [eventSearch, setEventSearch] = useState<EventSearchParams>(defaultEventSearch);
  const [submittedEventSearch, setSubmittedEventSearch] = useState<EventSearchParams>(defaultEventSearch);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailEventId, setDetailEventId] = useState<number | undefined>(undefined);

  const [metaPage, setMetaPage] = useState(1);
  const [metaPageSize, setMetaPageSize] = useState(PAGE_SIZE);
  const [metaSearch, setMetaSearch] = useState<MetaSearchParams>(defaultMetaSearch);
  const [submittedMetaSearch, setSubmittedMetaSearch] = useState<MetaSearchParams>(defaultMetaSearch);

  const [rollupDays, setRollupDays] = useState(30);

  const [settingsDraft, setSettingsDraft] = useState<AnalyticsSettings | null>(null);

  const buildEventFilterQuery = (params: EventSearchParams) => buildQuery({
    eventType: params.eventType,
    eventName: params.eventName,
    username: params.username,
    pagePath: params.pagePath,
    deviceType: params.deviceType,
    startTime: params.startTime,
    endTime: params.endTime,
  });

  const eventsQuery = useAnalyticsEvents({
    page: eventsPage,
    pageSize: eventsPageSize,
    eventType: enumValueOf(userBehaviorEventTypeEnum.options, submittedEventSearch.eventType),
    eventName: submittedEventSearch.eventName || undefined,
    username: submittedEventSearch.username || undefined,
    pagePath: submittedEventSearch.pagePath || undefined,
    deviceType: enumValueOf(ANALYTICS_DEVICE_TYPES, submittedEventSearch.deviceType),
    startTime: submittedEventSearch.startTime || undefined,
    endTime: submittedEventSearch.endTime || undefined,
  });
  const events = eventsQuery.data?.list ?? [];
  const eventsTotal = eventsQuery.data?.total ?? 0;

  const detailQuery = useAnalyticsEventDetail(detailEventId, detailVisible);
  const eventDetail = detailQuery.data ?? null;
  const detailLoading = detailQuery.isFetching;

  const metaQuery = useAnalyticsEventMeta({
    page: metaPage,
    pageSize: metaPageSize,
    keyword: submittedMetaSearch.keyword || undefined,
    status: submittedMetaSearch.status || undefined,
    category: submittedMetaSearch.category || undefined,
  });
  const metaList = metaQuery.data?.list ?? [];
  const metaTotal = metaQuery.data?.total ?? 0;

  const rollupQuery = useAnalyticsRollup(rollupDays, activeTab === 'rollup');
  const rollupItems = rollupQuery.data?.items ?? [];
  const settingsQuery = useAnalyticsSettings(activeTab === 'settings');
  const settings = settingsDraft;

  useEffect(() => {
    if (settingsQuery.data) setSettingsDraft(settingsQuery.data);
  }, [settingsQuery.data]);

  const cleanMutation = useCleanAnalyticsEvents();
  const saveMetaMutation = useSaveAnalyticsEventMeta();
  const deleteMetaMutation = useDeleteAnalyticsEventMeta();
  const rebuildRollupMutation = useRebuildAnalyticsRollup();
  const saveSettingsMutation = useSaveAnalyticsSettings();
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
  const ownerOptions = (ownerUsersQuery.data?.list ?? []).map((u) => ({ value: u.id, label: u.nickname || u.username }));
  const metaReferencesQuery = useEventMetaReferences(metaModal.editing?.eventName, metaModal.visible);

  const handleEventSearch = () => {
    setEventsPage(1);
    setSubmittedEventSearch(eventSearch);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.eventsLists });
  };

  const handleEventReset = () => {
    setEventSearch(defaultEventSearch);
    setSubmittedEventSearch(defaultEventSearch);
    setEventsPage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.eventsLists });
  };

  const handleEventRangeChange = (value: unknown) => {
    const range = parseDateRange(value);
    const [startTime, endTime] = formatDateTimeRangeValuesForApi(range, '');
    setEventSearch((prev) => ({
      ...prev,
      timeRange: range,
      startTime,
      endTime,
    }));
  };

  const buildExportQuery = () => {
    const query = buildEventFilterQuery(submittedEventSearch);
    return Object.fromEntries(new URLSearchParams(query).entries());
  };

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
        setEventsPage(1);
      },
    });
  };

  const openEventDetail = (record: EventListItem) => {
    setDetailVisible(true);
    setDetailEventId(record.id);
  };

  const handleMetaSearch = () => {
    setMetaPage(1);
    setSubmittedMetaSearch(metaSearch);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.metaLists });
  };

  const handleMetaReset = () => {
    setMetaSearch(defaultMetaSearch);
    setSubmittedMetaSearch(defaultMetaSearch);
    setMetaPage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.metaLists });
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
    setSettingsDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = settings;
    const next = await saveSettingsMutation.mutateAsync({ body: payload });
    setSettingsDraft(next);
    Toast.success('保存成功');
  };

  const eventColumns: ColumnProps<EventListItem>[] = [
    {
      title: '事件类型',
      dataIndex: 'eventType',
      width: 100,
      render: (value: string) => <EventTypeTag value={value} />,
    },
    { title: '用户', dataIndex: 'username', width: 110, render: (value: string | null) => nullableText(value) },
    { title: '事件名', dataIndex: 'eventName', minWidth: 150, render: (value: string | null) => renderEllipsis(value ?? '–') },
    {
      title: '页面',
      dataIndex: 'pagePath',
      width: 220,
      render: (_: unknown, record) => (
        <div>
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
            {record.pageTitle || record.pagePath}
          </Typography.Text>
          {record.pageTitle && (
            <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block', maxWidth: '100%' }}>
              {record.pagePath}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '功能/区域',
      dataIndex: 'elementLabel',
      width: 170,
      render: (_: unknown, record) => (
        <div>
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
            {record.elementLabel || record.elementKey || '–'}
          </Typography.Text>
          {record.componentArea && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
              {record.componentArea}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '设备/浏览器',
      dataIndex: 'deviceType',
      width: 140,
      render: (_: unknown, record) => (
        <div>
          <Typography.Text>{nullableText(record.deviceType)}</Typography.Text>
          <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block', maxWidth: '100%' }}>
            {nullableText(record.browser)}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '接口',
      dataIndex: 'apiUrl',
      width: 180,
      render: (_: unknown, record) => {
        if (record.apiUrl == null && record.apiStatus == null) return '–';
        const status = record.apiStatus;
        const color = status == null ? 'grey' : status >= 500 ? 'red' : status >= 400 ? 'orange' : 'green';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {status != null && <Tag color={color} size="small" style={{ flexShrink: 0 }}>{status}</Tag>}
            <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ minWidth: 0 }}>
              {record.apiUrl ?? '–'}
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
    { title: '分类', dataIndex: 'category', width: 130, render: (value: string | null) => (value ? (USER_BEHAVIOR_EVENT_TYPE_LABELS[value as UserBehaviorEventType] ?? value) : '–') },
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
      actions: (record) => [
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
      ],
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
    // [标签, 原始值, 定制渲染]：原始值为空的字段不平铺 30+ 个「–」，统一收进底部「未采集」一行
    const fields: Array<[string, unknown, React.ReactNode?]> = [
      ['ID', eventDetail.id],
      ['用户 ID', eventDetail.userId],
      ['用户名', eventDetail.username],
      ['事件类型', eventDetail.eventType, <EventTypeTag key="type" value={eventDetail.eventType} />],
      ['事件名', eventDetail.eventName],
      ['页面路径', eventDetail.pagePath],
      ['页面标题', eventDetail.pageTitle],
      ['元素 Key', eventDetail.elementKey],
      ['元素标签', eventDetail.elementLabel],
      ['组件区域', eventDetail.componentArea],
      ['停留时长', eventDetail.durationMs, msToReadable(eventDetail.durationMs)],
      ['浏览器', eventDetail.browser],
      ['浏览器版本', eventDetail.browserVersion],
      ['操作系统', eventDetail.os],
      ['系统版本', eventDetail.osVersion],
      ['设备类型', eventDetail.deviceType],
      ['屏幕宽度', eventDetail.screenW],
      ['屏幕高度', eventDetail.screenH],
      ['语言', eventDetail.language],
      ['地区', eventDetail.region],
      ['国家', eventDetail.country],
      ['城市', eventDetail.city],
      ['IP', eventDetail.ip],
      ['会话 ID', eventDetail.sessionId],
      ['Distinct ID', eventDetail.distinctId],
      ['匿名 ID', eventDetail.anonymousId],
      ['滚动深度', eventDetail.scrollDepth],
      ['来源页', eventDetail.referrer],
      ['UTM Source', eventDetail.utmSource],
      ['UTM Medium', eventDetail.utmMedium],
      ['UTM Campaign', eventDetail.utmCampaign],
      ['指标名', eventDetail.metricName],
      ['指标值', eventDetail.metricValue],
      ['User Agent', eventDetail.userAgent],
      ['创建时间', eventDetail.createdAt, formatDateTime(eventDetail.createdAt)],
    ];
    const hasValue = ([, raw]: [string, unknown, React.ReactNode?]) => raw != null && raw !== '';
    const detailData = fields.filter(hasValue).map(([key, raw, node]) => ({ key, value: node ?? String(raw) }));
    const emptyKeys = fields.filter((f) => !hasValue(f)).map(([key]) => key);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Descriptions row data={detailData} />
        {emptyKeys.length > 0 && (
          <Typography.Text type="tertiary" size="small">未采集：{emptyKeys.join('、')}</Typography.Text>
        )}
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
        <Form labelPosition="left" labelWidth={150}>
          <Form.Slot label="启用采集">
            <Switch checked={settings.enabled} onChange={(checked) => updateSettings('enabled', checked)} />
          </Form.Slot>
          <Form.Slot label="采样率">
            <div className="zx-slider-row">
              <Slider
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
            <Switch checked={settings.trackPageviews} onChange={(checked) => updateSettings('trackPageviews', checked)} />
          </Form.Slot>
          <Form.Slot label="点击行为">
            <Switch checked={settings.trackClicks} onChange={(checked) => updateSettings('trackClicks', checked)} />
          </Form.Slot>
          <Form.Slot label="性能指标">
            <Switch checked={settings.trackPerformance} onChange={(checked) => updateSettings('trackPerformance', checked)} />
          </Form.Slot>
          <Form.Slot label="错误采集">
            <Switch checked={settings.trackErrors} onChange={(checked) => updateSettings('trackErrors', checked)} />
          </Form.Slot>
          <Form.Slot label="API 请求">
            <Switch checked={settings.trackApi} onChange={(checked) => updateSettings('trackApi', checked)} />
          </Form.Slot>
          <Form.Slot label="脱敏输入内容">
            <Switch checked={settings.maskInputs} onChange={(checked) => updateSettings('maskInputs', checked)} />
          </Form.Slot>
          <Form.Slot label="尊重 DNT">
            <Switch checked={settings.respectDnt} onChange={(checked) => updateSettings('respectDnt', checked)} />
          </Form.Slot>
          <Form.Slot label="IP 匿名化">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch checked={settings.anonymizeIp} onChange={(checked) => updateSettings('anonymizeIp', checked)} />
              <Typography.Text type="tertiary" size="small">开启后仅存储网段（IPv4 抹掉末段），地理解析不受影响</Typography.Text>
            </div>
          </Form.Slot>
          <Form.Slot label="黑名单路径">
            <TagInput
              value={settings.blacklistPaths}
              placeholder="输入路径后回车，如 /login"
              onChange={(value: string[]) => updateSettings('blacklistPaths', value)}
              style={{ width: 520 }}
            />
          </Form.Slot>
          <Form.Slot label="错误忽略规则">
            <div>
              <TagInput
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
              min={1}
              value={settings.retentionDays}
              onChange={(value) => updateSettings('retentionDays', numberValue(value, settings.retentionDays))}
              style={{ width: 180 }}
            />
          </Form.Slot>
          <Form.Slot label="错误保留天数">
            <InputNumber
              min={1}
              value={settings.errorRetentionDays}
              onChange={(value) => updateSettings('errorRetentionDays', numberValue(value, settings.errorRetentionDays))}
              style={{ width: 180 }}
            />
          </Form.Slot>
          <Form.Slot label="会话超时分钟">
            <InputNumber
              min={1}
              value={settings.sessionTimeoutMinutes}
              onChange={(value) => updateSettings('sessionTimeoutMinutes', numberValue(value, settings.sessionTimeoutMinutes))}
              style={{ width: 180 }}
            />
          </Form.Slot>
          <Form.Slot label="会话回放">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch checked={settings.trackReplay} onChange={(checked) => updateSettings('trackReplay', checked)} />
              <Typography.Text type="tertiary" size="small">开启后 SDK 按需加载 rrweb 录制器（关闭时零开销）</Typography.Text>
            </div>
          </Form.Slot>
          {settings.trackReplay && (
            <>
              <Form.Slot label="错误触发回放">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch checked={settings.replayOnError} onChange={(checked) => updateSettings('replayOnError', checked)} />
                  <Typography.Text type="tertiary" size="small">报错时上传错误前约 60s 缓冲现场并继续录制</Typography.Text>
                </div>
              </Form.Slot>
              <Form.Slot label="全程录制采样率">
                <div className="zx-slider-row">
                  <Slider
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
                  <Switch checked={settings.replayMaskAllText} onChange={(checked) => updateSettings('replayMaskAllText', checked)} />
                  <Typography.Text type="tertiary" size="small">输入框始终打码；开启后页面全部文本一并脱敏</Typography.Text>
                </div>
              </Form.Slot>
              <Form.Slot label="回放屏蔽选择器">
                <Input
                  value={settings.replayBlockSelector}
                  placeholder="CSS 选择器，如 .sensitive-area（命中元素整块不录制）"
                  onChange={(value) => updateSettings('replayBlockSelector', value)}
                  style={{ width: 520 }}
                />
              </Form.Slot>
              <Form.Slot label="回放保留天数">
                <InputNumber
                  min={1}
                  value={settings.replayRetentionDays}
                  onChange={(value) => updateSettings('replayRetentionDays', numberValue(value, settings.replayRetentionDays))}
                  style={{ width: 180 }}
                />
              </Form.Slot>
              <Form.Slot label="回放存储配额">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <InputNumber
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
            <Button type="primary" loading={saveSettingsMutation.isPending} onClick={() => void handleSaveSettings()}>保存</Button>
          </Form.Slot>
        </Form>
      </Card>
    );
  };

  const renderEventTypeFilter = () => (
    <FilterSelect
      placeholder="全部事件类型"
      items={EVENT_TYPE_OPTIONS}
      value={eventSearch.eventType}
      onChange={(value) => setEventSearch((prev) => ({ ...prev, eventType: value }))}
      width={150}
    />
  );
  const renderEventNameSearch = () => (
    <KeywordInput placeholder="事件名" value={eventSearch.eventName} onChange={(value) => setEventSearch((prev) => ({ ...prev, eventName: value }))} onSearch={handleEventSearch} width={160} />
  );
  const renderEventUsernameSearch = () => (
    <KeywordInput placeholder="用户名" value={eventSearch.username} onChange={(value) => setEventSearch((prev) => ({ ...prev, username: value }))} onSearch={handleEventSearch} width={140} />
  );
  const renderEventPagePathSearch = () => (
    <KeywordInput placeholder="页面路径" value={eventSearch.pagePath} onChange={(value) => setEventSearch((prev) => ({ ...prev, pagePath: value }))} onSearch={handleEventSearch} width={180} />
  );
  const renderEventDeviceFilter = () => (
    <FilterSelect
      placeholder="全部设备"
      items={DEVICE_OPTIONS}
      value={eventSearch.deviceType}
      onChange={(value) => setEventSearch((prev) => ({ ...prev, deviceType: value }))}
    />
  );
  const renderEventTimeRangeFilter = () => (
    <DatePicker
      type="dateTimeRange"
      placeholder={['开始时间', '结束时间']}
      value={eventSearch.timeRange ?? undefined}
      onChange={handleEventRangeChange}
      style={{ width: 330 }}
    />
  );
  const renderEventSearchButton = () => <SearchButton onClick={handleEventSearch} />;
  const renderEventResetButton = () => <ResetButton onClick={handleEventReset} />;
  const renderEventExportButtons = () => <ExportButton entity="analytics.events" query={buildExportQuery()} />;
  const renderEventCleanButtons = () => canClean ? (
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
  ) : null;
  const renderMobileEventActions = () => (
    <>
      <ExportButton entity="analytics.events" query={buildExportQuery()} variant="flat" />
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
  );

  const renderMetaKeywordSearch = () => (
    <KeywordInput placeholder="关键词" value={metaSearch.keyword} onChange={(value) => setMetaSearch((prev) => ({ ...prev, keyword: value }))} onSearch={handleMetaSearch} width={180} />
  );
  const renderMetaCategorySearch = () => (
    <KeywordInput placeholder="分类" value={metaSearch.category} onChange={(value) => setMetaSearch((prev) => ({ ...prev, category: value }))} onSearch={handleMetaSearch} width={140} />
  );
  const renderMetaStatusFilter = () => (
    <StatusSelect
      items={META_STATUS_OPTIONS}
      value={metaSearch.status}
      onChange={(value) => setMetaSearch((prev) => ({ ...prev, status: value as AnalyticsEventMeta['status'] | undefined }))}
    />
  );
  const renderMetaSearchButton = () => <SearchButton onClick={handleMetaSearch} />;
  const renderMetaResetButton = () => <ResetButton onClick={handleMetaReset} />;
  const renderMetaCreateButton = () => <CreateButton onClick={metaModal.openCreate} />;
  const renderRollupDaysFilter = () => (
    <Select value={rollupDays} onChange={handleRollupDaysChange} optionList={ROLLUP_DAY_OPTIONS} style={{ width: 130 }} />
  );
  const renderRebuildRollupButton = () => (
    <Button type="primary" loading={rebuildRollupMutation.isPending} onClick={() => void handleRebuildRollup()}>重建聚合</Button>
  );

  return (
    <div className="page-container page-tabs-page zx-flat-panels">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} type="line" lazyRender keepDOM={false}>
        <TabPane tab="事件明细" itemKey="events">
          <SearchToolbar
            primary={(
              <>
                {renderEventTypeFilter()}
                {renderEventNameSearch()}
                {renderEventUsernameSearch()}
                {renderEventPagePathSearch()}
                {renderEventDeviceFilter()}
                {renderEventTimeRangeFilter()}
                {renderEventSearchButton()}
                {renderEventResetButton()}
                {renderEventExportButtons()}
                {renderEventCleanButtons()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderEventNameSearch()}
                {renderEventSearchButton()}
              </>
            )}
            mobileFilters={(
              <>
                {renderEventTypeFilter()}
                {renderEventUsernameSearch()}
                {renderEventPagePathSearch()}
                {renderEventDeviceFilter()}
                {renderEventTimeRangeFilter()}
              </>
            )}
            mobileActions={renderMobileEventActions()}
            filterTitle="事件筛选"
            actionTitle="事件操作"
            onFilterApply={handleEventSearch}
            onFilterReset={handleEventReset}
          />

          <ConfigurableTable
            bordered
            rowKey="id"
            loading={eventsQuery.isFetching}
            columns={eventColumns}
            dataSource={events}
            onRefresh={() => void eventsQuery.refetch()}
            refreshLoading={eventsQuery.isFetching}
            pagination={{
              currentPage: eventsPage,
              pageSize: eventsPageSize,
              total: eventsTotal,
              onPageChange: (page) => {
                setEventsPage(page);
              },
              onPageSizeChange: (pageSize) => {
                setEventsPage(1);
                setEventsPageSize(pageSize);
              },
            }}
            empty="暂无数据"
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
          <SearchToolbar
            primary={(
              <>
                {renderMetaKeywordSearch()}
                {renderMetaCategorySearch()}
                {renderMetaStatusFilter()}
                {renderMetaSearchButton()}
                {renderMetaResetButton()}
                {renderMetaCreateButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderMetaKeywordSearch()}
                {renderMetaSearchButton()}
                {renderMetaCreateButton()}
              </>
            )}
            mobileFilters={(
              <>
                {renderMetaCategorySearch()}
                {renderMetaStatusFilter()}
              </>
            )}
            filterTitle="事件字典筛选"
            onFilterApply={handleMetaSearch}
            onFilterReset={handleMetaReset}
          />

          <ConfigurableTable
            bordered
            rowKey="id"
            loading={metaQuery.isFetching}
            columns={metaColumns}
            dataSource={metaList}
            onRefresh={() => void metaQuery.refetch()}
            refreshLoading={metaQuery.isFetching}
            pagination={{
              currentPage: metaPage,
              pageSize: metaPageSize,
              total: metaTotal,
              onPageChange: (page) => {
                setMetaPage(page);
              },
              onPageSizeChange: (pageSize) => {
                setMetaPage(1);
                setMetaPageSize(pageSize);
              },
            }}
            empty="暂无数据"
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
