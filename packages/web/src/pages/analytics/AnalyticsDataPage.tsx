import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Tabs,
  TabPane,
  Input,
  Select,
  Button,
  Toast,
  Modal,
  Form,
  Switch,
  Slider,
  InputNumber,
  TagInput,
  Tag,
  Typography,
  SplitButtonGroup,
  Dropdown,
  DatePicker,
  SideSheet,
  Descriptions,
  Card,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { Search, RotateCcw, Plus, Trash2, ChevronDown } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { request } from '@/utils/request';
import type {
  AnalyticsEventMeta,
  AnalyticsSettings,
  EventDetail,
  EventListItem,
  PaginatedResponse,
} from '@zenith/shared';

const PAGE_SIZE = 20;

function msToReadable(ms: number | null) {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

interface AnalyticsRollupItem {
  statDate: string;
  pv: number;
  uv: number;
  sessions: number;
  events: number;
  bounceSessions: number;
  totalDwellMs: number;
}

const EVENT_TYPE_LABEL: Record<string, { label: string; color: TagColor }> = {
  page_view: { label: '页面进入', color: 'blue' },
  page_leave: { label: '页面离开', color: 'teal' },
  feature_use: { label: '功能点击', color: 'green' },
  area_click: { label: '区域点击', color: 'orange' },
  custom: { label: '自定义', color: 'violet' },
  perf: { label: '性能', color: 'cyan' },
  api_request: { label: 'API请求', color: 'amber' },
  identify: { label: '身份', color: 'grey' },
};

const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_LABEL).map(([value, meta]) => ({ value, label: meta.label }));
const DEVICE_OPTIONS = [
  { value: 'desktop', label: '桌面端' },
  { value: 'mobile', label: '移动端' },
  { value: 'tablet', label: '平板' },
  { value: 'bot', label: '爬虫/机器人' },
  { value: 'unknown', label: '未知' },
];
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
  eventType: string;
  eventName: string;
  username: string;
  pagePath: string;
  deviceType: string;
  startTime: string;
  endTime: string;
  timeRange: [Date, Date] | null;
}

interface MetaSearchParams {
  keyword: string;
  status: AnalyticsEventMeta['status'] | '';
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
};
type EventMetaFormValues = Omit<EventMetaPayload, 'propertySchema'> & { propertySchemaText?: string };
type SettingsPayload = Omit<AnalyticsSettings, 'id' | 'createdAt' | 'updatedAt'>;

const defaultEventSearch: EventSearchParams = {
  eventType: '',
  eventName: '',
  username: '',
  pagePath: '',
  deviceType: '',
  startTime: '',
  endTime: '',
  timeRange: null,
};
const defaultMetaSearch: MetaSearchParams = { keyword: '', status: '', category: '' };

function formatNullableDate(value: string | null) {
  return value ? formatDateTime(value) : '–';
}

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

function withQuery(url: string, query: string) {
  return query ? `${url}?${query}` : url;
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
  return parsed.map((item): EventMetaProperty => {
    if (!item || typeof item !== 'object') throw new Error('属性 Schema 每项必须是对象');
    const record = item as Record<string, unknown>;
    if (typeof record.key !== 'string' || typeof record.type !== 'string') {
      throw new Error('属性 Schema 每项必须包含 key 和 type');
    }
    return {
      key: record.key,
      type: record.type,
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
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

export default function AnalyticsDataPage() {
  const [activeTab, setActiveTab] = useState<'events' | 'meta' | 'rollup' | 'settings'>('events');

  const [events, setEvents] = useState<EventListItem[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPageSize, setEventsPageSize] = useState(PAGE_SIZE);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventSearch, setEventSearch] = useState<EventSearchParams>(defaultEventSearch);
  const [cleanLoading, setCleanLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const eventSearchRef = useRef(defaultEventSearch);
  const eventsPageRef = useRef({ page: 1, pageSize: PAGE_SIZE });
  eventSearchRef.current = eventSearch;
  eventsPageRef.current = { page: eventsPage, pageSize: eventsPageSize };

  const [metaList, setMetaList] = useState<AnalyticsEventMeta[]>([]);
  const [metaTotal, setMetaTotal] = useState(0);
  const [metaPage, setMetaPage] = useState(1);
  const [metaPageSize, setMetaPageSize] = useState(PAGE_SIZE);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaSearch, setMetaSearch] = useState<MetaSearchParams>(defaultMetaSearch);
  const [metaModalVisible, setMetaModalVisible] = useState(false);
  const [editingMeta, setEditingMeta] = useState<AnalyticsEventMeta | null>(null);
  const [metaSubmitting, setMetaSubmitting] = useState(false);
  const metaSearchRef = useRef(defaultMetaSearch);
  const metaPageRef = useRef({ page: 1, pageSize: PAGE_SIZE });
  const metaFormApi = useRef<FormApi | null>(null);
  metaSearchRef.current = metaSearch;
  metaPageRef.current = { page: metaPage, pageSize: metaPageSize };

  const [rollupDays, setRollupDays] = useState(30);
  const [rollupItems, setRollupItems] = useState<AnalyticsRollupItem[]>([]);
  const [rollupLoading, setRollupLoading] = useState(false);
  const [rollupRebuilding, setRollupRebuilding] = useState(false);

  const [settings, setSettings] = useState<AnalyticsSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const buildEventFilterQuery = useCallback((params: EventSearchParams) => buildQuery({
    eventType: params.eventType,
    eventName: params.eventName,
    username: params.username,
    pagePath: params.pagePath,
    deviceType: params.deviceType,
    startTime: params.startTime,
    endTime: params.endTime,
  }), []);

  const buildEventQuery = useCallback((p: number, ps: number, params: EventSearchParams) => buildQuery({
    page: p,
    pageSize: ps,
    eventType: params.eventType,
    eventName: params.eventName,
    username: params.username,
    pagePath: params.pagePath,
    deviceType: params.deviceType,
    startTime: params.startTime,
    endTime: params.endTime,
  }), []);

  const fetchEvents = useCallback(async (
    p = eventsPageRef.current.page,
    ps = eventsPageRef.current.pageSize,
    params = eventSearchRef.current,
  ) => {
    setEventsLoading(true);
    try {
      const res = await request.get<PaginatedResponse<EventListItem>>(
        `/api/analytics/events?${buildEventQuery(p, ps, params)}`,
      );
      if (res.code === 0) {
        setEvents(res.data.list);
        setEventsTotal(res.data.total);
        setEventsPage(res.data.page);
        setEventsPageSize(res.data.pageSize);
      }
    } finally {
      setEventsLoading(false);
    }
  }, [buildEventQuery]);

  const buildMetaQuery = useCallback((p: number, ps: number, params: MetaSearchParams) => buildQuery({
    page: p,
    pageSize: ps,
    keyword: params.keyword,
    status: params.status,
    category: params.category,
  }), []);

  const fetchMeta = useCallback(async (
    p = metaPageRef.current.page,
    ps = metaPageRef.current.pageSize,
    params = metaSearchRef.current,
  ) => {
    setMetaLoading(true);
    try {
      const res = await request.get<PaginatedResponse<AnalyticsEventMeta>>(
        `/api/analytics/event-meta?${buildMetaQuery(p, ps, params)}`,
      );
      if (res.code === 0) {
        setMetaList(res.data.list);
        setMetaTotal(res.data.total);
        setMetaPage(res.data.page);
        setMetaPageSize(res.data.pageSize);
      }
    } finally {
      setMetaLoading(false);
    }
  }, [buildMetaQuery]);

  const fetchRollup = useCallback(async (days = rollupDays) => {
    setRollupLoading(true);
    try {
      const res = await request.get<{ items: AnalyticsRollupItem[] }>(`/api/analytics/rollup?days=${days}`);
      if (res.code === 0) setRollupItems(res.data.items);
    } finally {
      setRollupLoading(false);
    }
  }, [rollupDays]);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await request.get<AnalyticsSettings>('/api/analytics/settings');
      if (res.code === 0) setSettings(res.data);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'events') void fetchEvents();
  }, [activeTab, fetchEvents]);

  useEffect(() => {
    if (activeTab === 'meta') void fetchMeta();
  }, [activeTab, fetchMeta]);

  useEffect(() => {
    if (activeTab === 'rollup') void fetchRollup();
  }, [activeTab, fetchRollup]);

  useEffect(() => {
    if (activeTab === 'settings') void fetchSettings();
  }, [activeTab, fetchSettings]);

  const handleEventSearch = () => {
    setEventsPage(1);
    void fetchEvents(1, eventsPageSize);
  };

  const handleEventReset = () => {
    setEventSearch(defaultEventSearch);
    setEventsPage(1);
    void fetchEvents(1, eventsPageSize, defaultEventSearch);
  };

  const handleEventRangeChange = (value: unknown) => {
    const range = parseDateRange(value);
    setEventSearch((prev) => ({
      ...prev,
      timeRange: range,
      startTime: range ? formatDateTimeForApi(range[0]) : '',
      endTime: range ? formatDateTimeForApi(range[1]) : '',
    }));
  };

  const buildExportQuery = () => {
    const query = buildEventFilterQuery(eventSearchRef.current);
    return Object.fromEntries(new URLSearchParams(query).entries());
  };

  const handleClean = (days: number) => {
    const option = CLEAN_DAY_OPTIONS.find((item) => item.value === days);
    Modal.confirm({
      title: `确认清除${days === 0 ? '全部' : `${option?.label ?? `${days} 天`}前的`}埋点数据？`,
      content: '清除后数据不可恢复，请谨慎操作。',
      okText: '确认清除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      closeOnEsc: true,
      onOk: async () => {
        setCleanLoading(true);
        try {
          const res = await request.delete(`/api/analytics/clean?days=${days}`);
          if (res.code === 0) {
            Toast.success(res.message || '清除成功');
            setEventsPage(1);
            void fetchEvents(1, eventsPageSize);
            void fetchRollup();
          }
        } finally {
          setCleanLoading(false);
        }
      },
    });
  };

  const openEventDetail = async (record: EventListItem) => {
    setDetailVisible(true);
    setDetailLoading(true);
    setEventDetail(null);
    try {
      const res = await request.get<EventDetail>(`/api/analytics/events/${record.id}`);
      if (res.code === 0) setEventDetail(res.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleMetaSearch = () => {
    setMetaPage(1);
    void fetchMeta(1, metaPageSize);
  };

  const handleMetaReset = () => {
    setMetaSearch(defaultMetaSearch);
    setMetaPage(1);
    void fetchMeta(1, metaPageSize, defaultMetaSearch);
  };

  const openCreateMeta = () => {
    setEditingMeta(null);
    setMetaModalVisible(true);
  };

  const openEditMeta = (record: AnalyticsEventMeta) => {
    setEditingMeta(record);
    setMetaModalVisible(true);
  };

  const handleMetaSubmit = async () => {
    const api = metaFormApi.current;
    if (!api) return;
    let values: EventMetaFormValues;
    try {
      values = await api.validate() as EventMetaFormValues;
    } catch {
      throw new Error('validation');
    }

    let propertySchema: AnalyticsEventMeta['propertySchema'];
    try {
      propertySchema = parsePropertySchema(values.propertySchemaText);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '属性 Schema 格式错误');
      throw error;
    }

    const payload: EventMetaPayload = {
      eventName: values.eventName.trim(),
      displayName: trimToNull(values.displayName),
      category: trimToNull(values.category),
      description: trimToNull(values.description),
      status: values.status,
      propertySchema,
    };

    setMetaSubmitting(true);
    try {
      const res = editingMeta
        ? await request.put<AnalyticsEventMeta>(`/api/analytics/event-meta/${editingMeta.id}`, payload)
        : await request.post<AnalyticsEventMeta>('/api/analytics/event-meta', payload);
      if (res.code === 0) {
        Toast.success(editingMeta ? '更新成功' : '创建成功');
        setMetaModalVisible(false);
        setEditingMeta(null);
        void fetchMeta();
      } else {
        throw new Error(res.message);
      }
    } finally {
      setMetaSubmitting(false);
    }
  };

  const handleMetaDelete = async (record: AnalyticsEventMeta) => {
    const res = await request.delete(`/api/analytics/event-meta/${record.id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchMeta();
    }
  };

  const handleRollupDaysChange = (value: unknown) => {
    const days = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(days)) return;
    setRollupDays(days);
  };

  const handleRebuildRollup = async () => {
    setRollupRebuilding(true);
    try {
      const res = await request.post(`/api/analytics/rollup/rebuild?days=${rollupDays}`);
      if (res.code === 0) {
        Toast.success(res.message || '重建完成');
        void fetchRollup(rollupDays);
      }
    } finally {
      setRollupRebuilding(false);
    }
  };

  const updateSettings = <K extends keyof SettingsPayload>(key: K, value: SettingsPayload[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = settings;
    setSettingsSaving(true);
    try {
      const res = await request.put<AnalyticsSettings>('/api/analytics/settings', payload);
      if (res.code === 0) {
        setSettings(res.data);
        Toast.success(res.message || '保存成功');
      }
    } finally {
      setSettingsSaving(false);
    }
  };

  const metaFormInit: EventMetaFormValues = editingMeta
    ? {
        eventName: editingMeta.eventName,
        displayName: editingMeta.displayName,
        category: editingMeta.category,
        description: editingMeta.description,
        status: editingMeta.status,
        propertySchemaText: JSON.stringify(editingMeta.propertySchema ?? [], null, 2),
      }
    : {
        eventName: '',
        displayName: null,
        category: null,
        description: null,
        status: 'active',
        propertySchemaText: '[]',
      };

  const eventColumns: ColumnProps<EventListItem>[] = [
    {
      title: '事件类型',
      dataIndex: 'eventType',
      width: 110,
      render: (value: string) => <EventTypeTag value={value} />,
    },
    { title: '用户', dataIndex: 'username', width: 120, render: (value: string | null) => nullableText(value) },
    { title: '事件名', dataIndex: 'eventName', width: 180, render: (value: string | null) => nullableText(value) },
    {
      title: '页面',
      dataIndex: 'pagePath',
      width: 260,
      render: (_: unknown, record) => (
        <div>
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 230 }}>
            {record.pageTitle || record.pagePath}
          </Typography.Text>
          {record.pageTitle && (
            <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block', maxWidth: 230 }}>
              {record.pagePath}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '功能/区域',
      dataIndex: 'elementLabel',
      width: 220,
      render: (_: unknown, record) => (
        <div>
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 190 }}>
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
      width: 160,
      render: (_: unknown, record) => (
        <div>
          <Typography.Text>{nullableText(record.deviceType)}</Typography.Text>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
            {nullableText(record.browser)}
          </Typography.Text>
        </div>
      ),
    },
    { title: '时长', dataIndex: 'durationMs', width: 100, render: (value: number | null) => msToReadable(value) },
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (value: string) => formatDateTime(value) },
    createOperationColumn<EventListItem>({
      width: 90,
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
    {
      title: '事件名',
      dataIndex: 'eventName',
      width: 200,
      render: (value: string) => <Typography.Text copyable={{ content: value }} ellipsis={{ showTooltip: true }} style={{ maxWidth: 170 }}>{value}</Typography.Text>,
    },
    { title: '显示名', dataIndex: 'displayName', width: 150, render: (value: string | null) => nullableText(value) },
    { title: '分类', dataIndex: 'category', width: 130, render: (value: string | null) => nullableText(value) },
    { title: '触发次数', dataIndex: 'eventCount', width: 100 },
    {
      title: '首次/最近',
      dataIndex: 'firstSeenAt',
      width: 210,
      render: (_: unknown, record) => (
        <div>
          <Typography.Text size="small">首次：{formatNullableDate(record.firstSeenAt)}</Typography.Text>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
            最近：{formatNullableDate(record.lastSeenAt)}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      fixed: 'right',
      width: 90,
      render: (value: AnalyticsEventMeta['status']) => <MetaStatusTag value={value} />,
    },
    createOperationColumn<AnalyticsEventMeta>({
      width: 130,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          onClick: () => openEditMeta(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: `确定删除事件「${record.eventName}」吗？`,
              okButtonProps: { type: 'danger' },
              onOk: () => handleMetaDelete(record),
            });
          },
        },
      ],
    }),
  ];

  const rollupColumns: ColumnProps<AnalyticsRollupItem>[] = [
    { title: '日期', dataIndex: 'statDate', width: 130 },
    { title: 'PV', dataIndex: 'pv', width: 100 },
    { title: 'UV', dataIndex: 'uv', width: 100 },
    { title: '会话', dataIndex: 'sessions', width: 100 },
    { title: '事件', dataIndex: 'events', width: 100 },
    { title: '跳出会话', dataIndex: 'bounceSessions', width: 110 },
    { title: '总停留', dataIndex: 'totalDwellMs', width: 140, render: (value: number) => msToReadable(value) },
  ];

  const renderEventDetail = () => {
    if (detailLoading) return <Typography.Text type="tertiary">加载中...</Typography.Text>;
    if (!eventDetail) return <Typography.Text type="tertiary">暂无详情</Typography.Text>;
    const detailData = [
      { key: 'ID', value: eventDetail.id },
      { key: '用户 ID', value: nullableText(eventDetail.userId) },
      { key: '用户名', value: nullableText(eventDetail.username) },
      { key: '事件类型', value: <EventTypeTag value={eventDetail.eventType} /> },
      { key: '事件名', value: nullableText(eventDetail.eventName) },
      { key: '页面路径', value: eventDetail.pagePath },
      { key: '页面标题', value: nullableText(eventDetail.pageTitle) },
      { key: '元素 Key', value: nullableText(eventDetail.elementKey) },
      { key: '元素标签', value: nullableText(eventDetail.elementLabel) },
      { key: '组件区域', value: nullableText(eventDetail.componentArea) },
      { key: '停留时长', value: msToReadable(eventDetail.durationMs) },
      { key: '浏览器', value: nullableText(eventDetail.browser) },
      { key: '浏览器版本', value: nullableText(eventDetail.browserVersion) },
      { key: '操作系统', value: nullableText(eventDetail.os) },
      { key: '系统版本', value: nullableText(eventDetail.osVersion) },
      { key: '设备类型', value: nullableText(eventDetail.deviceType) },
      { key: '屏幕宽度', value: nullableText(eventDetail.screenW) },
      { key: '屏幕高度', value: nullableText(eventDetail.screenH) },
      { key: '语言', value: nullableText(eventDetail.language) },
      { key: '地区', value: nullableText(eventDetail.region) },
      { key: '国家', value: nullableText(eventDetail.country) },
      { key: '城市', value: nullableText(eventDetail.city) },
      { key: 'IP', value: nullableText(eventDetail.ip) },
      { key: '会话 ID', value: nullableText(eventDetail.sessionId) },
      { key: 'Distinct ID', value: nullableText(eventDetail.distinctId) },
      { key: '匿名 ID', value: nullableText(eventDetail.anonymousId) },
      { key: '滚动深度', value: nullableText(eventDetail.scrollDepth) },
      { key: '来源页', value: nullableText(eventDetail.referrer) },
      { key: 'UTM Source', value: nullableText(eventDetail.utmSource) },
      { key: 'UTM Medium', value: nullableText(eventDetail.utmMedium) },
      { key: 'UTM Campaign', value: nullableText(eventDetail.utmCampaign) },
      { key: '指标名', value: nullableText(eventDetail.metricName) },
      { key: '指标值', value: nullableText(eventDetail.metricValue) },
      { key: 'User Agent', value: nullableText(eventDetail.userAgent) },
      { key: '创建时间', value: formatDateTime(eventDetail.createdAt) },
    ];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Descriptions row data={detailData} />
        <div>
          <Typography.Title heading={6}>事件属性</Typography.Title>
          <pre style={{ margin: 0, padding: 12, borderRadius: 6, background: 'var(--semi-color-fill-0)', overflow: 'auto' }}>
            {JSON.stringify(eventDetail.properties ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    );
  };

  const renderSettings = () => {
    if (!settings) {
      return (
        <Card bodyStyle={{ padding: 24 }}>
          <Typography.Text type="tertiary">{settingsLoading ? '加载中...' : '暂无设置'}</Typography.Text>
        </Card>
      );
    }

    return (
      <Card bodyStyle={{ padding: 20 }}>
        <Form labelPosition="left" labelWidth={150}>
          <Form.Slot label="启用采集">
            <Switch checked={settings.enabled} onChange={(checked) => updateSettings('enabled', checked)} />
          </Form.Slot>
          <Form.Slot label="采样率">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, maxWidth: 520 }}>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={settings.sampleRate}
                onChange={(value) => {
                  if (typeof value === 'number') updateSettings('sampleRate', Number(value.toFixed(2)));
                }}
                style={{ flex: 1 }}
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
          <Form.Slot label="黑名单路径">
            <TagInput
              value={settings.blacklistPaths}
              placeholder="输入路径后回车，如 /login"
              onChange={(value: string[]) => updateSettings('blacklistPaths', value)}
              style={{ width: 520 }}
            />
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
          <Form.Slot label=" ">
            <Button type="primary" loading={settingsSaving} onClick={() => void handleSaveSettings()}>保存</Button>
          </Form.Slot>
        </Form>
      </Card>
    );
  };

  const renderEventTypeFilter = () => (
    <Select
      placeholder="事件类型"
      value={eventSearch.eventType || undefined}
      onChange={(value) => setEventSearch((prev) => ({ ...prev, eventType: (value as string) ?? '' }))}
      optionList={EVENT_TYPE_OPTIONS}
      showClear
      style={{ width: 150 }}
    />
  );
  const renderEventNameSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="事件名"
      value={eventSearch.eventName}
      onChange={(value) => setEventSearch((prev) => ({ ...prev, eventName: value }))}
      onEnterPress={handleEventSearch}
      showClear
      style={{ width: 160 }}
    />
  );
  const renderEventUsernameSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="用户名"
      value={eventSearch.username}
      onChange={(value) => setEventSearch((prev) => ({ ...prev, username: value }))}
      onEnterPress={handleEventSearch}
      showClear
      style={{ width: 140 }}
    />
  );
  const renderEventPagePathSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="页面路径"
      value={eventSearch.pagePath}
      onChange={(value) => setEventSearch((prev) => ({ ...prev, pagePath: value }))}
      onEnterPress={handleEventSearch}
      showClear
      style={{ width: 180 }}
    />
  );
  const renderEventDeviceFilter = () => (
    <Select
      placeholder="设备"
      value={eventSearch.deviceType || undefined}
      onChange={(value) => setEventSearch((prev) => ({ ...prev, deviceType: (value as string) ?? '' }))}
      optionList={DEVICE_OPTIONS}
      showClear
      style={{ width: 130 }}
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
  const renderEventSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleEventSearch}>查询</Button>;
  const renderEventResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleEventReset}>重置</Button>;
  const renderEventExportButtons = () => <ExportButton entity="analytics.events" query={buildExportQuery()} />;
  const renderEventCleanButtons = () => (
    <SplitButtonGroup>
      <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={cleanLoading} onClick={() => handleClean(90)}>清除数据</Button>
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
  );
  const renderMobileEventActions = () => (
    <>
      <ExportButton entity="analytics.events" query={buildExportQuery()} variant="flat" />
      {CLEAN_DAY_OPTIONS.map((item) => (
        <Button
          key={item.value}
          type={item.value === 0 ? 'danger' : 'tertiary'}
          theme="light"
          icon={<Trash2 size={14} />}
          loading={cleanLoading}
          onClick={() => handleClean(item.value)}
        >
          清除{item.label === '全部' ? '全部数据' : `${item.label}前数据`}
        </Button>
      ))}
    </>
  );

  const renderMetaKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="关键词"
      value={metaSearch.keyword}
      onChange={(value) => setMetaSearch((prev) => ({ ...prev, keyword: value }))}
      onEnterPress={handleMetaSearch}
      showClear
      style={{ width: 180 }}
    />
  );
  const renderMetaCategorySearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="分类"
      value={metaSearch.category}
      onChange={(value) => setMetaSearch((prev) => ({ ...prev, category: value }))}
      onEnterPress={handleMetaSearch}
      showClear
      style={{ width: 140 }}
    />
  );
  const renderMetaStatusFilter = () => (
    <Select
      placeholder="状态"
      value={metaSearch.status || undefined}
      onChange={(value) => setMetaSearch((prev) => ({ ...prev, status: (value as AnalyticsEventMeta['status']) ?? '' }))}
      optionList={META_STATUS_OPTIONS}
      showClear
      style={{ width: 130 }}
    />
  );
  const renderMetaSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleMetaSearch}>查询</Button>;
  const renderMetaResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleMetaReset}>重置</Button>;
  const renderMetaCreateButton = () => <Button type="primary" icon={<Plus size={14} />} onClick={openCreateMeta}>新增</Button>;
  const renderRollupDaysFilter = () => (
    <Select value={rollupDays} onChange={handleRollupDaysChange} optionList={ROLLUP_DAY_OPTIONS} style={{ width: 130 }} />
  );
  const renderRebuildRollupButton = () => (
    <Button type="primary" loading={rollupRebuilding} onClick={() => void handleRebuildRollup()}>重建聚合</Button>
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} type="line" lazyRender keepDOM={false}>
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
            loading={eventsLoading}
            columns={eventColumns}
            dataSource={events}
            onRefresh={() => void fetchEvents()}
            refreshLoading={eventsLoading}
            scroll={{ x: 1500 }}
            pagination={{
              currentPage: eventsPage,
              pageSize: eventsPageSize,
              total: eventsTotal,
              onPageChange: (page) => {
                setEventsPage(page);
                void fetchEvents(page, eventsPageSize);
              },
              onPageSizeChange: (pageSize) => {
                setEventsPage(1);
                setEventsPageSize(pageSize);
                void fetchEvents(1, pageSize);
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
            loading={metaLoading}
            columns={metaColumns}
            dataSource={metaList}
            onRefresh={() => void fetchMeta()}
            refreshLoading={metaLoading}
            scroll={{ x: 1120 }}
            pagination={{
              currentPage: metaPage,
              pageSize: metaPageSize,
              total: metaTotal,
              onPageChange: (page) => {
                setMetaPage(page);
                void fetchMeta(page, metaPageSize);
              },
              onPageSizeChange: (pageSize) => {
                setMetaPage(1);
                setMetaPageSize(pageSize);
                void fetchMeta(1, pageSize);
              },
            }}
            empty="暂无数据"
          />

          <Modal
            title={editingMeta ? '编辑事件字典' : '新增事件字典'}
            visible={metaModalVisible}
            onCancel={() => { setMetaModalVisible(false); setEditingMeta(null); }}
            onOk={() => { void handleMetaSubmit().catch(() => undefined); }}
            okButtonProps={{ loading: metaSubmitting }}
            width={640}
            closeOnEsc
          >
            <Form
              key={editingMeta?.id ?? 'new'}
              getFormApi={(api) => { metaFormApi.current = api; }}
              allowEmpty
              initValues={metaFormInit}
              labelPosition="left"
              labelWidth={110}
            >
              <Form.Input field="eventName" label="事件名" placeholder="如 page_view" rules={[{ required: true, message: '请输入事件名' }]} />
              <Form.Input field="displayName" label="显示名" placeholder="可选，如 页面进入" />
              <Form.Input field="category" label="分类" placeholder="可选，如 页面行为" />
              <Form.Select field="status" label="状态" optionList={META_STATUS_OPTIONS} style={{ width: '100%' }} />
              <Form.TextArea field="description" label="描述" placeholder="请输入描述" maxCount={256} />
              <Form.TextArea
                field="propertySchemaText"
                label="属性 Schema"
                placeholder='JSON 数组，如 [{"key":"path","type":"string","description":"页面路径"}]'
                autosize={{ minRows: 3, maxRows: 8 }}
              />
            </Form>
          </Modal>
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
          <ConfigurableTable
            bordered
            rowKey="statDate"
            loading={rollupLoading}
            columns={rollupColumns}
            dataSource={rollupItems}
            onRefresh={() => void fetchRollup()}
            refreshLoading={rollupLoading}
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
