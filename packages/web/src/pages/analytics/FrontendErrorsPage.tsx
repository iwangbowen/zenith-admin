import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
  Upload,
  Collapse,
  Timeline,
  Empty,
  Space,
  Row,
  Col,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag/interface';
import { AlertCircle, AlertTriangle, Bell, Bug, CheckCircle2, ChevronDown, FileCode, MessageSquare, RefreshCcw, Trash2, Zap } from 'lucide-react';
import {
  BarChart,
  LineChart,
  PieChart,
  chartOptions,
  makeBarSpec,
  makeLineSpec,
  makePieSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import AppModal from '@/components/AppModal';
import type { ErrorAlertChannel, ErrorAlertCondition, ErrorAlertLog, ErrorAlertRule, ErrorBreadcrumb, ErrorEvent, ErrorGroup, ErrorLevel, ErrorStatus, FrontendErrorType, SourceMapItem, AnalyticsEnvironment } from '@zenith/shared/analytics';
import { ERROR_ALERT_CHANNELS, SOURCE_MAP_MAX_BYTES } from '@zenith/shared/analytics';
import { enumValueOf } from '@zenith/shared/core';
import { NOTIFY_CHANNEL_OPTIONS } from '@zenith/shared/messaging';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { formatDateTime } from '@/utils/date';
import {
  analyticsKeys,
  useBatchDeleteFrontendErrorGroups,
  useBatchUpdateFrontendErrorGroups,
  useDeleteFrontendAlert,
  useDeleteFrontendSourceMap,
  useFrontendAdminUsers,
  useFrontendAlertLogs,
  useFrontendAlerts,
  useFrontendErrorEvents,
  useFrontendErrorGroupDetail,
  useFrontendErrorGroups,
  useFrontendErrorOverview,
  useFrontendSourceMaps,
  useSaveFrontendAlert,
  useSubmitFrontendSourceMap,
  useTestFrontendAlert,
  useUpdateFrontendErrorGroup,
} from '@/hooks/queries/analytics';
import { SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { toUserOptions } from '@/hooks/queries/users';
import { formatBytes } from '@zenith/shared/core';

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

const ENVIRONMENT_OPTIONS = [
  { value: 'production', label: '生产' },
  { value: 'staging', label: '预发' },
  { value: 'development', label: '开发' },
];

interface IssueFilters {
  status?: ErrorStatus;
  errorType?: FrontendErrorType;
  level?: ErrorLevel;
  keyword: string;
  environment?: AnalyticsEnvironment;
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
  channels: ErrorAlertChannel[];
  webhookUrl: string;
  recipients: string[];
  enabled: boolean;
}

type TabKey = 'overview' | 'issues' | 'events' | 'sourcemaps' | 'alerts' | 'alertlogs';

const ERROR_TABS: readonly TabKey[] = ['overview', 'issues', 'events', 'sourcemaps', 'alerts', 'alertlogs'];

const defaultIssueFilters: IssueFilters = { status: undefined, errorType: undefined, level: undefined, keyword: '', environment: undefined };
const EMPTY_ADMIN_USERS: { id: number; nickname?: string | null; username: string }[] = [];

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

const defaultSourceMapUpload: SourceMapUploadForm = {
  release: (import.meta.env.VITE_APP_VERSION as string) || '',
  fileName: '',
  content: '',
};

/** 告警渠道取值收窄到契约枚举（列表实体与下拉控件的值都是宽 string） */
function toAlertChannels(values: readonly unknown[]): ErrorAlertChannel[] {
  return values.flatMap((value) => {
    const channel = enumValueOf(ERROR_ALERT_CHANNELS, value);
    return channel ? [channel] : [];
  });
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
        borderRadius: 'var(--semi-border-radius-medium)',
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

function SmallDistribution({ data }: { readonly data: { name: string; value: number }[] }) {
  const palette = useChartPalette();
  if (data.length === 0) return <Empty title="暂无分布数据" style={{ padding: 16 }} />;
  const spec = makeBarSpec({
    data,
    xField: 'name',
    series: [{ field: 'value', name: '次数', color: palette.primary }],
    palette,
    horizontal: true,
    categoryAxisWidth: 90,
    showLabel: true,
    tooltip: { value: (v) => `${v} 次` },
  });
  return <BarChart {...spec} options={chartOptions} height={Math.max(140, data.length * 34)} />;
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

const TIMELINE_SPARK_W = 96;
const TIMELINE_SPARK_H = 26;

/** 从事件 context 提取服务端链路 ID（SDK 在 http_error 上报时写入） */
function extractRequestId(context: unknown): string | null {
  if (!context || typeof context !== 'object') return null;
  const rid = (context as Record<string, unknown>).requestId;
  return typeof rid === 'string' && rid.length >= 8 ? rid : null;
}

/** 「查看服务端链路」跳转按钮（事件 context 携带 requestId 时展示） */
function TraceJumpButton({ context }: Readonly<{ context: unknown }>) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const requestId = extractRequestId(context);
  if (!requestId || !hasPermission('system:trace:view')) return null;
  return (
    <Button
      size="small"
      theme="borderless"
      type="primary"
      onClick={() => navigate(`/system/trace?traceId=${encodeURIComponent(requestId)}`)}
    >
      查看服务端链路
    </Button>
  );
}

/** 「查看会话回放」跳转按钮（事件携带 replayId 时展示） */
function ReplayJumpButton({ replayId }: Readonly<{ replayId: string | null }>) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  if (!replayId || !hasPermission('monitor:replay:list')) return null;
  return (
    <Button
      size="small"
      theme="borderless"
      type="primary"
      onClick={() => navigate(`/analytics/replays?replay=${encodeURIComponent(replayId)}`)}
    >
      查看会话回放
    </Button>
  );
}

/** 表格内嵌迷你趋势曲线（近 7 日发生次数） */
function TrendSparkline({ data }: Readonly<{ data?: number[] }>) {
  if (!data || data.length < 2 || data.every((v) => v === 0)) {
    return <Text type="tertiary" size="small">–</Text>;
  }
  const max = Math.max(...data, 1);
  const stepX = TIMELINE_SPARK_W / (data.length - 1);
  const points = data.map((v, i) => `${(i * stepX).toFixed(1)},${(TIMELINE_SPARK_H - 3 - (v / max) * (TIMELINE_SPARK_H - 6)).toFixed(1)}`).join(' ');
  const rising = data[data.length - 1] > data[0];
  const color = rising ? 'var(--semi-color-danger)' : 'var(--semi-color-success)';
  return (
    <svg width={TIMELINE_SPARK_W} height={TIMELINE_SPARK_H} aria-label="近 7 日趋势">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function FrontendErrorsPage() {
  const palette = useChartPalette();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useUrlTabState(ERROR_TABS, 'issues');

  const [overviewDays, setOverviewDays] = useState(30);

  const [issueFilters, setIssueFilters] = useState<IssueFilters>(defaultIssueFilters);
  const [submittedIssueFilters, setSubmittedIssueFilters] = useState<IssueFilters>(defaultIssueFilters);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const {
    page: groupPage,
    pageSize: groupPageSize,
    setPage: setGroupPage,
    buildPagination: buildGroupPagination,
  } = usePagination(20);

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailGroupId, setDetailGroupId] = useState<number | undefined>(undefined);
  const [showSymbolicated, setShowSymbolicated] = useState(true);
  const [groupForm, setGroupForm] = useState<GroupHandleForm>({ status: 'unresolved', level: 'error', assigneeId: null, note: '' });

  const [eventDetail, setEventDetail] = useState<ErrorEvent | null>(null);
  const {
    page: eventPage,
    pageSize: eventPageSize,
    buildPagination: buildEventPagination,
  } = usePagination(20);

  const [sourceRelease, setSourceRelease] = useState('');
  const [submittedSourceRelease, setSubmittedSourceRelease] = useState('');
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadForm, setUploadForm] = useState<SourceMapUploadForm>(defaultSourceMapUpload);
  const {
    page: sourceMapPage,
    pageSize: sourceMapPageSize,
    setPage: setSourceMapPage,
    buildPagination: buildSourceMapPagination,
  } = usePagination(20);

  const [alertModalVisible, setAlertModalVisible] = useState(false);
  const [editingAlert, setEditingAlert] = useState<ErrorAlertRule | null>(null);
  const [alertForm, setAlertForm] = useState<AlertFormState>(defaultAlertForm);
  const {
    page: alertPage,
    pageSize: alertPageSize,
    buildPagination: buildAlertPagination,
  } = usePagination(20);
  const {
    page: alertLogPage,
    pageSize: alertLogPageSize,
    buildPagination: buildAlertLogPagination,
  } = usePagination(20);
  const typeOptions = useMemo(() => labelOptions(ERROR_TYPE_CONFIG), []);
  const levelOptions = useMemo(() => labelOptions(LEVEL_CONFIG), []);
  const statusOptions = useMemo(() => labelOptions(STATUS_CONFIG), []);
  const overviewQuery = useFrontendErrorOverview(overviewDays, activeTab === 'overview');
  const overview = overviewQuery.data ?? null;
  const groupsQuery = useFrontendErrorGroups({
    page: groupPage,
    pageSize: groupPageSize,
    status: submittedIssueFilters.status || undefined,
    errorType: submittedIssueFilters.errorType || undefined,
    level: submittedIssueFilters.level || undefined,
    keyword: submittedIssueFilters.keyword.trim() || undefined,
    environment: submittedIssueFilters.environment || undefined,
  }, activeTab === 'issues');
  const detailQuery = useFrontendErrorGroupDetail(detailGroupId, detailVisible);
  const detail = detailQuery.data ?? null;
  const adminUsersQuery = useFrontendAdminUsers(detailVisible);
  const adminUsers = adminUsersQuery.data?.list ?? EMPTY_ADMIN_USERS;
  const eventsQuery = useFrontendErrorEvents({ page: eventPage, pageSize: eventPageSize }, activeTab === 'events');
  const sourceMapsQuery = useFrontendSourceMaps({ page: sourceMapPage, pageSize: sourceMapPageSize, release: submittedSourceRelease.trim() || undefined }, activeTab === 'sourcemaps');
  const alertsQuery = useFrontendAlerts({ page: alertPage, pageSize: alertPageSize }, activeTab === 'alerts');
  const alertLogsQuery = useFrontendAlertLogs({ page: alertLogPage, pageSize: alertLogPageSize }, activeTab === 'alertlogs');
  const updateGroupMutation = useUpdateFrontendErrorGroup();
  const batchStatusMutation = useBatchUpdateFrontendErrorGroups();
  const batchDeleteMutation = useBatchDeleteFrontendErrorGroups();
  const deleteSourceMapMutation = useDeleteFrontendSourceMap();
  const submitSourceMapMutation = useSubmitFrontendSourceMap();
  const saveAlertMutation = useSaveFrontendAlert();
  const deleteAlertMutation = useDeleteFrontendAlert();
  const testAlertMutation = useTestFrontendAlert();
  const adminOptions = useMemo(
    () => toUserOptions(adminUsers),
    [adminUsers],
  );

  useEffect(() => {
    if (detail) {
      setGroupForm({
        status: detail.group.status,
        level: detail.group.level,
        assigneeId: detail.group.assigneeId,
        note: detail.group.note ?? '',
      });
    }
  }, [detail]);

  const openGroupDetail = useCallback((groupId: number) => {
    setDetailVisible(true);
    setDetailGroupId(groupId);
    setShowSymbolicated(true);
  }, []);

  // ?issue= 深链：进入页面（或外部导航带参）时直达 Issue 详情，关闭详情时清除参数。
  // lastWrittenIssueRef 区分「自己写回 URL」与「外部变化」，issueSyncReadyRef 保证
  // 挂载首轮由 URL 主导（深链先落地），state 追平后才开始反向接管。
  const [issueSearchParams, setIssueSearchParams] = useSearchParams();
  const lastWrittenIssueRef = useRef<string | null>(null);
  const issueSyncReadyRef = useRef(false);

  useEffect(() => {
    const raw = issueSearchParams.get('issue');
    if (raw === lastWrittenIssueRef.current) return;
    lastWrittenIssueRef.current = raw;
    if (raw) {
      const id = Number(raw);
      if (Number.isInteger(id) && id > 0) openGroupDetail(id);
    } else if (issueSyncReadyRef.current) {
      setDetailVisible(false);
    }
  }, [issueSearchParams, openGroupDetail]);

  useEffect(() => {
    const val = detailVisible && detailGroupId ? String(detailGroupId) : null;
    if (!issueSyncReadyRef.current) {
      if (val === lastWrittenIssueRef.current) issueSyncReadyRef.current = true;
      return;
    }
    if (val === lastWrittenIssueRef.current) return;
    lastWrittenIssueRef.current = val;
    const next = new URLSearchParams(window.location.search);
    if (val) next.set('issue', val);
    else next.delete('issue');
    setIssueSearchParams(next, { replace: true });
  }, [detailVisible, detailGroupId, setIssueSearchParams]);

  const updateGroupStatus = useCallback(async (id: number, status: ErrorStatus) => {
    await updateGroupMutation.mutateAsync({ params: { id }, body: { status } });
    Toast.success('状态已更新');
    if (detail?.group.id === id) void queryClient.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.groupDetail(id) });
  }, [detail?.group.id, queryClient, updateGroupMutation]);

  const batchUpdateStatus = useCallback((status: ErrorStatus) => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认批量${STATUS_CONFIG[status]?.label ?? '更新'}？`,
      content: `即将处理 ${selectedRowKeys.length} 个错误 Issue。`,
      onOk: async () => {
        await batchStatusMutation.mutateAsync({ query: { status }, body: { ids: selectedRowKeys } });
        Toast.success('更新成功');
        setSelectedRowKeys([]);
      },
    });
  }, [batchStatusMutation, selectedRowKeys]);

  const batchDeleteGroups = useCallback(() => {
    if (selectedRowKeys.length === 0) return;
    confirmDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 个错误 Issue？`,
      content: '删除后无法恢复，请确认操作。',
      onOk: async () => {
        await batchDeleteMutation.mutateAsync({ body: { ids: selectedRowKeys } });
        Toast.success('删除成功');
        setSelectedRowKeys([]);
      },
    });
  }, [batchDeleteMutation, selectedRowKeys]);

  const deleteGroup = useCallback((record: ErrorGroup) => {
    confirmDelete({
      title: '确认删除该错误 Issue？',
      content: `即将删除「${record.message}」，删除后无法恢复。`,
      onOk: async () => {
        await batchDeleteMutation.mutateAsync({ body: { ids: [record.id] } });
        Toast.success('删除成功');
        setSelectedRowKeys((prev) => prev.filter((key) => key !== record.id));
        if (detailGroupId === record.id) {
          setDetailVisible(false);
          setDetailGroupId(undefined);
        }
      },
    });
  }, [batchDeleteMutation, detailGroupId]);

  const saveGroupHandle = useCallback(async () => {
    if (!detail) return;
    await updateGroupMutation.mutateAsync({
      params: { id: detail.group.id },
      body: {
        status: groupForm.status,
        level: groupForm.level,
        assigneeId: groupForm.assigneeId,
        note: groupForm.note.trim() || null,
      },
    });
    Toast.success('保存成功');
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.groupDetail(detail.group.id) });
  }, [detail, groupForm, queryClient, updateGroupMutation]);

  const deleteSourceMap = useCallback(async (id: number) => {
    await deleteSourceMapMutation.mutateAsync({ params: { id } });
    Toast.success('删除成功');
  }, [deleteSourceMapMutation]);

  const submitSourceMap = useCallback(async () => {
    if (!uploadForm.release.trim()) {
      Toast.warning('请输入 release');
      return;
    }
    if (!uploadForm.fileName.trim() || !uploadForm.content.trim()) {
      Toast.warning('请选择 Source Map 文件');
      return;
    }
    await submitSourceMapMutation.mutateAsync({
      body: {
        release: uploadForm.release.trim(),
        fileName: uploadForm.fileName.trim(),
        content: uploadForm.content,
      },
    });
    Toast.success('上传成功');
    setUploadVisible(false);
    setUploadForm(defaultSourceMapUpload);
    setSourceMapPage(1);
  }, [setSourceMapPage, submitSourceMapMutation, uploadForm]);

  const openAlertModal = useCallback((rule?: ErrorAlertRule) => {
    setEditingAlert(rule ?? null);
    setAlertForm(rule ? {
      name: rule.name,
      errorType: rule.errorType,
      level: rule.level,
      condition: rule.condition,
      thresholdCount: rule.thresholdCount,
      windowMinutes: rule.windowMinutes,
      channels: toAlertChannels(rule.channels),
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
    await saveAlertMutation.mutateAsync({ id: editingAlert?.id, values: body });
    Toast.success(editingAlert ? '更新成功' : '创建成功');
    setAlertModalVisible(false);
  }, [alertForm, editingAlert, saveAlertMutation]);

  const deleteAlert = useCallback(async (id: number) => {
    await deleteAlertMutation.mutateAsync({ params: { id } });
    Toast.success('删除成功');
  }, [deleteAlertMutation]);

  const toggleAlert = useCallback(async (rule: ErrorAlertRule, enabled: boolean) => {
    await saveAlertMutation.mutateAsync({ id: rule.id, values: { enabled } });
    Toast.success(enabled ? '已启用' : '已停用');
  }, [saveAlertMutation]);

  const handleIssueSearch = () => {
    setGroupPage(1);
    setSubmittedIssueFilters(issueFilters);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.groupsLists });
  };

  const handleIssueReset = () => {
    setIssueFilters(defaultIssueFilters);
    setSubmittedIssueFilters(defaultIssueFilters);
    setGroupPage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.groupsLists });
  };

  const handleSourceMapSearch = () => {
    setSourceMapPage(1);
    setSubmittedSourceRelease(sourceRelease);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.sourceMapsLists });
  };

  const openSourceMapUpload = () => {
    setUploadForm(defaultSourceMapUpload);
    setUploadVisible(true);
  };

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
      minWidth: 420,
      render: (_value, record) => (
        <Button theme="borderless" size="small" style={{ padding: 0, maxWidth: 380 }} onClick={() => void openGroupDetail(record.id)}>
          <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 360 }}>{record.message}</Text>
        </Button>
      ),
    },
    {
      title: 'Release',
      dataIndex: 'release',
      width: 140,
      render: (_value, record) => (
        record.release
          ? <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{record.release}</Text>
          : <Text type="tertiary">未关联</Text>
      ),
    },
    {
      title: '触发',
      align: 'right',
      dataIndex: 'count',
      width: 100,
      render: (_value, record) => <Tag color={record.count >= 10 ? 'red' : 'grey'}>{record.count}</Tag>,
    },
    {
      title: '7日趋势',
      dataIndex: 'trend',
      width: 120,
      render: (_value, record) => <TrendSparkline data={record.trend} />,
    },
    { title: '影响用户', dataIndex: 'affectedUsers', width: 110 },
    {
      title: '处理人',
      dataIndex: 'assigneeName',
      width: 120,
      render: (_value, record) => record.assigneeName || '–',
    },
    dateTimeColumn('首次', 'firstSeenAt'),
    dateTimeColumn('最近', 'lastSeenAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (_value, record) => <StatusTag status={record.status} />,
    },
    createOperationColumn<ErrorGroup>({
      width: 220,
      desktopInlineKeys: ['detail', 'resolve'],
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => { void openGroupDetail(record.id); },
        },
        {
          key: 'resolve',
          label: '标记已解决',
          hidden: record.status === 'resolved',
          onClick: () => { void updateGroupStatus(record.id, 'resolved'); },
        },
        {
          key: 'ignore',
          label: '忽略',
          onClick: () => { void updateGroupStatus(record.id, 'ignored'); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => deleteGroup(record),
        },
      ],
    }),
  ], [deleteGroup, openGroupDetail, updateGroupStatus]);

  const eventColumns = useMemo<ColumnProps<ErrorEvent>[]>(() => [
    { title: '类型', dataIndex: 'errorType', width: 140, render: (_value, record) => <TypeTag type={record.errorType} /> },
    { title: '级别', dataIndex: 'level', width: 100, render: (_value, record) => <LevelTag level={record.level} /> },
    {
      title: '信息',
      dataIndex: 'message',
      minWidth: 360,
      render: (value) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 330 }}>{String(value)}</Text>,
    },
    { title: '用户', dataIndex: 'username', width: 120, render: (_value, record) => record.username || '匿名' },
    {
      title: '浏览器/系统',
      dataIndex: 'browser',
      width: 260,
      render: (_value, record) => `${record.browser || '未知'} ${record.browserVersion || ''} / ${record.os || '未知'}`,
    },
    {
      title: '页面',
      dataIndex: 'pageUrl',
      width: 260,
      render: (_value, record) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 230 }}>{record.pageUrl || '–'}</Text>,
    },
    dateTimeColumn('时间', 'createdAt'),
    createOperationColumn<ErrorEvent>({
      width: 100,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => setEventDetail(record),
        },
      ],
    }),
  ], []);

  const sourceMapColumns = useMemo<ColumnProps<SourceMapItem>[]>(() => [
    { title: 'Release', dataIndex: 'release', width: 180 },
    { title: '文件名', dataIndex: 'fileName', minWidth: 260 },
    { title: '大小', dataIndex: 'size', width: 120, align: 'right', render: (value) => formatBytes(Number(value)) },
    dateTimeColumn('上传时间', 'createdAt'),
    createOperationColumn<SourceMapItem>({
      width: 100,
      desktopInlineKeys: ['delete'],
      actions: (record) => [
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定删除该 Source Map？',
              onOk: () => deleteSourceMap(record.id),
            });
          },
        },
      ],
    }),
  ], [deleteSourceMap]);

  const alertColumns = useMemo<ColumnProps<ErrorAlertRule>[]>(() => [
    { title: '名称', dataIndex: 'name', minWidth: 180 },
    { title: '条件', dataIndex: 'condition', width: 100, render: (_value, record) => CONDITION_CONFIG[record.condition] },
    { title: '阈值', dataIndex: 'thresholdCount', width: 90, align: 'right' },
    { title: '窗口', dataIndex: 'windowMinutes', width: 110, align: 'right', render: (value) => `${value} 分钟` },
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
    dateTimeColumn('最近触发', 'lastTriggeredAt'),
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 90,
      fixed: 'right',
      render: (_value, record) => <Switch size="small" checked={record.enabled} onChange={(checked) => void toggleAlert(record, checked)} />,
    },
    createOperationColumn<ErrorAlertRule>({
      width: 210,
      desktopInlineKeys: ['edit', 'test', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          onClick: () => openAlertModal(record),
        },
        {
          key: 'test',
          label: '测试',
          onClick: () => {
            void testAlertMutation.mutateAsync({ params: { id: record.id } }).then(() => Toast.success('测试消息已发送，请检查通知渠道'));
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定删除该告警规则？',
              onOk: () => deleteAlert(record.id),
            });
          },
        },
      ],
    }),
  ], [deleteAlert, openAlertModal, testAlertMutation, toggleAlert]);

  const alertLogColumns = useMemo<ColumnProps<ErrorAlertLog>[]>(() => [
    dateTimeColumn('触发时间', 'createdAt'),
    { title: '规则', dataIndex: 'ruleName', width: 180 },
    { title: '条件', dataIndex: 'condition', width: 100, render: (_value, record) => CONDITION_CONFIG[record.condition] },
    { title: '详情', dataIndex: 'detail' },
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
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: (_value, record) => (
        <Tag color={record.source === 'realtime' ? 'orange' : 'blue'}>{record.source === 'realtime' ? '实时触发' : '定时评估'}</Tag>
      ),
    },
  ], []);

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

  const overviewTrendSpec = useMemo(() => makeLineSpec({
    data: overview?.trend ?? [],
    xField: 'date',
    series: [
      { field: 'occurrences', name: '发生次数', color: '#f93920' },
      { field: 'groups', name: '错误种类', color: '#6a5af9' },
    ],
    palette,
  }), [overview?.trend, palette]);

  const overviewTypePieSpec = useMemo(() => makePieSpec({
    data: overviewTypeData,
    categoryField: 'name',
    valueField: 'value',
    donut: false,
    colors: overviewTypeData.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]),
    palette,
  }), [overviewTypeData, palette]);

  const overviewLevelBarSpec = useMemo(() => makeBarSpec({
    data: overviewLevelData,
    xField: 'name',
    series: [
      { field: 'occurrences', name: '发生次数', color: '#f93920' },
      { field: 'groups', name: '错误种类', color: '#6a5af9' },
    ],
    palette,
  }), [overviewLevelData, palette]);

  const detailTrendSpec = useMemo(() => makeLineSpec({
    data: detail?.trend ?? [],
    xField: 'date',
    series: [{ field: 'count', name: '次数', color: '#f93920' }],
    palette,
  }), [detail?.trend, palette]);

  const renderOverviewDaysFilter = () => (
    <Select
      value={overviewDays}
      style={{ width: 140 }}
      optionList={[7, 30, 90].map((days) => ({ label: `近 ${days} 天`, value: days }))}
      onChange={(value) => setOverviewDays(Number(value))}
    />
  );
  const renderOverviewRefreshButton = () => (
    <Button type="primary" icon={<RefreshCcw size={14} />} loading={overviewQuery.isFetching} onClick={() => void overviewQuery.refetch()}>刷新</Button>
  );
  const renderMobileIssueBatchActions = () => selectedRowKeys.length > 0 ? (
    <>
      <Button icon={<CheckCircle2 size={14} />} onClick={() => batchUpdateStatus('resolved')}>
        标记已解决 ({selectedRowKeys.length})
      </Button>
      <Button icon={<CheckCircle2 size={14} />} onClick={() => batchUpdateStatus('ignored')}>
        批量忽略
      </Button>
      <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={batchDeleteGroups}>
        批量删除
      </Button>
    </>
  ) : null;
  const renderSourceReleaseSearch = () => (
    <Input
      prefix={<FileCode size={14} />}
      placeholder="Release"
      showClear
      value={sourceRelease}
      style={{ width: 220 }}
      onChange={setSourceRelease}
      onEnterPress={handleSourceMapSearch}
    />
  );
  const renderSourceMapSearchButton = () => <SearchButton onClick={handleSourceMapSearch} />;
  const renderSourceMapUploadButton = () => <Button type="primary" icon={<FileCode size={14} />} onClick={openSourceMapUpload}>上传</Button>;
  const renderAlertCreateButton = () => <Button type="primary" icon={<Bell size={14} />} onClick={() => openAlertModal()}>新增</Button>;

  return (
    <div className="page-container page-tabs-page zx-flat-panels">
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as TabKey)} lazyRender>
        <TabPane tab="错误 Issue" itemKey="issues">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="错误信息关键词" value={issueFilters.keyword} onChange={(value) => setIssueFilters((prev) => ({ ...prev, keyword: value }))} onSearch={handleIssueSearch} />}
            filters={(
              <>
                <StatusSelect
                  items={statusOptions}
                  value={issueFilters.status}
                  onChange={(value) => setIssueFilters((prev) => ({ ...prev, status: value as ErrorStatus | undefined }))}
                />
                <FilterSelect
                  placeholder="全部类型"
                  items={typeOptions}
                  value={issueFilters.errorType}
                  onChange={(value) => setIssueFilters((prev) => ({ ...prev, errorType: value as FrontendErrorType | undefined }))}
                  width={150}
                />
                <FilterSelect
                  placeholder="全部级别"
                  items={levelOptions}
                  value={issueFilters.level}
                  onChange={(value) => setIssueFilters((prev) => ({ ...prev, level: value as ErrorLevel | undefined }))}
                />
                <FilterSelect
                  placeholder="全部环境"
                  items={ENVIRONMENT_OPTIONS}
                  value={issueFilters.environment}
                  onChange={(value) => setIssueFilters((prev) => ({ ...prev, environment: value as AnalyticsEnvironment | undefined }))}
                />
              </>
            )}
            onSearch={handleIssueSearch}
            onReset={handleIssueReset}
            actions={(
              selectedRowKeys.length > 0 ? (
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
              ) : null
            )}
            mobileActions={(renderMobileIssueBatchActions())}
            filterTitle="错误 Issue 筛选"
            actionTitle="Issue 操作"
          />

          <ConfigurableTable<ErrorGroup>
            columns={issueColumns}
            {...listTableProps(groupsQuery, {
              pagination: buildGroupPagination,
              rowSelection: {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as number[]),
              },
              empty: '暂无错误 Issue',
            })}
          />
        </TabPane>

        <TabPane tab="概览" itemKey="overview">
          <SearchToolbar
            primary={(
              <>
                {renderOverviewDaysFilter()}
                {renderOverviewRefreshButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderOverviewDaysFilter()}
                {renderOverviewRefreshButton()}
              </>
            )}
          />

          {overview ? (
            <Space vertical align="start" style={{ width: '100%' }}>
              <StatGrid minItemWidth={180} gap={16} style={{ width: '100%' }}>
                <StatCard accent="#f93920" icon={<Bug size={22} />} title="错误种类" value={overview.totalGroups.toLocaleString()} />
                <StatCard accent="#ff8800" icon={<AlertTriangle size={22} />} title="未解决" value={overview.unresolved.toLocaleString()} />
                <StatCard accent="#6a5af9" icon={<Zap size={22} />} title="总发生次数" value={overview.totalOccurrences.toLocaleString()} />
                <StatCard accent="#14c9c9" icon={<MessageSquare size={22} />} title="影响用户" value={overview.affectedUsers.toLocaleString()} />
                <StatCard accent="#00b42a" icon={<CheckCircle2 size={22} />} title="今日新增" value={overview.newToday.toLocaleString()} />
              </StatGrid>

              <Card title="趋势分析" style={{ width: '100%' }}>
                <div style={{ height: 320 }}>
                  <LineChart {...overviewTrendSpec} options={chartOptions} height={320} />
                </div>
              </Card>

              <div className="chart-grid" style={{ width: '100%' }}>
                <Card title="错误类型分布">
                  <div style={{ height: 260 }}>
                    {overviewTypeData.length > 0 ? (
                      <PieChart {...overviewTypePieSpec} options={chartOptions} height={260} />
                    ) : <Empty title="暂无数据" />}
                  </div>
                </Card>

                <Card title="错误级别分布">
                  <div style={{ height: 260 }}>
                    {overviewLevelData.length > 0 ? (
                      <BarChart {...overviewLevelBarSpec} options={chartOptions} height={260} />
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
                        {renderEllipsis(issue.message)}
                        <Tag color={issue.count >= 10 ? 'red' : 'grey'}>{issue.count} 次</Tag>
                        <StatusTag status={issue.status} />
                      </div>
                    ))}
                  </Space>
                ) : <Empty title="暂无高频错误" />}
              </Card>
            </Space>
          ) : <Empty title={overviewQuery.isFetching ? '正在加载概览...' : '暂无概览数据'} />}
        </TabPane>

        <TabPane tab="错误事件" itemKey="events">
          <ConfigurableTable<ErrorEvent>
            columns={eventColumns}
            style={{ width: '100%' }}
            {...listTableProps(eventsQuery, { pagination: buildEventPagination, empty: '暂无错误事件' })}
          />
        </TabPane>

        <TabPane tab="Source Map" itemKey="sourcemaps">
          <SearchToolbar
            primary={(
              <>
                {renderSourceReleaseSearch()}
                {renderSourceMapSearchButton()}
                {renderSourceMapUploadButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderSourceReleaseSearch()}
                {renderSourceMapSearchButton()}
                {renderSourceMapUploadButton()}
              </>
            )}
          />

          <ConfigurableTable<SourceMapItem>
            columns={sourceMapColumns}
            {...listTableProps(sourceMapsQuery, { pagination: buildSourceMapPagination, empty: '暂无 Source Map' })}
          />
        </TabPane>

        <TabPane tab="告警规则" itemKey="alerts">
          <SearchToolbar
            primary={renderAlertCreateButton()}
            mobilePrimary={renderAlertCreateButton()}
          />

          <ConfigurableTable<ErrorAlertRule>
            columns={alertColumns}
            {...listTableProps(alertsQuery, { pagination: buildAlertPagination, empty: '暂无告警规则' })}
          />
        </TabPane>

        <TabPane tab="告警历史" itemKey="alertlogs">
          <ConfigurableTable<ErrorAlertLog>
            columns={alertLogColumns}
            {...listTableProps(alertLogsQuery, { pagination: buildAlertLogPagination, empty: '暂无告警触发记录' })}
          />
        </TabPane>
      </Tabs>

      <SideSheet
        title={detail ? `Issue #${detail.group.id}` : '错误详情'}
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        width={720}
        className="zx-flat-panels"
      >
        {detail && !detailQuery.isFetching ? (
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
                <Space spacing={8}>
                  <Text size="small" type="tertiary">{showSymbolicated ? '源码还原' : '原始堆栈'}</Text>
                  <Switch size="small" checked={showSymbolicated} onChange={setShowSymbolicated} />
                </Space>
              ) : null}
            >
              <TextBlock>{activeStack}</TextBlock>
            </Card>

            <Card title="发生趋势" style={{ width: '100%' }}>
              <div style={{ height: 180 }}>
                <LineChart {...detailTrendSpec} options={chartOptions} height={180} />
              </div>
            </Card>

            <div className="auto-grid" style={{ ['--auto-grid-min' as string]: '260px', ['--auto-grid-cols' as string]: 2, width: '100%' }}>
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
                <Button type="primary" loading={updateGroupMutation.isPending} onClick={() => void saveGroupHandle()}>保存</Button>
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
                      <Title heading={6} style={{ margin: '12px 0 8px' }}>Context <TraceJumpButton context={event.context} /><ReplayJumpButton replayId={event.replayId} /></Title>
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

      <AppModal
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
              <Title heading={6}>Context <TraceJumpButton context={eventDetail.context} /><ReplayJumpButton replayId={eventDetail.replayId} /></Title>
              <TextBlock>{safeJson(eventDetail.context)}</TextBlock>
            </Space>
          </div>
        )}
      </AppModal>

      <AppModal
        title="上传 Source Map"
        visible={uploadVisible}
        onCancel={() => setUploadVisible(false)}
        onOk={() => void submitSourceMap()}
        confirmLoading={submitSourceMapMutation.isPending}
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
                if (rawFile.size > SOURCE_MAP_MAX_BYTES) {
                  Toast.error('Source Map 不能超过 20MB');
                  return false;
                }
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
      </AppModal>

      <AppModal
        title={editingAlert ? '编辑告警规则' : '新增告警规则'}
        visible={alertModalVisible}
        onCancel={() => setAlertModalVisible(false)}
        onOk={() => void saveAlert()}
        confirmLoading={saveAlertMutation.isPending}
        width={660}
        closeOnEsc
      >
        <Form labelPosition="left" labelWidth={80}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Slot label="名称">
                <Input value={alertForm.name} placeholder="请输入规则名称" maxLength={128} onChange={(value) => setAlertForm((prev) => ({ ...prev, name: value }))} />
              </Form.Slot>
            </Col>
            <Col span={12}>
              <Form.Slot label="启用">
                <Switch checked={alertForm.enabled} onChange={(checked) => setAlertForm((prev) => ({ ...prev, enabled: checked }))} />
              </Form.Slot>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
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
            </Col>
            <Col span={12}>
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
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Slot label="条件">
                <Select
                  value={alertForm.condition}
                  style={{ width: '100%' }}
                  optionList={Object.entries(CONDITION_CONFIG).map(([value, label]) => ({ value, label }))}
                  onChange={(value) => setAlertForm((prev) => ({ ...prev, condition: value as ErrorAlertCondition }))}
                />
              </Form.Slot>
            </Col>
            {/* new_error 只判断「窗口内是否出现新分组」，不读阈值；一直摆着会让人以为调它有用 */}
            {alertForm.condition !== 'new_error' && (
              <Col span={12}>
                <Form.Slot label="阈值">
                  <InputNumber min={1} max={100000} value={alertForm.thresholdCount} onChange={(value) => setAlertForm((prev) => ({ ...prev, thresholdCount: Number(value) || 1 }))} style={{ width: '100%' }} />
                </Form.Slot>
              </Col>
            )}
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Slot label="窗口">
                <InputNumber min={1} max={10080} value={alertForm.windowMinutes} suffix="分钟" onChange={(value) => setAlertForm((prev) => ({ ...prev, windowMinutes: Number(value) || 1 }))} style={{ width: '100%' }} />
              </Form.Slot>
            </Col>
            <Col span={12}>
              <Form.Slot label="渠道">
                <Select
                  multiple
                  maxTagCount={2}
                  value={alertForm.channels}
                  style={{ width: '100%' }}
                  optionList={[...NOTIFY_CHANNEL_OPTIONS]}
                  onChange={(value) => setAlertForm((prev) => ({ ...prev, channels: toAlertChannels(toStringArray(value)) }))}
                />
              </Form.Slot>
            </Col>
          </Row>
          {/*
            Webhook 与收件人按所选渠道显示：服务端在启用时强校验
            （含 webhook 渠道 → URL 必填；含邮件/站内信 → 收件人必填，见 validateAlertDelivery）。
            无条件铺开这两项，既看不出哪个是必填，填了不相关的那个也不会生效。
            切换渠道不清空已填值——重新勾回来时还在，比丢掉用户输入更可取。
          */}
          {alertForm.channels.includes('webhook') && (
            <Form.Slot label="Webhook">
              <Input value={alertForm.webhookUrl} placeholder="https://example.com/webhook" onChange={(value) => setAlertForm((prev) => ({ ...prev, webhookUrl: value }))} />
            </Form.Slot>
          )}
          {(alertForm.channels.includes('email') || alertForm.channels.includes('inapp')) && (
            <Form.Slot label="收件人">
              <TagInput
                value={alertForm.recipients}
                placeholder="输入邮箱后回车"
                onChange={(value) => setAlertForm((prev) => ({ ...prev, recipients: value }))}
              />
            </Form.Slot>
          )}
        </Form>
      </AppModal>
    </div>
  );
}
