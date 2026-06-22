import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Tabs,
  TabPane,
  Card,
  Typography,
  Tag,
  Button,
  Input,
  TextArea,
  Select,
  Modal,
  Form,
  Toast,
  SideSheet,
  Descriptions,
  Switch,
  InputNumber,
  TagInput,
  SplitButtonGroup,
  Dropdown,
  Popconfirm,
  Upload,
  Collapse,
  Timeline,
  Empty,
  Space,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag/interface';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Bug,
  CheckCircle2,
  ChevronDown,
  FileCode,
  MessageSquare,
  RefreshCcw,
  RotateCcw,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ErrorAlertCondition,
  ErrorAlertRule,
  ErrorBreadcrumb,
  ErrorEvent,
  ErrorGroup,
  ErrorLevel,
  ErrorOverview,
  ErrorStatus,
  FrontendErrorType,
  PaginatedResponse,
  SourceMapItem,
} from '@zenith/shared';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTime } from '@/utils/date';
import { request } from '@/utils/request';

const { Text, Title, Paragraph } = Typography;

const ERROR_TYPE_CONFIG: Record<string, { label: string; color: TagColor }> = {
  js_error: { label: 'JS 错误', color: 'red' },
  promise_rejection: { label: 'Promise 异常', color: 'orange' },
  resource_error: { label: '资源错误', color: 'amber' },
  console_error: { label: 'Console 错误', color: 'grey' },
  http_error: { label: '接口错误', color: 'violet' },
  white_screen: { label: '白屏', color: 'pink' },
  crash: { label: '崩溃', color: 'red' },
};

const LEVEL_CONFIG: Record<string, { label: string; color: TagColor }> = {
  fatal: { label: '致命', color: 'red' },
  error: { label: '错误', color: 'orange' },
  warning: { label: '警告', color: 'amber' },
  info: { label: '信息', color: 'blue' },
};

const STATUS_CONFIG: Record<string, { label: string; color: TagColor }> = {
  unresolved: { label: '未解决', color: 'red' },
  resolved: { label: '已解决', color: 'green' },
  ignored: { label: '已忽略', color: 'grey' },
  muted: { label: '已静音', color: 'blue' },
};

const CONDITION_CONFIG: Record<ErrorAlertCondition, string> = {
  new_error: '新错误',
  threshold: '阈值',
  spike: '激增',
};

const CHANNEL_CONFIG: Record<string, { label: string; color: TagColor }> = {
  email: { label: '邮件', color: 'blue' },
  webhook: { label: 'Webhook', color: 'violet' },
  inapp: { label: '站内', color: 'green' },
};

const CHART_COLORS = ['#f93920', '#ff8800', '#f5b70a', '#6a5af9', '#00b42a', '#14c9c9', '#8a38f5'];

interface ErrorGroupDetail {
  group: ErrorGroup;
  symbolicatedStack: string | null;
  trend: { date: string; count: number }[];
  browsers: { name: string; value: number }[];
  os: { name: string; value: number }[];
  recentEvents: ErrorEvent[];
}

interface AdminUserOption {
  id: number;
  nickname?: string | null;
  username: string;
}

interface IssueFilters {
  status: ErrorStatus | '';
  errorType: FrontendErrorType | '';
  level: ErrorLevel | '';
  keyword: string;
}

interface GroupHandleForm {
  status: ErrorStatus;
  level: ErrorLevel;
  assigneeId: number | null;
  note: string;
}

interface SourceMapUploadForm {
  release: string;
  fileName: string;
  content: string;
}

interface AlertFormState {
  name: string;
  errorType: FrontendErrorType | null;
  level: ErrorLevel | null;
  condition: ErrorAlertCondition;
  thresholdCount: number;
  windowMinutes: number;
  channels: string[];
  webhookUrl: string;
  recipients: string[];
  enabled: boolean;
}

type TabKey = 'overview' | 'issues' | 'events' | 'sourcemaps' | 'alerts';

const defaultIssueFilters: IssueFilters = { status: '', errorType: '', level: '', keyword: '' };

const defaultAlertForm: AlertFormState = {
  name: '',
  errorType: null,
  level: null,
  condition: 'threshold',
  thresholdCount: 10,
  windowMinutes: 60,
  channels: ['inapp'],
  webhookUrl: '',
  recipients: [],
  enabled: true,
};

const defaultSourceMapUpload: SourceMapUploadForm = { release: '', fileName: '', content: '' };

function buildQuery(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

function labelOptions(config: Record<string, { label: string }>) {
  return Object.entries(config).map(([value, item]) => ({ label: item.label, value }));
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return '暂无';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function TextBlock({ children, maxHeight = 280 }: { readonly children: ReactNode; readonly maxHeight?: number }) {
  return (
    <pre
      style={{
        background: 'var(--semi-color-fill-0)',
        border: '1px solid var(--semi-color-border)',
        borderRadius: 8,
        color: 'var(--semi-color-text-0)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.6,
        margin: 0,
        maxHeight,
        overflow: 'auto',
        padding: 12,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </pre>
  );
}

function TypeTag({ type }: { readonly type: FrontendErrorType }) {
  const config = ERROR_TYPE_CONFIG[type] ?? { label: type, color: 'grey' };
  return <Tag color={config.color}>{config.label}</Tag>;
}

function LevelTag({ level }: { readonly level: ErrorLevel }) {
  const config = LEVEL_CONFIG[level] ?? { label: level, color: 'grey' };
  return <Tag color={config.color}>{config.label}</Tag>;
}

function StatusTag({ status }: { readonly status: ErrorStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, color: 'grey' };
  return <Tag color={config.color}>{config.label}</Tag>;
}

function TypeIcon({ type }: { readonly type: FrontendErrorType }) {
  const common = { size: 15, style: { verticalAlign: 'middle' } };
  if (type === 'white_screen') return <AlertTriangle {...common} />;
  if (type === 'http_error') return <Zap {...common} />;
  if (type === 'resource_error') return <FileCode {...common} />;
  if (type === 'console_error') return <MessageSquare {...common} />;
  if (type === 'crash') return <AlertCircle {...common} />;
  return <Bug {...common} />;
}

function KpiCard({
  color,
  icon,
  label,
  value,
}: {
  readonly color: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: number;
}) {
  return (
    <Card bodyStyle={{ padding: 18 }} style={{ borderRadius: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <Text type="tertiary">{label}</Text>
          <div style={{ color, fontSize: 26, fontWeight: 700, lineHeight: '36px', marginTop: 6 }}>{value.toLocaleString()}</div>
        </div>
        <div
          style={{
            alignItems: 'center',
            background: `${color}1a`,
            borderRadius: 12,
            color,
            display: 'flex',
            height: 42,
            justifyContent: 'center',
            width: 42,
          }}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}

function SmallDistribution({ data }: { readonly data: { name: string; value: number }[] }) {
  if (data.length === 0) return <Empty title="暂无分布数据" style={{ padding: 16 }} />;
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <Space vertical align="start" style={{ width: '100%' }}>
      {data.map((item) => (
        <div key={item.name} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text size="small">{item.name}</Text>
            <Text size="small" type="tertiary">{item.value}</Text>
          </div>
          <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
            <div style={{ background: 'var(--semi-color-primary)', borderRadius: 999, height: 8, width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </Space>
  );
}

function BreadcrumbTimeline({ breadcrumbs }: { readonly breadcrumbs: ErrorBreadcrumb[] | null }) {
  if (!breadcrumbs || breadcrumbs.length === 0) return <Empty title="暂无用户行为轨迹" style={{ padding: 16 }} />;
  return (
    <Timeline style={{ paddingLeft: 4 }}>
      {breadcrumbs.map((item, index) => (
        <Timeline.Item key={`${item.timestamp}-${index}`} time={formatDateTime(item.timestamp)} type={item.level === 'error' || item.level === 'fatal' ? 'error' : 'default'}>
          <Space spacing={6} wrap>
            <Tag color="blue" size="small">{item.type}</Tag>
            <Text>{item.message}</Text>
          </Space>
          {item.data && <TextBlock maxHeight={140}>{safeJson(item.data)}</TextBlock>}
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

export default function FrontendErrorsPage() {

  const [activeTab, setActiveTab] = useState<TabKey>('issues');

  const [overviewDays, setOverviewDays] = useState(30);
  const [overview, setOverview] = useState<ErrorOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const [issueFilters, setIssueFilters] = useState<IssueFilters>(defaultIssueFilters);
  const [groups, setGroups] = useState<PaginatedResponse<ErrorGroup> | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const {
    page: groupPage,
    pageSize: groupPageSize,
    setPage: setGroupPage,
    buildPagination: buildGroupPagination,
  } = usePagination(20);

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ErrorGroupDetail | null>(null);
  const [showSymbolicated, setShowSymbolicated] = useState(true);
  const [groupForm, setGroupForm] = useState<GroupHandleForm>({ status: 'unresolved', level: 'error', assigneeId: null, note: '' });
  const [groupSaving, setGroupSaving] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserOption[]>([]);
  const [adminUsersLoaded, setAdminUsersLoaded] = useState(false);

  const [events, setEvents] = useState<PaginatedResponse<ErrorEvent> | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventDetail, setEventDetail] = useState<ErrorEvent | null>(null);
  const {
    page: eventPage,
    pageSize: eventPageSize,
    buildPagination: buildEventPagination,
  } = usePagination(20);

  const [sourceRelease, setSourceRelease] = useState('');
  const [sourceMaps, setSourceMaps] = useState<PaginatedResponse<SourceMapItem> | null>(null);
  const [sourceMapsLoading, setSourceMapsLoading] = useState(false);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadForm, setUploadForm] = useState<SourceMapUploadForm>(defaultSourceMapUpload);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const {
    page: sourceMapPage,
    pageSize: sourceMapPageSize,
    setPage: setSourceMapPage,
    buildPagination: buildSourceMapPagination,
  } = usePagination(20);

  const [alerts, setAlerts] = useState<PaginatedResponse<ErrorAlertRule> | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertModalVisible, setAlertModalVisible] = useState(false);
  const [editingAlert, setEditingAlert] = useState<ErrorAlertRule | null>(null);
  const [alertForm, setAlertForm] = useState<AlertFormState>(defaultAlertForm);
  const [alertSubmitting, setAlertSubmitting] = useState(false);
  const {
    page: alertPage,
    pageSize: alertPageSize,
    buildPagination: buildAlertPagination,
  } = usePagination(20);

  // 镜像筛选条件与分页到 ref，使列表拉取函数保持稳定：
  // 避免输入框每次按键都重建 fetch 触发请求，也避免翻页时 effect 与分页回调重复拉取。
  const issueFiltersRef = useRef(issueFilters);
  issueFiltersRef.current = issueFilters;
  const groupPageRef = useRef(groupPage);
  groupPageRef.current = groupPage;
  const groupPageSizeRef = useRef(groupPageSize);
  groupPageSizeRef.current = groupPageSize;
  const eventPageRef = useRef(eventPage);
  eventPageRef.current = eventPage;
  const eventPageSizeRef = useRef(eventPageSize);
  eventPageSizeRef.current = eventPageSize;
  const sourceReleaseRef = useRef(sourceRelease);
  sourceReleaseRef.current = sourceRelease;
  const sourceMapPageRef = useRef(sourceMapPage);
  sourceMapPageRef.current = sourceMapPage;
  const sourceMapPageSizeRef = useRef(sourceMapPageSize);
  sourceMapPageSizeRef.current = sourceMapPageSize;
  const alertPageRef = useRef(alertPage);
  alertPageRef.current = alertPage;
  const alertPageSizeRef = useRef(alertPageSize);
  alertPageSizeRef.current = alertPageSize;

  const typeOptions = useMemo(() => labelOptions(ERROR_TYPE_CONFIG), []);
  const levelOptions = useMemo(() => labelOptions(LEVEL_CONFIG), []);
  const statusOptions = useMemo(() => labelOptions(STATUS_CONFIG), []);
  const adminOptions = useMemo(
    () => adminUsers.map((item) => ({ label: item.nickname || item.username, value: item.id })),
    [adminUsers],
  );

  const loadOverview = useCallback(async (days = overviewDays) => {
    setOverviewLoading(true);
    try {
      const res = await request.get<ErrorOverview>(`/api/frontend-errors/overview?days=${days}`);
      if (res.code === 0) setOverview(res.data);
    } finally {
      setOverviewLoading(false);
    }
  }, [overviewDays]);

  const fetchGroups = useCallback(async (page = groupPageRef.current, pageSize = groupPageSizeRef.current) => {
    setGroupsLoading(true);
    try {
      const f = issueFiltersRef.current;
      const query = buildQuery({
        page,
        pageSize,
        status: f.status,
        errorType: f.errorType,
        level: f.level,
        keyword: f.keyword.trim(),
      });
      const res = await request.get<PaginatedResponse<ErrorGroup>>(`/api/frontend-errors/groups${query}`);
      if (res.code === 0) setGroups(res.data);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  const loadAdminUsers = useCallback(async () => {
    if (adminUsersLoaded) return;
    const res = await request.get<PaginatedResponse<AdminUserOption>>('/api/users?page=1&pageSize=100');
    if (res.code === 0) {
      setAdminUsers(res.data.list);
      setAdminUsersLoaded(true);
    }
  }, [adminUsersLoaded]);

  const openGroupDetail = useCallback(async (groupId: number) => {
    setDetailVisible(true);
    setDetailLoading(true);
    setShowSymbolicated(true);
    void loadAdminUsers();
    try {
      const res = await request.get<ErrorGroupDetail>(`/api/frontend-errors/groups/${groupId}`);
      if (res.code === 0) {
        setDetail(res.data);
        setGroupForm({
          status: res.data.group.status,
          level: res.data.group.level,
          assigneeId: res.data.group.assigneeId,
          note: res.data.group.note ?? '',
        });
      }
    } finally {
      setDetailLoading(false);
    }
  }, [loadAdminUsers]);

  const updateGroupStatus = useCallback(async (id: number, status: ErrorStatus) => {
    const res = await request.put<ErrorGroup>(`/api/frontend-errors/groups/${id}`, { status });
    if (res.code === 0) {
      Toast.success('状态已更新');
      void fetchGroups();
      if (detail?.group.id === id) void openGroupDetail(id);
    }
  }, [detail?.group.id, fetchGroups, openGroupDetail]);

  const batchUpdateStatus = useCallback((status: ErrorStatus) => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认批量${STATUS_CONFIG[status]?.label ?? '更新'}？`,
      content: `即将处理 ${selectedRowKeys.length} 个错误 Issue。`,
      onOk: async () => {
        const res = await request.post<null>(`/api/frontend-errors/groups/batch-status?status=${status}`, { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success(res.message || '更新成功');
          setSelectedRowKeys([]);
          void fetchGroups();
        }
      },
    });
  }, [fetchGroups, selectedRowKeys]);

  const batchDeleteGroups = useCallback(() => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个错误 Issue？`,
      content: '删除后无法恢复，请确认操作。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>('/api/frontend-errors/groups/batch', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success(res.message || '删除成功');
          setSelectedRowKeys([]);
          void fetchGroups();
        }
      },
    });
  }, [fetchGroups, selectedRowKeys]);

  const saveGroupHandle = useCallback(async () => {
    if (!detail) return;
    setGroupSaving(true);
    try {
      const res = await request.put<ErrorGroup>(`/api/frontend-errors/groups/${detail.group.id}`, {
        status: groupForm.status,
        level: groupForm.level,
        assigneeId: groupForm.assigneeId,
        note: groupForm.note.trim() || null,
      });
      if (res.code === 0) {
        Toast.success('保存成功');
        setDetail((prev) => (prev ? { ...prev, group: res.data } : prev));
        void fetchGroups();
      }
    } finally {
      setGroupSaving(false);
    }
  }, [detail, fetchGroups, groupForm]);

  const fetchEvents = useCallback(async (page = eventPageRef.current, pageSize = eventPageSizeRef.current) => {
    setEventsLoading(true);
    try {
      const res = await request.get<PaginatedResponse<ErrorEvent>>(`/api/frontend-errors/events?page=${page}&pageSize=${pageSize}`);
      if (res.code === 0) setEvents(res.data);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const fetchSourceMaps = useCallback(async (page = sourceMapPageRef.current, pageSize = sourceMapPageSizeRef.current) => {
    setSourceMapsLoading(true);
    try {
      const query = buildQuery({ page, pageSize, release: sourceReleaseRef.current.trim() });
      const res = await request.get<PaginatedResponse<SourceMapItem>>(`/api/frontend-errors/source-maps${query}`);
      if (res.code === 0) setSourceMaps(res.data);
    } finally {
      setSourceMapsLoading(false);
    }
  }, []);

  const deleteSourceMap = useCallback(async (id: number) => {
    const res = await request.delete<null>(`/api/frontend-errors/source-maps/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchSourceMaps();
    }
  }, [fetchSourceMaps]);

  const submitSourceMap = useCallback(async () => {
    if (!uploadForm.release.trim()) {
      Toast.warning('请输入 release');
      return;
    }
    if (!uploadForm.fileName.trim() || !uploadForm.content.trim()) {
      Toast.warning('请选择 Source Map 文件');
      return;
    }
    setUploadSubmitting(true);
    try {
      const res = await request.post<SourceMapItem>('/api/frontend-errors/source-maps', {
        release: uploadForm.release.trim(),
        fileName: uploadForm.fileName.trim(),
        content: uploadForm.content,
      });
      if (res.code === 0) {
        Toast.success('上传成功');
        setUploadVisible(false);
        setUploadForm(defaultSourceMapUpload);
        void fetchSourceMaps(1, sourceMapPageSize);
      }
    } finally {
      setUploadSubmitting(false);
    }
  }, [fetchSourceMaps, sourceMapPageSize, uploadForm]);

  const fetchAlerts = useCallback(async (page = alertPageRef.current, pageSize = alertPageSizeRef.current) => {
    setAlertsLoading(true);
    try {
      const res = await request.get<PaginatedResponse<ErrorAlertRule>>(`/api/frontend-errors/alerts?page=${page}&pageSize=${pageSize}`);
      if (res.code === 0) setAlerts(res.data);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  const openAlertModal = useCallback((rule?: ErrorAlertRule) => {
    setEditingAlert(rule ?? null);
    setAlertForm(rule ? {
      name: rule.name,
      errorType: rule.errorType,
      level: rule.level,
      condition: rule.condition,
      thresholdCount: rule.thresholdCount,
      windowMinutes: rule.windowMinutes,
      channels: rule.channels,
      webhookUrl: rule.webhookUrl ?? '',
      recipients: rule.recipients,
      enabled: rule.enabled,
    } : defaultAlertForm);
    setAlertModalVisible(true);
  }, []);

  const saveAlert = useCallback(async () => {
    if (!alertForm.name.trim()) {
      Toast.warning('请输入规则名称');
      return;
    }
    setAlertSubmitting(true);
    try {
      const body = {
        name: alertForm.name.trim(),
        errorType: alertForm.errorType,
        level: alertForm.level,
        condition: alertForm.condition,
        thresholdCount: alertForm.thresholdCount,
        windowMinutes: alertForm.windowMinutes,
        channels: alertForm.channels,
        webhookUrl: alertForm.webhookUrl.trim() || null,
        recipients: alertForm.recipients,
        enabled: alertForm.enabled,
      };
      const res = editingAlert
        ? await request.put<ErrorAlertRule>(`/api/frontend-errors/alerts/${editingAlert.id}`, body)
        : await request.post<ErrorAlertRule>('/api/frontend-errors/alerts', body);
      if (res.code === 0) {
        Toast.success(editingAlert ? '更新成功' : '创建成功');
        setAlertModalVisible(false);
        void fetchAlerts();
      }
    } finally {
      setAlertSubmitting(false);
    }
  }, [alertForm, editingAlert, fetchAlerts]);

  const deleteAlert = useCallback(async (id: number) => {
    const res = await request.delete<null>(`/api/frontend-errors/alerts/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchAlerts();
    }
  }, [fetchAlerts]);

  const toggleAlert = useCallback(async (rule: ErrorAlertRule, enabled: boolean) => {
    const res = await request.put<ErrorAlertRule>(`/api/frontend-errors/alerts/${rule.id}`, { enabled });
    if (res.code === 0) {
      Toast.success(enabled ? '已启用' : '已停用');
      void fetchAlerts();
    }
  }, [fetchAlerts]);

  useEffect(() => {
    if (activeTab === 'overview') void loadOverview();
  }, [activeTab, loadOverview]);

  useEffect(() => {
    if (activeTab === 'issues') void fetchGroups();
  }, [activeTab, fetchGroups]);

  useEffect(() => {
    if (activeTab === 'events') void fetchEvents();
  }, [activeTab, fetchEvents]);

  useEffect(() => {
    if (activeTab === 'sourcemaps') void fetchSourceMaps();
  }, [activeTab, fetchSourceMaps]);

  useEffect(() => {
    if (activeTab === 'alerts') void fetchAlerts();
  }, [activeTab, fetchAlerts]);

  const rawStack = detail?.recentEvents[0]?.stack ?? '暂无堆栈';
  const activeStack = showSymbolicated && detail?.symbolicatedStack ? detail.symbolicatedStack : rawStack;

  const issueColumns = useMemo<ColumnProps<ErrorGroup>[]>(() => [
    {
      title: '类型',
      dataIndex: 'errorType',
      width: 150,
      render: (_value, record) => (
        <Space spacing={6}>
          <TypeIcon type={record.errorType} />
          <TypeTag type={record.errorType} />
        </Space>
      ),
    },
    {
      title: '级别',
      dataIndex: 'level',
      width: 100,
      render: (_value, record) => <LevelTag level={record.level} />,
    },
    {
      title: '错误信息',
      dataIndex: 'message',
      width: 420,
      render: (_value, record) => (
        <div>
          <Button theme="borderless" size="small" style={{ padding: 0, maxWidth: 380 }} onClick={() => void openGroupDetail(record.id)}>
            <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 360 }}>{record.message}</Text>
          </Button>
          <div>
            <Text type="tertiary" size="small">{record.release ? `release: ${record.release}` : '未关联 release'}</Text>
          </div>
        </div>
      ),
    },
    {
      title: '触发',
      dataIndex: 'count',
      width: 100,
      render: (_value, record) => <Tag color={record.count >= 10 ? 'red' : 'grey'}>{record.count}</Tag>,
    },
    { title: '影响用户', dataIndex: 'affectedUsers', width: 110 },
    {
      title: '处理人',
      dataIndex: 'assigneeName',
      width: 120,
      render: (_value, record) => record.assigneeName || '–',
    },
    {
      title: '首次',
      dataIndex: 'firstSeenAt',
      width: 180,
      render: (value) => formatDateTime(String(value)),
    },
    {
      title: '最近',
      dataIndex: 'lastSeenAt',
      width: 180,
      render: (value) => formatDateTime(String(value)),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (_value, record) => <StatusTag status={record.status} />,
    },
    {
      title: '操作',
      key: 'operation',
      width: 240,
      fixed: 'right',
      render: (_value, record) => (
        <Space spacing={2}>
          <Button theme="borderless" size="small" onClick={() => void openGroupDetail(record.id)}>详情</Button>
          {record.status !== 'resolved' && (
            <Button theme="borderless" size="small" onClick={() => void updateGroupStatus(record.id, 'resolved')}>标记已解决</Button>
          )}
          <Button theme="borderless" type="danger" size="small" onClick={() => void updateGroupStatus(record.id, 'ignored')}>忽略</Button>
        </Space>
      ),
    },
  ], [openGroupDetail, updateGroupStatus]);

  const eventColumns = useMemo<ColumnProps<ErrorEvent>[]>(() => [
    { title: '类型', dataIndex: 'errorType', width: 140, render: (_value, record) => <TypeTag type={record.errorType} /> },
    { title: '级别', dataIndex: 'level', width: 100, render: (_value, record) => <LevelTag level={record.level} /> },
    {
      title: '信息',
      dataIndex: 'message',
      width: 360,
      render: (value) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 330 }}>{String(value)}</Text>,
    },
    { title: '用户', dataIndex: 'username', width: 120, render: (_value, record) => record.username || '匿名' },
    {
      title: '浏览器/系统',
      dataIndex: 'browser',
      width: 180,
      render: (_value, record) => `${record.browser || '未知'} ${record.browserVersion || ''} / ${record.os || '未知'}`,
    },
    {
      title: '页面',
      dataIndex: 'pageUrl',
      width: 260,
      render: (_value, record) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 230 }}>{record.pageUrl || '–'}</Text>,
    },
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (value) => formatDateTime(String(value)) },
    {
      title: '操作',
      key: 'operation',
      width: 90,
      fixed: 'right',
      render: (_value, record) => (
        <Button theme="borderless" size="small" onClick={() => setEventDetail(record)}>详情</Button>
      ),
    },
  ], []);

  const sourceMapColumns = useMemo<ColumnProps<SourceMapItem>[]>(() => [
    { title: 'Release', dataIndex: 'release', width: 180 },
    { title: '文件名', dataIndex: 'fileName', width: 260 },
    { title: '大小', dataIndex: 'size', width: 120, render: (value) => formatBytes(Number(value)) },
    { title: '上传时间', dataIndex: 'createdAt', width: 180, render: (value) => formatDateTime(String(value)) },
    {
      title: '操作',
      key: 'operation',
      width: 100,
      fixed: 'right',
      render: (_value, record) => (
        <Popconfirm title="确定删除该 Source Map？" onConfirm={() => void deleteSourceMap(record.id)}>
          <Button theme="borderless" type="danger" size="small">删除</Button>
        </Popconfirm>
      ),
    },
  ], [deleteSourceMap]);

  const alertColumns = useMemo<ColumnProps<ErrorAlertRule>[]>(() => [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '条件', dataIndex: 'condition', width: 100, render: (_value, record) => CONDITION_CONFIG[record.condition] },
    { title: '阈值', dataIndex: 'thresholdCount', width: 90 },
    { title: '窗口', dataIndex: 'windowMinutes', width: 110, render: (value) => `${value} 分钟` },
    { title: '类型', dataIndex: 'errorType', width: 130, render: (_value, record) => record.errorType ? <TypeTag type={record.errorType} /> : <Tag color="grey">全部</Tag> },
    { title: '级别', dataIndex: 'level', width: 110, render: (_value, record) => record.level ? <LevelTag level={record.level} /> : <Tag color="grey">全部</Tag> },
    {
      title: '渠道',
      dataIndex: 'channels',
      width: 180,
      render: (_value, record) => (
        <Space spacing={4} wrap>
          {record.channels.length > 0 ? record.channels.map((channel) => (
            <Tag key={channel} color={CHANNEL_CONFIG[channel]?.color ?? 'grey'}>{CHANNEL_CONFIG[channel]?.label ?? channel}</Tag>
          )) : <Text type="tertiary">未配置</Text>}
        </Space>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 90,
      render: (_value, record) => <Switch size="small" checked={record.enabled} onChange={(checked) => void toggleAlert(record, checked)} />,
    },
    { title: '最近触发', dataIndex: 'lastTriggeredAt', width: 180, render: (_value, record) => record.lastTriggeredAt ? formatDateTime(record.lastTriggeredAt) : '–' },
    {
      title: '操作',
      key: 'operation',
      width: 130,
      fixed: 'right',
      render: (_value, record) => (
        <Space spacing={2}>
          <Button theme="borderless" size="small" onClick={() => openAlertModal(record)}>编辑</Button>
          <Popconfirm title="确定删除该告警规则？" onConfirm={() => void deleteAlert(record.id)}>
            <Button theme="borderless" type="danger" size="small">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [deleteAlert, openAlertModal, toggleAlert]);

  const overviewTypeData = (overview?.byType ?? []).map((item) => ({
    name: ERROR_TYPE_CONFIG[item.errorType]?.label ?? item.errorType,
    value: item.occurrences,
    groups: item.groups,
  }));

  const overviewLevelData = (overview?.byLevel ?? []).map((item) => ({
    name: LEVEL_CONFIG[item.level]?.label ?? item.level,
    occurrences: item.occurrences,
    groups: item.groups,
  }));

  return (
    <div className="page-container">
      <Tabs type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as TabKey)} lazyRender>
        <TabPane tab="概览" itemKey="overview">
          <SearchToolbar>
            <Select
              value={overviewDays}
              style={{ width: 140 }}
              optionList={[7, 30, 90].map((days) => ({ label: `近 ${days} 天`, value: days }))}
              onChange={(value) => setOverviewDays(Number(value))}
            />
            <Button type="primary" icon={<RefreshCcw size={14} />} loading={overviewLoading} onClick={() => void loadOverview()}>刷新</Button>
          </SearchToolbar>

          {overview ? (
            <Space vertical align="start" style={{ width: '100%' }}>
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', width: '100%' }}>
                <KpiCard color="#f93920" icon={<Bug size={22} />} label="错误种类" value={overview.totalGroups} />
                <KpiCard color="#ff8800" icon={<AlertTriangle size={22} />} label="未解决" value={overview.unresolved} />
                <KpiCard color="#6a5af9" icon={<Zap size={22} />} label="总发生次数" value={overview.totalOccurrences} />
                <KpiCard color="#14c9c9" icon={<MessageSquare size={22} />} label="影响用户" value={overview.affectedUsers} />
                <KpiCard color="#00b42a" icon={<CheckCircle2 size={22} />} label="今日新增" value={overview.newToday} />
              </div>

              <Card title="趋势分析" style={{ width: '100%' }}>
                <div style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={overview.trend}>
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" name="发生次数" dataKey="occurrences" stroke="#f93920" strokeWidth={2} dot={false} />
                      <Line type="monotone" name="错误种类" dataKey="groups" stroke="#6a5af9" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', width: '100%' }}>
                <Card title="错误类型分布">
                  <div style={{ height: 260 }}>
                    {overviewTypeData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={overviewTypeData} dataKey="value" nameKey="name" outerRadius={85} label>
                            {overviewTypeData.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <Empty title="暂无数据" />}
                  </div>
                </Card>

                <Card title="错误级别分布">
                  <div style={{ height: 260 }}>
                    {overviewLevelData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={overviewLevelData}>
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar name="发生次数" dataKey="occurrences" fill="#f93920" radius={[6, 6, 0, 0]} />
                          <Bar name="错误种类" dataKey="groups" fill="#6a5af9" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <Empty title="暂无数据" />}
                  </div>
                </Card>
              </div>

              <Card title="Top Issues" style={{ width: '100%' }}>
                {overview.topIssues.length > 0 ? (
                  <Space vertical align="start" style={{ width: '100%' }}>
                    {overview.topIssues.map((issue) => (
                      <div
                        key={issue.id}
                        role="button"
                        tabIndex={0}
                        style={{
                          alignItems: 'center',
                          borderBottom: '1px solid var(--semi-color-border)',
                          cursor: 'pointer',
                          display: 'grid',
                          gap: 12,
                          gridTemplateColumns: '1fr auto auto',
                          padding: '10px 0',
                          width: '100%',
                        }}
                        onClick={() => void openGroupDetail(issue.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void openGroupDetail(issue.id);
                        }}
                      >
                        <Text ellipsis={{ showTooltip: true }}>{issue.message}</Text>
                        <Tag color={issue.count >= 10 ? 'red' : 'grey'}>{issue.count} 次</Tag>
                        <StatusTag status={issue.status} />
                      </div>
                    ))}
                  </Space>
                ) : <Empty title="暂无高频错误" />}
              </Card>
            </Space>
          ) : <Empty title={overviewLoading ? '正在加载概览...' : '暂无概览数据'} />}
        </TabPane>

        <TabPane tab="错误 Issue" itemKey="issues">
          <SearchToolbar>
            <Select
              showClear
              placeholder="状态"
              value={issueFilters.status || undefined}
              style={{ width: 130 }}
              optionList={statusOptions}
              onChange={(value) => setIssueFilters((prev) => ({ ...prev, status: (value as ErrorStatus | undefined) ?? '' }))}
            />
            <Select
              showClear
              placeholder="类型"
              value={issueFilters.errorType || undefined}
              style={{ width: 150 }}
              optionList={typeOptions}
              onChange={(value) => setIssueFilters((prev) => ({ ...prev, errorType: (value as FrontendErrorType | undefined) ?? '' }))}
            />
            <Select
              showClear
              placeholder="级别"
              value={issueFilters.level || undefined}
              style={{ width: 130 }}
              optionList={levelOptions}
              onChange={(value) => setIssueFilters((prev) => ({ ...prev, level: (value as ErrorLevel | undefined) ?? '' }))}
            />
            <Input
              prefix={<Search size={14} />}
              placeholder="错误信息关键词"
              showClear
              value={issueFilters.keyword}
              style={{ width: 220 }}
              onChange={(value) => setIssueFilters((prev) => ({ ...prev, keyword: value }))}
              onEnterPress={() => {
                setGroupPage(1);
                void fetchGroups(1, groupPageSize);
              }}
            />
            <Button
              type="primary"
              icon={<Search size={14} />}
              onClick={() => {
                setGroupPage(1);
                void fetchGroups(1, groupPageSize);
              }}
            >
              查询
            </Button>
            <Button
              type="tertiary"
              icon={<RotateCcw size={14} />}
              onClick={() => {
                setIssueFilters(defaultIssueFilters);
                issueFiltersRef.current = defaultIssueFilters;
                setGroupPage(1);
                void fetchGroups(1, groupPageSize);
              }}
            >
              重置
            </Button>
            {selectedRowKeys.length > 0 && (
              <>
                <SplitButtonGroup>
                  <Button type="primary" icon={<CheckCircle2 size={14} />} onClick={() => batchUpdateStatus('resolved')}>
                    批量标记已解决 ({selectedRowKeys.length})
                  </Button>
                  <Dropdown
                    trigger="click"
                    render={(
                      <Dropdown.Menu>
                        <Dropdown.Item onClick={() => batchUpdateStatus('ignored')}>批量忽略</Dropdown.Item>
                      </Dropdown.Menu>
                    )}
                  >
                    <Button type="primary" icon={<ChevronDown size={14} />} />
                  </Dropdown>
                </SplitButtonGroup>
                <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={batchDeleteGroups}>
                  批量删除
                </Button>
              </>
            )}
          </SearchToolbar>

          <ConfigurableTable<ErrorGroup>
            bordered
            rowKey="id"
            columns={issueColumns}
            dataSource={groups?.list ?? []}
            loading={groupsLoading}
            onRefresh={() => void fetchGroups()}
            refreshLoading={groupsLoading}
            pagination={buildGroupPagination(groups?.total ?? 0, fetchGroups)}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys as number[]),
            }}
            scroll={{ x: 1600 }}
            empty="暂无错误 Issue"
          />
        </TabPane>

        <TabPane tab="错误事件" itemKey="events">
          <ConfigurableTable<ErrorEvent>
            bordered
            rowKey="id"
            columns={eventColumns}
            dataSource={events?.list ?? []}
            loading={eventsLoading}
            onRefresh={() => void fetchEvents()}
            refreshLoading={eventsLoading}
            pagination={buildEventPagination(events?.total ?? 0, fetchEvents)}
            style={{ width: '100%' }}
            scroll={{ x: '100%' }}
            empty="暂无错误事件"
          />
        </TabPane>

        <TabPane tab="Source Map" itemKey="sourcemaps">
          <SearchToolbar>
            <Input
              prefix={<FileCode size={14} />}
              placeholder="Release"
              showClear
              value={sourceRelease}
              style={{ width: 220 }}
              onChange={setSourceRelease}
              onEnterPress={() => {
                setSourceMapPage(1);
                void fetchSourceMaps(1, sourceMapPageSize);
              }}
            />
            <Button
              type="primary"
              icon={<Search size={14} />}
              onClick={() => {
                setSourceMapPage(1);
                void fetchSourceMaps(1, sourceMapPageSize);
              }}
            >
              查询
            </Button>
            <Button
              type="primary"
              icon={<FileCode size={14} />}
              onClick={() => {
                setUploadForm(defaultSourceMapUpload);
                setUploadVisible(true);
              }}
            >
              上传
            </Button>
          </SearchToolbar>

          <ConfigurableTable<SourceMapItem>
            bordered
            rowKey="id"
            columns={sourceMapColumns}
            dataSource={sourceMaps?.list ?? []}
            loading={sourceMapsLoading}
            onRefresh={() => void fetchSourceMaps()}
            refreshLoading={sourceMapsLoading}
            pagination={buildSourceMapPagination(sourceMaps?.total ?? 0, fetchSourceMaps)}
            scroll={{ x: 900 }}
            empty="暂无 Source Map"
          />
        </TabPane>

        <TabPane tab="告警规则" itemKey="alerts">
          <SearchToolbar>
            <Button type="primary" icon={<Bell size={14} />} onClick={() => openAlertModal()}>新增</Button>
          </SearchToolbar>

          <ConfigurableTable<ErrorAlertRule>
            bordered
            rowKey="id"
            columns={alertColumns}
            dataSource={alerts?.list ?? []}
            loading={alertsLoading}
            onRefresh={() => void fetchAlerts()}
            refreshLoading={alertsLoading}
            pagination={buildAlertPagination(alerts?.total ?? 0, fetchAlerts)}
            scroll={{ x: 1320 }}
            empty="暂无告警规则"
          />
        </TabPane>
      </Tabs>

      <SideSheet
        title={detail ? `Issue #${detail.group.id}` : '错误详情'}
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        width={720}
      >
        {detail && !detailLoading ? (
          <Space vertical align="start" style={{ width: '100%' }}>
            <Space wrap>
              <TypeTag type={detail.group.errorType} />
              <LevelTag level={detail.group.level} />
              <StatusTag status={detail.group.status} />
              <Tag color="red">触发 {detail.group.count}</Tag>
              <Tag color="blue">影响用户 {detail.group.affectedUsers}</Tag>
            </Space>

            <Card title="错误信息" style={{ width: '100%' }}>
              <TextBlock maxHeight={160}>{detail.group.message}</TextBlock>
            </Card>

            <Card
              title="堆栈"
              style={{ width: '100%' }}
              headerExtraContent={detail.symbolicatedStack ? (
                <Switch
                  size="small"
                  checked={showSymbolicated}
                  checkedText="源码还原"
                  uncheckedText="原始堆栈"
                  onChange={setShowSymbolicated}
                />
              ) : null}
            >
              <TextBlock>{activeStack}</TextBlock>
            </Card>

            <Card title="发生趋势" style={{ width: '100%' }}>
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={detail.trend}>
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" name="次数" dataKey="count" stroke="#f93920" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', width: '100%' }}>
              <Card title="浏览器分布"><SmallDistribution data={detail.browsers} /></Card>
              <Card title="系统分布"><SmallDistribution data={detail.os} /></Card>
            </div>

            <Card title="处理" style={{ width: '100%' }}>
              <Form labelPosition="left" labelWidth={90}>
                <Form.Slot label="状态">
                  <Select
                    value={groupForm.status}
                    optionList={statusOptions}
                    style={{ width: '100%' }}
                    onChange={(value) => setGroupForm((prev) => ({ ...prev, status: value as ErrorStatus }))}
                  />
                </Form.Slot>
                <Form.Slot label="级别">
                  <Select
                    value={groupForm.level}
                    optionList={levelOptions}
                    style={{ width: '100%' }}
                    onChange={(value) => setGroupForm((prev) => ({ ...prev, level: value as ErrorLevel }))}
                  />
                </Form.Slot>
                <Form.Slot label="指派">
                  <Select
                    showClear
                    filter
                    placeholder="未指派"
                    value={groupForm.assigneeId ?? undefined}
                    optionList={adminOptions}
                    style={{ width: '100%' }}
                    onChange={(value) => setGroupForm((prev) => ({ ...prev, assigneeId: toNumberOrNull(value) }))}
                  />
                </Form.Slot>
                <Form.Slot label="备注">
                  <TextArea
                    autosize={{ minRows: 3, maxRows: 6 }}
                    maxLength={2000}
                    value={groupForm.note}
                    onChange={(value) => setGroupForm((prev) => ({ ...prev, note: value }))}
                  />
                </Form.Slot>
                <Button type="primary" loading={groupSaving} onClick={() => void saveGroupHandle()}>保存</Button>
              </Form>
            </Card>

            <Card title="最近事件" style={{ width: '100%' }}>
              {detail.recentEvents.length > 0 ? (
                <Collapse accordion>
                  {detail.recentEvents.map((event) => (
                    <Collapse.Panel
                      key={event.id}
                      itemKey={String(event.id)}
                      header={`${formatDateTime(event.createdAt)} · ${event.browser || '未知浏览器'} · ${event.pageUrl || '未知页面'}`}
                    >
                      <Descriptions
                        align="plain"
                        data={[
                          { key: '时间', value: formatDateTime(event.createdAt) },
                          { key: '浏览器', value: `${event.browser || '未知'} ${event.browserVersion || ''}` },
                          { key: '系统/设备', value: `${event.os || '未知'} / ${event.deviceType || 'unknown'}` },
                          { key: '页面', value: event.pageUrl || '–' },
                          { key: '会话', value: event.sessionId || '–' },
                        ]}
                      />
                      <Title heading={6} style={{ margin: '12px 0 8px' }}>Context</Title>
                      <TextBlock maxHeight={180}>{safeJson(event.context)}</TextBlock>
                      <Title heading={6} style={{ margin: '12px 0 8px' }}>Breadcrumbs</Title>
                      <BreadcrumbTimeline breadcrumbs={event.breadcrumbs} />
                    </Collapse.Panel>
                  ))}
                </Collapse>
              ) : <Empty title="暂无最近事件" />}
            </Card>
          </Space>
        ) : <Empty title="正在加载错误详情..." />}
      </SideSheet>

      <Modal
        title={eventDetail ? `事件 #${eventDetail.id}` : '事件详情'}
        visible={!!eventDetail}
        onCancel={() => setEventDetail(null)}
        footer={null}
        width={760}
        closeOnEsc
      >
        {eventDetail && (
          <div style={{ height: '70vh', overflowY: 'auto', paddingRight: 4 }}>
            <Space vertical align="start" style={{ width: '100%' }}>
              <Descriptions
                align="plain"
                data={[
                  { key: '类型', value: ERROR_TYPE_CONFIG[eventDetail.errorType]?.label ?? eventDetail.errorType },
                  { key: '级别', value: LEVEL_CONFIG[eventDetail.level]?.label ?? eventDetail.level },
                  { key: '用户', value: eventDetail.username || '匿名' },
                  { key: '浏览器/系统', value: `${eventDetail.browser || '未知'} ${eventDetail.browserVersion || ''} / ${eventDetail.os || '未知'}` },
                  { key: '页面', value: eventDetail.pageUrl || '–' },
                  { key: '时间', value: formatDateTime(eventDetail.createdAt) },
                ]}
              />
              <Title heading={6}>错误信息</Title>
              <Paragraph copyable>{eventDetail.message}</Paragraph>
              <Title heading={6}>Stack</Title>
              <TextBlock>{eventDetail.stack || '暂无堆栈'}</TextBlock>
              <Title heading={6}>Breadcrumbs</Title>
              <BreadcrumbTimeline breadcrumbs={eventDetail.breadcrumbs} />
              <Title heading={6}>Context</Title>
              <TextBlock>{safeJson(eventDetail.context)}</TextBlock>
            </Space>
          </div>
        )}
      </Modal>

      <Modal
        title="上传 Source Map"
        visible={uploadVisible}
        onCancel={() => setUploadVisible(false)}
        onOk={() => void submitSourceMap()}
        confirmLoading={uploadSubmitting}
        width={640}
        closeOnEsc
      >
        <Form labelPosition="left" labelWidth={100}>
          <Form.Slot label="Release">
            <Input value={uploadForm.release} placeholder="例如 v1.2.3" onChange={(value) => setUploadForm((prev) => ({ ...prev, release: value }))} />
          </Form.Slot>
          <Form.Slot label="文件名">
            <Input value={uploadForm.fileName} placeholder="例如 index-abc.js" onChange={(value) => setUploadForm((prev) => ({ ...prev, fileName: value }))} />
          </Form.Slot>
          <Form.Slot label="文件">
            <Upload
              accept=".map,.json"
              limit={1}
              action=""
              beforeUpload={({ file }: { file: { name?: string; fileInstance?: File } }) => {
                const rawFile = file.fileInstance;
                if (!rawFile) return false;
                const inferredName = rawFile.name.replace(/\.map$/i, '');
                setUploadForm((prev) => ({ ...prev, fileName: prev.fileName || inferredName }));
                void rawFile.text().then((content) => {
                  setUploadForm((prev) => ({ ...prev, content }));
                });
                return false;
              }}
              onRemove={() => setUploadForm((prev) => ({ ...prev, content: '' }))}
            >
              <Button icon={<FileCode size={14} />}>选择 .map / .json 文件</Button>
            </Upload>
            {uploadForm.content && <Text type="success" size="small">已读取 {formatBytes(uploadForm.content.length)} 内容</Text>}
          </Form.Slot>
        </Form>
      </Modal>

      <Modal
        title={editingAlert ? '编辑告警规则' : '新增告警规则'}
        visible={alertModalVisible}
        onCancel={() => setAlertModalVisible(false)}
        onOk={() => void saveAlert()}
        confirmLoading={alertSubmitting}
        width={680}
        closeOnEsc
      >
        <Form labelPosition="left" labelWidth={110}>
          <Form.Slot label="名称">
            <Input value={alertForm.name} placeholder="请输入规则名称" maxLength={128} onChange={(value) => setAlertForm((prev) => ({ ...prev, name: value }))} />
          </Form.Slot>
          <Form.Slot label="类型">
            <Select
              showClear
              placeholder="全部"
              value={alertForm.errorType ?? undefined}
              optionList={typeOptions}
              style={{ width: '100%' }}
              onChange={(value) => setAlertForm((prev) => ({ ...prev, errorType: (value as FrontendErrorType | undefined) ?? null }))}
            />
          </Form.Slot>
          <Form.Slot label="级别">
            <Select
              showClear
              placeholder="全部"
              value={alertForm.level ?? undefined}
              optionList={levelOptions}
              style={{ width: '100%' }}
              onChange={(value) => setAlertForm((prev) => ({ ...prev, level: (value as ErrorLevel | undefined) ?? null }))}
            />
          </Form.Slot>
          <Form.Slot label="条件">
            <Select
              value={alertForm.condition}
              style={{ width: '100%' }}
              optionList={Object.entries(CONDITION_CONFIG).map(([value, label]) => ({ value, label }))}
              onChange={(value) => setAlertForm((prev) => ({ ...prev, condition: value as ErrorAlertCondition }))}
            />
          </Form.Slot>
          <Form.Slot label="阈值">
            <InputNumber min={1} max={100000} value={alertForm.thresholdCount} onChange={(value) => setAlertForm((prev) => ({ ...prev, thresholdCount: Number(value) || 1 }))} style={{ width: '100%' }} />
          </Form.Slot>
          <Form.Slot label="窗口">
            <InputNumber min={1} max={10080} value={alertForm.windowMinutes} suffix="分钟" onChange={(value) => setAlertForm((prev) => ({ ...prev, windowMinutes: Number(value) || 1 }))} style={{ width: '100%' }} />
          </Form.Slot>
          <Form.Slot label="渠道">
            <Select
              multiple
              value={alertForm.channels}
              style={{ width: '100%' }}
              optionList={[
                { label: '邮件', value: 'email' },
                { label: 'Webhook', value: 'webhook' },
                { label: '站内', value: 'inapp' },
              ]}
              onChange={(value) => setAlertForm((prev) => ({ ...prev, channels: toStringArray(value) }))}
            />
          </Form.Slot>
          <Form.Slot label="Webhook">
            <Input value={alertForm.webhookUrl} placeholder="https://example.com/webhook" onChange={(value) => setAlertForm((prev) => ({ ...prev, webhookUrl: value }))} />
          </Form.Slot>
          <Form.Slot label="收件人">
            <TagInput
              value={alertForm.recipients}
              placeholder="输入邮箱后回车"
              onChange={(value) => setAlertForm((prev) => ({ ...prev, recipients: value }))}
            />
          </Form.Slot>
          <Form.Slot label="启用">
            <Switch checked={alertForm.enabled} onChange={(checked) => setAlertForm((prev) => ({ ...prev, enabled: checked }))} />
          </Form.Slot>
        </Form>
      </Modal>
    </div>
  );
}
