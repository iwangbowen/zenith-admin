import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Divider,
  Form,
  Modal,
  Radio,
  RadioGroup,
  Select,
  SideSheet,
  Space,
  Switch,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { AlertTriangle, Ban, Eye, Gauge, ShieldOff, Zap } from 'lucide-react';
import {
  RATE_LIMIT_ALGORITHM_LABELS,
  RATE_LIMIT_ALGORITHM_OPTIONS,
  RATE_LIMIT_BAN_DURATION_OPTIONS,
  RATE_LIMIT_KEY_TYPE_LABELS,
  RATE_LIMIT_KEY_TYPE_OPTIONS,
  RATE_LIMIT_MODE_LABELS,
  RATE_LIMIT_MODE_OPTIONS,
  RATE_LIMIT_MOUNT_SOURCE_LABELS,
  RATE_LIMIT_WINDOW_UNIT_OPTIONS,
  type CreateRateLimitRuleInput,
  type RateLimitAlgorithm,
  type RateLimitMode,
  type RateLimitMountSource,
  type RateLimitRule,
  type RateLimitWindowUnit,
} from '@zenith/shared/platform';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useEditModal } from '@/hooks/useEditModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { CreateButton, RefreshButton } from '@/components/toolbar-controls';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { LineChart, chartOptions, makeLineSpec, useChartPalette } from '@/components/charts';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { copyableNoColumn, dateTimeColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { DataBar } from '@/components/data-viz/DataBar';
import {
  useBanRateLimitKey,
  useDeleteRateLimitRule,
  useRateLimitApiPaths,
  useRateLimitBans,
  useRateLimitRules,
  useRateLimitStats,
  useResetRateLimitStats,
  useSaveRateLimitRule,
  useUnbanRateLimitKey,
  useUnblockRateLimitKey,
} from '@/hooks/queries/rate-limit';

const { Text } = Typography;

const WINDOW_UNIT_MS: Record<RateLimitWindowUnit, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
};

function formatWindow(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时`;
}

/** windowMs → 最大可整除单位，编辑表单回显用 */
function splitWindow(ms: number): { windowValue: number; windowUnit: RateLimitWindowUnit } {
  if (ms % WINDOW_UNIT_MS.hour === 0) return { windowValue: ms / WINDOW_UNIT_MS.hour, windowUnit: 'hour' };
  if (ms % WINDOW_UNIT_MS.minute === 0) return { windowValue: ms / WINDOW_UNIT_MS.minute, windowUnit: 'minute' };
  return { windowValue: Math.max(1, Math.round(ms / 1000)), windowUnit: 'second' };
}

const MOUNT_SOURCE_TAG_COLOR: Record<RateLimitMountSource, 'blue' | 'cyan' | 'violet' | 'red'> = {
  code: 'blue',
  path: 'cyan',
  code_path: 'violet',
  none: 'red',
};

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

interface RuleFormValues {
  name?: string;
  description: string | null;
  windowValue: number;
  windowUnit: RateLimitWindowUnit;
  limit: number;
  keyType: RateLimitRule['keyType'];
  enabled: boolean;
  mode: RateLimitMode;
  algorithm: RateLimitAlgorithm;
  allowlist: string[];
  priority: number;
  alertThreshold: number | null;
  blockedMessage: string | null;
  pathPatterns: string[];
}

interface BlockRow {
  _rowId: string;
  rule: string;
  at: string;
  key: string;
  path: string;
  monitored: boolean;
  banned: boolean;
}

export default function RateLimitPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:rate-limit:manage');
  const navigate = useNavigate();
  const palette = useChartPalette();
  const [activeTab, setActiveTab] = useUrlTabState(['rules', 'blocks', 'bans'] as const, 'rules');

  const rulesQuery = useRateLimitRules();
  const statsQuery = useRateLimitStats();
  const bansQuery = useRateLimitBans();
  const apiPathsQuery = useRateLimitApiPaths();
  const saveMutation = useSaveRateLimitRule();
  const deleteMutation = useDeleteRateLimitRule();
  const unblockMutation = useUnblockRateLimitKey();
  const resetStatsMutation = useResetRateLimitStats();
  const banMutation = useBanRateLimitKey();
  const unbanMutation = useUnbanRateLimitKey();

  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);
  const statItems = useMemo(() => statsQuery.data?.items ?? [], [statsQuery.data]);
  const statsByName = useMemo(() => new Map(statItems.map((s) => [s.name, s])), [statItems]);
  const apiPaths = apiPathsQuery.data ?? [];

  const [detailRuleName, setDetailRuleName] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  /** 详情抽屉趋势范围：24h 小时级 / 30d 天级 */
  const [trendRange, setTrendRange] = useState<'hourly' | 'daily'>('hourly');
  /** 封禁弹窗目标（来自拦截记录行）；null = 关闭 */
  const [banTarget, setBanTarget] = useState<{ rule: string; key: string } | null>(null);
  const [banDuration, setBanDuration] = useState<number>(3600);

  // 拦截记录 Tab 的客户端筛选（数据已随统计全量加载，无需回源）
  const [blockRuleFilter, setBlockRuleFilter] = useState<string | undefined>();
  const [blockTypeFilter, setBlockTypeFilter] = useState<string | undefined>();
  const [blockKeyword, setBlockKeyword] = useState('');

  const editModal = useEditModal<RateLimitRule, RuleFormValues, Partial<CreateRateLimitRuleInput>>({
    entityName: '限流规则',
    save: saveMutation,
    defaults: {
      description: null, windowValue: 1, windowUnit: 'minute', limit: 30, keyType: 'ip',
      enabled: true, mode: 'enforce', algorithm: 'fixed_window', allowlist: [], priority: 0,
      alertThreshold: null, blockedMessage: null, pathPatterns: [],
    },
    toValues: (rule) => ({
      ...splitWindow(rule.windowMs),
      description: rule.description,
      limit: rule.limit,
      keyType: rule.keyType,
      enabled: rule.enabled,
      mode: rule.mode,
      algorithm: rule.algorithm,
      allowlist: rule.allowlist ?? [],
      priority: rule.priority,
      alertThreshold: rule.alertThreshold,
      blockedMessage: rule.blockedMessage,
      pathPatterns: rule.pathPatterns ?? [],
    }),
    beforeSave: (values, ctx) => {
      const { windowValue, windowUnit, name, ...rest } = values;
      return {
        // name 仅新增时提交；更新接口不接受改名
        ...(ctx.isEdit ? {} : { name }),
        ...rest,
        // InputNumber 清空后为 undefined，统一落为 null（= 不告警）
        alertThreshold: rest.alertThreshold ?? null,
        windowMs: windowValue * WINDOW_UNIT_MS[windowUnit],
      };
    },
    labelWidth: 130,
  });

  const handleToggleEnabled = async (rule: RateLimitRule, enabled: boolean) => {
    setTogglingId(rule.id);
    try {
      await saveMutation.mutateAsync({ id: rule.id, values: { enabled } });
      Toast.success(`${rule.name} 已${enabled ? '启用' : '禁用'}`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = (rule: RateLimitRule) => {
    confirmDelete({
      title: `删除限流规则 ${rule.name}？`,
      content: '删除后该规则的限流与统计立即停止，操作不可恢复。',
      onOk: async () => {
        await deleteMutation.mutateAsync({ params: { id: rule.id } });
        if (detailRuleName === rule.name) setDetailRuleName(null);
        Toast.success('已删除');
      },
    });
  };

  const handleResetStats = (name: string) => {
    confirmDanger({
      title: `清空 ${name} 的统计计数器？`,
      content: '命中 / 拦截计数、最近拦截记录与小时趋势将全部清零。',
      onOk: async () => {
        await resetStatsMutation.mutateAsync({ body: { name } });
        Toast.success('统计已清空');
      },
    });
  };

  const handleUnblock = async (name: string, key: string) => {
    const message = await unblockMutation.mutateAsync({ name, key });
    Toast.info(message);
  };

  const handleBanConfirm = async () => {
    if (!banTarget) return;
    await banMutation.mutateAsync({ body: { name: banTarget.rule, key: banTarget.key, durationSeconds: banDuration } });
    Toast.success(`已封禁 ${banTarget.key}`);
    setBanTarget(null);
  };

  const handleUnban = async (name: string, key: string) => {
    const message = await unbanMutation.mutateAsync({ name, key });
    Toast.info(message);
  };

  const refreshAll = () => {
    void rulesQuery.refetch();
    void statsQuery.refetch();
  };
  const refreshing = rulesQuery.isFetching || statsQuery.isFetching;

  // ─── 概览指标（近 24h 由小时序列求和） ─────────────────────────────────────
  const overview = useMemo(() => {
    let hits24h = 0;
    let blocked24h = 0;
    for (const item of statItems) {
      for (const p of item.hourlySeries) {
        hits24h += p.hits;
        blocked24h += p.blocked;
      }
    }
    return {
      enabledCount: rules.filter((r) => r.enabled).length,
      monitorCount: rules.filter((r) => r.enabled && r.mode === 'monitor').length,
      deadCount: rules.filter((r) => r.mountSource === 'none').length,
      hits24h,
      blocked24h,
      blockRate24h: hits24h > 0 ? `${(Math.round((blocked24h / hits24h) * 10000) / 100).toFixed(2)}%` : '0%',
    };
  }, [rules, statItems]);

  // ─── 拦截记录（合并全部规则 + 客户端筛选） ─────────────────────────────────
  const blockRows = useMemo<BlockRow[]>(() => {
    const rows = statItems.flatMap((s) =>
      s.recentBlocks.map((b, idx) => ({
        _rowId: `${s.name}-${b.at}-${b.key}-${idx}`,
        rule: s.name,
        at: b.at,
        key: b.key,
        path: b.path,
        monitored: b.monitored,
        banned: b.banned,
      })),
    );
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [statItems]);

  const filteredBlockRows = useMemo(() => {
    const kw = blockKeyword.trim().toLowerCase();
    return blockRows.filter((row) => {
      if (blockRuleFilter && row.rule !== blockRuleFilter) return false;
      if (blockTypeFilter === 'enforce' && (row.monitored || row.banned)) return false;
      if (blockTypeFilter === 'monitor' && !row.monitored) return false;
      if (blockTypeFilter === 'banned' && !row.banned) return false;
      if (kw && !row.key.toLowerCase().includes(kw) && !row.path.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [blockRows, blockRuleFilter, blockTypeFilter, blockKeyword]);

  const detailRule = detailRuleName ? rules.find((r) => r.name === detailRuleName) : undefined;
  const detailStat = detailRuleName ? statsByName.get(detailRuleName) : undefined;

  const modeTag = (mode: RateLimitMode) => (
    mode === 'monitor'
      ? <Tag size="small" color="orange">{RATE_LIMIT_MODE_LABELS.monitor}</Tag>
      : <Tag size="small" color="blue">{RATE_LIMIT_MODE_LABELS.enforce}</Tag>
  );

  const blockTypeTag = (row: { monitored: boolean; banned: boolean }) => {
    if (row.banned) return <Tag size="small" color="red">封禁</Tag>;
    return modeTag(row.monitored ? 'monitor' : 'enforce');
  };

  const mountSourceTag = (source: RateLimitMountSource) => (
    <Tag size="small" color={MOUNT_SOURCE_TAG_COLOR[source]}>
      {source === 'none' && <AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />}
      {RATE_LIMIT_MOUNT_SOURCE_LABELS[source]}
    </Tag>
  );

  const unblockAction = (rule: string, key: string) => ({
    key: 'unblock',
    label: '解封',
    hidden: !canManage,
    onClick: () => void handleUnblock(rule, key),
  });

  const banAction = (rule: string, key: string) => ({
    key: 'ban',
    label: '封禁',
    danger: true,
    hidden: !canManage,
    onClick: () => {
      setBanDuration(3600);
      setBanTarget({ rule, key });
    },
  });

  const rulesColumns = [
    {
      title: '规则',
      dataIndex: 'name',
      width: 230,
      render: (name: string, rule: RateLimitRule) => (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <Text strong ellipsis={{ showTooltip: true }} style={{ minWidth: 0 }}>{name}</Text>
          {rule.predefined && <Tag size="small" color="grey" style={{ flexShrink: 0 }}>内置</Tag>}
          {rule.mode === 'monitor' && modeTag('monitor')}
        </div>
      ),
    },
    {
      title: '挂载来源',
      dataIndex: 'mountSource',
      width: 110,
      render: (source: RateLimitMountSource) => mountSourceTag(source),
    },
    { title: '描述', dataIndex: 'description', render: (v: string | null) => (v ? renderEllipsis(v) : EMPTY_PLACEHOLDER) },
    {
      title: '窗口 / 上限',
      dataIndex: 'windowMs',
      width: 140,
      render: (_: number, rule: RateLimitRule) => `${formatWindow(rule.windowMs)} / ${rule.limit} 次`,
    },
    {
      title: '计数维度',
      dataIndex: 'keyType',
      width: 100,
      render: (v: RateLimitRule['keyType']) => RATE_LIMIT_KEY_TYPE_LABELS[v],
    },
    {
      title: '命中 / 拦截',
      dataIndex: 'name',
      key: 'stats',
      width: 170,
      render: (name: string) => {
        const stat = statsByName.get(name);
        if (!stat) return EMPTY_PLACEHOLDER;
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            {stat.hitCount.toLocaleString()}
            {' / '}
            <Text type={stat.blockedCount > 0 ? 'danger' : 'tertiary'}>{stat.blockedCount.toLocaleString()}</Text>
          </span>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      fixed: 'right' as const,
      render: (enabled: boolean, rule: RateLimitRule) => (
        <Switch
          size="small"
          checked={enabled}
          disabled={!canManage}
          loading={togglingId === rule.id && saveMutation.isPending}
          onChange={(checked) => void handleToggleEnabled(rule, checked)}
          aria-label={`启用 ${rule.name}`}
        />
      ),
    },
    createOperationColumn<RateLimitRule>({
      width: 180,
      desktopInlineKeys: ['detail', 'edit'],
      actions: (rule) => [
        { key: 'detail', label: '详情', onClick: () => setDetailRuleName(rule.name) },
        { key: 'edit', label: '编辑', hidden: !canManage, onClick: () => editModal.openEdit(rule) },
        { key: 'reset', label: '重置统计', danger: true, hidden: !canManage, onClick: () => handleResetStats(rule.name) },
        { key: 'delete', label: '删除', danger: true, hidden: !canManage || rule.predefined, onClick: () => handleDelete(rule) },
      ],
    }),
  ];

  const blockColumns = [
    { title: '规则', dataIndex: 'rule', width: 180, render: (v: string) => <Tag color="blue" size="small">{v}</Tag> },
    dateTimeColumn('拦截时间', 'at'),
    {
      title: '触发 Key',
      dataIndex: 'key',
      width: 240,
      render: (v: string) => (
        <Space spacing={4}>
          <Text copyable>{v}</Text>
          {IPV4_RE.test(v) && (
            <Button size="small" theme="borderless" onClick={() => navigate('/system/ip-access')}>IP 记录</Button>
          )}
        </Space>
      ),
    },
    { title: '请求路径', dataIndex: 'path', render: (v: string) => (v ? <Text code>{v}</Text> : EMPTY_PLACEHOLDER) },
    {
      title: '类型',
      dataIndex: 'monitored',
      width: 90,
      fixed: 'right' as const,
      render: (_: boolean, row: BlockRow) => blockTypeTag(row),
    },
    createOperationColumn<BlockRow>({
      width: 150,
      emptyContent: <span style={{ color: 'var(--semi-color-text-3)' }}>{EMPTY_PLACEHOLDER}</span>,
      actions: (row) => [unblockAction(row.rule, row.key), banAction(row.rule, row.key)],
    }),
  ];

  const detailChartSpec = detailStat
    ? makeLineSpec({
        data: trendRange === 'hourly' ? detailStat.hourlySeries : detailStat.dailySeries,
        xField: trendRange === 'hourly' ? 'hour' : 'day',
        series: [
          { field: 'hits', name: '命中', color: '#3b82f6' },
          { field: 'blocked', name: '拦截', color: '#ef4444' },
        ],
        palette,
        axis: { xLabel: (h: string) => h },
      })
    : null;

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as 'rules' | 'blocks')}>
        <TabPane tab="规则管理" itemKey="rules">
          <SearchToolbar
            primary={(
              <>
                <Text type="tertiary" style={{ fontSize: 13 }}>
                  规则保存后立即热更新到运行中的服务；统计每 30 秒自动刷新。
                </Text>
                {canManage && <CreateButton onClick={editModal.openCreate}>新增规则</CreateButton>}
                <RefreshButton onClick={refreshAll} loading={refreshing} />
              </>
            )}
            mobilePrimary={(
              <>
                {canManage && <CreateButton onClick={editModal.openCreate}>新增规则</CreateButton>}
                <RefreshButton onClick={refreshAll} loading={refreshing} />
              </>
            )}
          />

          <StatGrid minItemWidth={170} style={{ marginTop: 12, marginBottom: 16 }}>
            <StatCard title="启用规则" icon={<Gauge size={14} />} value={`${overview.enabledCount} / ${rules.length}`} sub={`观察模式 ${overview.monitorCount} 条`} />
            <StatCard title="未生效规则" icon={<AlertTriangle size={14} />} value={overview.deadCount} accent={overview.deadCount > 0 ? 'var(--semi-color-danger)' : undefined} sub={overview.deadCount > 0 ? '无代码挂载且未绑定路径' : '全部规则已挂载'} />
            <StatCard title="近 24h 命中" icon={<Zap size={14} />} value={overview.hits24h.toLocaleString()} />
            <StatCard title="近 24h 拦截" icon={<ShieldOff size={14} />} value={overview.blocked24h.toLocaleString()} accent={overview.blocked24h > 0 ? 'var(--semi-color-danger)' : undefined} />
            <StatCard title="近 24h 拦截率" icon={<Eye size={14} />} value={overview.blockRate24h} />
          </StatGrid>

          <ConfigurableTable
            bordered
            rowKey="id"
            loading={rulesQuery.isLoading}
            onRefresh={refreshAll}
            refreshLoading={refreshing}
            dataSource={rules}
            columns={rulesColumns}
            pagination={false}
          />
        </TabPane>

        <TabPane tab="拦截记录" itemKey="blocks">
          <SearchToolbar
            primary={(
              <>
                <FilterSelect
                  placeholder="全部规则"
                  items={rules.map((r) => ({ value: r.name, label: r.name }))}
                  value={blockRuleFilter}
                  onChange={setBlockRuleFilter}
                  width={200}
                  aria-label="按规则筛选"
                />
                <FilterSelect
                  placeholder="全部类型"
                  items={[{ value: 'enforce', label: RATE_LIMIT_MODE_LABELS.enforce },
                    { value: 'monitor', label: RATE_LIMIT_MODE_LABELS.monitor },
                    { value: 'banned', label: '封禁' },]}
                  value={blockTypeFilter}
                  onChange={setBlockTypeFilter}
                  aria-label="按类型筛选"
                />
                <KeywordInput value={blockKeyword} onChange={setBlockKeyword} placeholder="搜索 Key / 路径" />
                <RefreshButton onClick={() => void statsQuery.refetch()} loading={statsQuery.isFetching} />
              </>
            )}
            mobilePrimary={(
              <>
                <KeywordInput value={blockKeyword} onChange={setBlockKeyword} placeholder="搜索 Key / 路径" />
                <RefreshButton onClick={() => void statsQuery.refetch()} loading={statsQuery.isFetching} />
              </>
            )}
          />
          <ConfigurableTable
            bordered
            rowKey="_rowId"
            loading={statsQuery.isLoading}
            onRefresh={() => void statsQuery.refetch()}
            refreshLoading={statsQuery.isFetching}
            dataSource={filteredBlockRows}
            columns={blockColumns}
            pagination={{ pageSize: 20 }}
          />
        </TabPane>

        <TabPane tab="封禁列表" itemKey="bans">
          <SearchToolbar
            primary={(
              <>
                <Text type="tertiary" style={{ fontSize: 13 }}>
                  手动封禁的身份在封禁期内一律拦截（无视限额与观察模式），到期自动解除。
                </Text>
                <RefreshButton onClick={() => void bansQuery.refetch()} loading={bansQuery.isFetching} />
              </>
            )}
            mobilePrimary={(
              <RefreshButton onClick={() => void bansQuery.refetch()} loading={bansQuery.isFetching} />
            )}
          />
          <ConfigurableTable
            bordered
            rowKey={(b: { name: string; key: string } | undefined) => `${b?.name}|${b?.key}`}
            loading={bansQuery.isLoading}
            onRefresh={() => void bansQuery.refetch()}
            refreshLoading={bansQuery.isFetching}
            dataSource={bansQuery.data ?? []}
            columns={[
              { title: '规则', dataIndex: 'name', minWidth: 200, render: (v: string) => <Tag color="blue" size="small">{v}</Tag> },
              copyableNoColumn('被封禁 Key', 'key', { width: undefined }),
              dateTimeColumn('到期时间', 'expiresAt'),
              {
                title: '剩余',
                dataIndex: 'remainingSeconds',
                width: 110,
                render: (v: number) => formatWindow(v * 1000),
              },
              createOperationColumn<{ name: string; key: string; expiresAt: string; remainingSeconds: number }>({
                width: 120,
                emptyContent: <span style={{ color: 'var(--semi-color-text-3)' }}>{EMPTY_PLACEHOLDER}</span>,
                actions: (row) => [{
                  key: 'unban',
                  label: '解除封禁',
                  danger: true,
                  hidden: !canManage,
                  onClick: () => void handleUnban(row.name, row.key),
                }],
              }),
            ]}
            pagination={{ pageSize: 20 }}
          />
        </TabPane>
      </Tabs>

      <SideSheet
        title={detailRule && (
          <Space spacing={8}>
            <span>{detailRule.name}</span>
            {detailRule.predefined && <Tag size="small" color="grey">内置</Tag>}
            {modeTag(detailRule.mode)}
            {mountSourceTag(detailRule.mountSource)}
          </Space>
        )}
        visible={!!detailRule}
        onCancel={() => setDetailRuleName(null)}
        width={680}
        closeOnEsc
      >
        {detailRule && (
          <div className="zx-flat-panels">
            {detailRule.description && (
              <Text type="tertiary" style={{ display: 'block', marginBottom: 12 }}>{detailRule.description}</Text>
            )}
            <div className="auto-grid" style={{ ['--auto-grid-min' as string]: '150px', ['--auto-grid-gap' as string]: '12px' }}>
              <InfoBlock label="时间窗口" value={formatWindow(detailRule.windowMs)} />
              <InfoBlock label="窗口内上限" value={`${detailRule.limit} 次`} />
              <InfoBlock label="计数维度" value={RATE_LIMIT_KEY_TYPE_LABELS[detailRule.keyType]} />
              <InfoBlock label="算法" value={RATE_LIMIT_ALGORITHM_LABELS[detailRule.algorithm]} />
              <InfoBlock label="路径优先级" value={String(detailRule.priority)} />
              <InfoBlock label="告警阈值" value={detailRule.alertThreshold === null ? '不告警' : `${detailRule.alertThreshold} 次/小时`} />
              <InfoBlock label="拦截提示" value={detailRule.blockedMessage ?? '默认提示'} />
            </div>
            {detailRule.allowlist.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text type="tertiary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>白名单</Text>
                <Space wrap spacing={4}>
                  {detailRule.allowlist.map((entry) => <Tag key={entry} size="small" color="green">{entry}</Tag>)}
                </Space>
              </div>
            )}
            {detailRule.pathPatterns.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text type="tertiary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>绑定路径</Text>
                <Space wrap spacing={4}>
                  {detailRule.pathPatterns.map((p) => <Tag key={p} size="small" color="cyan">{p}</Tag>)}
                </Space>
              </div>
            )}

            <Divider align="left" style={{ margin: '20px 0 12px' }}>拦截趋势</Divider>
            {detailChartSpec && detailStat ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <RadioGroup
                    type="button"
                    buttonSize="small"
                    value={trendRange}
                    onChange={(e) => setTrendRange(e.target.value as 'hourly' | 'daily')}
                  >
                    <Radio value="hourly">近 24 小时</Radio>
                    <Radio value="daily">近 30 天</Radio>
                  </RadioGroup>
                  <Tag size="small" color="blue">累计命中 {detailStat.hitCount.toLocaleString()}</Tag>
                  <Tag size="small" color="red">累计拦截 {detailStat.blockedCount.toLocaleString()}</Tag>
                  <Tag size="small">拦截率 {detailStat.blockRate}%</Tag>
                </div>
                <LineChart {...detailChartSpec} options={chartOptions} height={220} />
              </>
            ) : <Text type="tertiary">暂无统计数据</Text>}

            <Divider align="left" style={{ margin: '20px 0 12px' }}>今日 Top 拦截来源</Divider>
            {detailStat && detailStat.topSources.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detailStat.topSources.map((source) => {
                  const maxCount = detailStat.topSources[0]?.count ?? 1;
                  return (
                    <div key={source.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Text copyable style={{ width: 220, flexShrink: 0 }} ellipsis={{ showTooltip: true }}>{source.key}</Text>
                      <DataBar value={source.count} max={maxCount} color="var(--semi-color-danger)" style={{ flex: 1 }} />
                      <Text strong style={{ width: 56, textAlign: 'right', flexShrink: 0 }}>{source.count.toLocaleString()}</Text>
                      {canManage && (
                        <Button
                          size="small"
                          theme="borderless"
                          type="danger"
                          onClick={() => {
                            setBanDuration(3600);
                            setBanTarget({ rule: detailRule.name, key: source.key });
                          }}
                        >封禁</Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : <Text type="tertiary">今日暂无拦截来源</Text>}

            <Divider align="left" style={{ margin: '20px 0 12px' }}>该规则最近拦截</Divider>
            <ConfigurableTable
              bordered
              rowKey="_rowId"
              size="small"
              dataSource={(detailStat?.recentBlocks ?? []).map((b, idx) => ({
                _rowId: `${detailRule.name}-${b.at}-${idx}`, rule: detailRule.name, ...b,
              }))}
              columns={[
                dateTimeColumn('时间', 'at'),
                copyableNoColumn('Key', 'key', { flex: true }),
                {
                  title: '类型', dataIndex: 'monitored', width: 80,
                  render: (_: boolean, row: BlockRow) => blockTypeTag(row),
                },
                createOperationColumn<BlockRow>({
                  width: 150,
                  emptyContent: <span style={{ color: 'var(--semi-color-text-3)' }}>{EMPTY_PLACEHOLDER}</span>,
                  actions: (row) => [unblockAction(row.rule, row.key), banAction(row.rule, row.key)],
                }),
              ]}
              pagination={{ pageSize: 10 }}
            />
          </div>
        )}
      </SideSheet>

      <Modal
        title={banTarget ? `封禁 ${banTarget.key}` : ''}
        visible={!!banTarget}
        onCancel={() => setBanTarget(null)}
        onOk={() => void handleBanConfirm()}
        okText="封禁"
        okButtonProps={{ type: 'danger', theme: 'solid', loading: banMutation.isPending }}
        closeOnEsc
        width={420}
      >
        {banTarget && (
          <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
            <Text>
              封禁期内该身份在规则 <Tag size="small" color="blue">{banTarget.rule}</Tag> 下的请求一律拦截，
              无视限额与观察模式；到期自动解除，也可在封禁列表中提前解除。
            </Text>
            <Select
              value={banDuration}
              onChange={(v) => setBanDuration(v as number)}
              optionList={RATE_LIMIT_BAN_DURATION_OPTIONS}
              style={{ width: 200 }}
              aria-label="封禁时长"
              prefix={<Ban size={14} />}
            />
          </Space>
        )}
      </Modal>

      <SideSheet
        title={editModal.modalProps.title}
        visible={editModal.modalProps.visible}
        onCancel={editModal.modalProps.onCancel}
        closeOnEsc
        width={680}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={editModal.modalProps.onCancel}>取消</Button>
            <Button
              type="primary"
              theme="solid"
              loading={editModal.modalProps.okButtonProps.loading}
              disabled={editModal.modalProps.okButtonProps.disabled}
              onClick={() => void editModal.modalProps.onOk()}
            >
              {editModal.editing ? '保存（立即生效）' : '创建（立即生效）'}
            </Button>
          </div>
        )}
      >
        <Form key={editModal.formKey} {...editModal.formProps}>
          {!editModal.editing && (
            <Form.Input
              field="name"
              label="规则名称"
              placeholder="小写字母/数字/下划线/连字符，如 upload"
              rules={[
                { required: true, message: '请输入规则名称' },
                { pattern: /^[a-z][a-z0-9_-]*$/, message: '只能小写字母、数字、下划线、连字符，且以字母开头' },
              ]}
            />
          )}
          <Form.Input field="description" label="描述" placeholder="可选" />
          <Form.Select
            field="mode"
            label="模式"
            optionList={RATE_LIMIT_MODE_OPTIONS}
            style={{ width: '100%' }}
            extraText="观察模式下超限只记录统计不实际拦截，用于新规则上线前安全调参"
          />
          <Form.Select
            field="algorithm"
            label="限流算法"
            optionList={RATE_LIMIT_ALGORITHM_OPTIONS}
            style={{ width: '100%' }}
            extraText="滑动窗口消除固定窗口在边界处最多 2× 限额的突刺，适合 auth / 支付等敏感规则"
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Form.InputNumber field="windowValue" label="时间窗口" min={1} style={{ width: '100%' }} rules={[{ required: true, message: '请输入窗口时长' }]} fieldStyle={{ flex: 1 }} />
            <Form.Select field="windowUnit" label="单位" optionList={RATE_LIMIT_WINDOW_UNIT_OPTIONS} style={{ width: 110 }} />
          </div>
          <Form.InputNumber field="limit" label="窗口内上限" min={1} style={{ width: '100%' }} rules={[{ required: true, message: '请输入请求上限' }]} />
          <Form.Select
            field="keyType"
            label="计数维度"
            optionList={RATE_LIMIT_KEY_TYPE_OPTIONS}
            style={{ width: '100%' }}
            extraText="「登录用户」在无登录态的公开路径上自动回退为按 IP 计数"
          />
          <Form.Select
            field="pathPatterns"
            label="绑定路径"
            placeholder="选择或输入 /api/ 开头的路径，支持 /* 通配，留空则仅代码挂载生效"
            multiple
            filter
            allowCreate
            showClear
            searchPosition="dropdown"
            style={{ width: '100%' }}
            optionList={apiPaths}
            virtualize={{ height: 260, width: '100%', itemSize: 36 }}
            rules={[{
              validator: (_rule: unknown, value: string[] | undefined) =>
                !value || value.every((p) => p.startsWith('/api/')),
              message: '绑定路径必须以 /api/ 开头（限流仅挂载在 /api/* 上）',
            }]}
          />
          <Form.InputNumber
            field="priority"
            label="路径优先级"
            min={0}
            max={9999}
            style={{ width: '100%' }}
            extraText="多条规则的绑定路径命中同一请求时应用优先级大者；仅路径绑定时生效"
          />
          <Form.TagInput
            field="allowlist"
            label="白名单"
            placeholder="IP、CIDR（10.0.0.0/8）或 u:用户ID，回车添加"
            extraText="命中白名单的请求直接放行且不计数；用于内部探活、回调源与办公网豁免"
          />
          <Form.InputNumber
            field="alertThreshold"
            label="告警阈值"
            min={1}
            style={{ width: '100%' }}
            placeholder="留空不告警"
            extraText="单小时拦截数达到该值时通知平台管理员（同一小时只告警一次）"
          />
          <Form.Input field="blockedMessage" label="拦截提示文案" placeholder="为空使用默认提示" />
          <Form.Switch field="enabled" label="启用" />
        </Form>
      </SideSheet>
    </div>
  );
}

function InfoBlock({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
