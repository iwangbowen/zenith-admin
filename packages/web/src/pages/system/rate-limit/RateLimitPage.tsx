import { useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Collapse,
  Form,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Select,
  SideSheet,
  Space,
  TabPane,
  Tabs,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import type { CreateRateLimitRuleInput, RateLimitRule } from '@zenith/shared/platform';
import {
  DEFAULT_RATE_LIMIT_RULES,
  RATE_LIMIT_ALGORITHM_OPTIONS,
  RATE_LIMIT_BAN_DURATION_OPTIONS,
  RATE_LIMIT_DECISION_LABELS,
  RATE_LIMIT_DECISIONS,
  RATE_LIMIT_KEY_TYPE_OPTIONS,
  RATE_LIMIT_METHODS,
  rateLimitSummary,
} from '@zenith/shared/platform';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useEditModal } from '@/hooks/useEditModal';
import {
  useBanRateLimitKey,
  useDeleteRateLimitRule,
  useDiagnoseRateLimit,
  useRateLimitApiPaths,
  useRateLimitBans,
  useRateLimitDetailStats,
  useRateLimitEvents,
  useRateLimitRules,
  useRateLimitStats,
  useResetRateLimitStats,
  useSaveRateLimitRule,
  useUnbanRateLimitKey,
  useUnblockRateLimitKey,
} from '@/hooks/queries/rate-limit';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { InstantFilterToolbar, listTableProps } from '@/components/list-page';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { EditFormSheet } from '@/components/EditFormModal';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { LineChart, chartOptions, makeLineSpec, useChartPalette } from '@/components/charts';
import { abortSubmit } from '@/lib/abort-submit';
import { Toast } from '@douyinfe/semi-ui';
import { confirmDanger } from '@/utils/confirm';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { useNavigate } from 'react-router-dom';
const { Text } = Typography;
type RuleValues = Omit<CreateRateLimitRuleInput, 'windowMs'> & {
  windowSeconds: number;
  burstSeconds?: number;
  burstLimit?: number;
};
const modeOptions = [
  { value: 'monitor', label: '观察' },
  { value: 'enforce', label: '拦截' },
];
export default function RateLimitPage() {
  const { hasPermission } = usePermission();
  const manage = hasPermission('system:rate-limit:manage');
  const canBan = hasPermission('system:rate-limit:ban');
  const canReset = hasPermission('system:rate-limit:reset');
  const palette = useChartPalette();
  const navigate = useNavigate();
  const [tab, setTab] = useUrlTabState(['rules', 'overview', 'blocks', 'bans'] as const, 'rules');
  const rulesQuery = useRateLimitRules();
  const stats = useRateLimitStats();
  const bans = useRateLimitBans(tab === 'bans');
  const paths = useRateLimitApiPaths();
  const save = useSaveRateLimitRule();
  const remove = useDeleteRateLimitRule();
  const reset = useResetRateLimitStats();
  const unblock = useUnblockRateLimitKey();
  const ban = useBanRateLimitKey();
  const unban = useUnbanRateLimitKey();
  const diagnose = useDiagnoseRateLimit();
  const [keyword, setKeyword] = useState('');
  const [mode, setMode] = useState<string>();
  const [enabled, setEnabled] = useState<string>();
  const [detail, setDetail] = useState<RateLimitRule | null>(null);
  const [eventRule, setEventRule] = useState<string>();
  const [eventDecision, setEventDecision] = useState<(typeof RATE_LIMIT_DECISIONS)[number]>();
  const [eventKeyword, setEventKeyword] = useState('');
  const [page, setPage] = useState(1);
  const events = useRateLimitEvents(
    { page, pageSize: 20, name: eventRule, decision: eventDecision, keyword: eventKeyword },
    tab === 'blocks',
  );
  const detailStats = useRateLimitDetailStats(detail?.id ?? null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagMethod, setDiagMethod] = useState('GET');
  const [diagPath, setDiagPath] = useState('/api/users/1');
  const [principal, setPrincipal] = useState<'anonymous' | 'admin' | 'member' | 'app'>('anonymous');
  const [banTarget, setBanTarget] = useState<{ name: string; key: string } | null>(null);
  const [banName, setBanName] = useState('');
  const [banKey, setBanKey] = useState('');
  const [banReason, setBanReason] = useState('');
  const [duration, setDuration] = useState(3600);
  const rules = rulesQuery.data ?? [];
  const statMap = new Map((stats.data?.items ?? []).map((item) => [item.name, item]));
  const filtered = rules.filter(
    (rule) =>
      (!keyword ||
        (rule.name + ' ' + rule.description + ' ' + rule.pathPatterns.join(' '))
          .toLowerCase()
          .includes(keyword.toLowerCase())) &&
      (!mode || rule.mode === mode) &&
      (!enabled || (rule.enabled ? 'enabled' : 'disabled') === enabled),
  );
  const modal = useEditModal<RateLimitRule, RuleValues, Partial<CreateRateLimitRuleInput>>({
    entityName: '限流规则',
    save,
    defaults: {
      name: '',
      description: null,
      windowSeconds: 60,
      limit: 30,
      keyType: 'ip',
      enabled: false,
      mode: 'monitor',
      algorithm: 'fixed_window',
      methods: [],
      pathPatterns: [],
      allowlist: [],
      priority: 0,
      failMode: 'open',
      alertThreshold: null,
      alertUserIds: [],
      alertCooldownSeconds: 3600,
    },
    toValues: (rule) => ({
      ...rule,
      methods: (rule.methods ?? []) as CreateRateLimitRuleInput['methods'],
      windowSeconds: rule.windowMs / 1000,
      burstSeconds: rule.extraWindows?.[0]?.windowMs ? rule.extraWindows[0].windowMs / 1000 : undefined,
      burstLimit: rule.extraWindows?.[0]?.limit,
    }),
    beforeSave: (values, ctx) => {
      const { windowSeconds, burstSeconds, burstLimit, name, ...rest } = values;
      if (Boolean(burstSeconds) !== Boolean(burstLimit)) {
        Toast.warning('附加窗口时长与上限必须同时填写');
        abortSubmit();
      }
      return {
        ...rest,
        ...(ctx.isEdit ? {} : { name }),
        windowMs: windowSeconds * 1000,
        extraWindows:
          burstSeconds && burstLimit
            ? [{ windowMs: burstSeconds * 1000, limit: burstLimit }, ...(ctx.editing?.extraWindows?.slice(1) ?? [])]
            : (ctx.editing?.extraWindows?.slice(1) ?? []),
        alertThreshold: rest.alertThreshold ?? null,
        alertUserIds: (rest.alertUserIds ?? []).map(Number),
      };
    },
    labelPosition: 'top',
  });
  const totals = (stats.data?.items ?? []).reduce(
    (sum, item) => ({
      hits: sum.hits + item.hitCount,
      blocked: sum.blocked + item.blockedCount,
      monitor: sum.monitor + (item.monitoredCount ?? 0),
      degraded: sum.degraded + (item.degradedCount ?? 0),
    }),
    { hits: 0, blocked: 0, monitor: 0, degraded: 0 },
  );
  const trend = useMemo(() => {
    const points = new Map<string, { hour: string; hits: number; blocked: number }>();
    for (const item of stats.data?.items ?? [])
      for (const p of item.hourlySeries) {
        const v = points.get(p.hour) ?? { hour: p.hour, hits: 0, blocked: 0 };
        v.hits += p.hits;
        v.blocked += p.blocked;
        points.set(p.hour, v);
      }
    return makeLineSpec({
      data: [...points.values()],
      series: [
        { name: '规则命中', field: 'hits' },
        { name: '实际拦截', field: 'blocked' },
      ],
      xField: 'hour',
      palette,
    });
  }, [stats.data, palette]);
  const openBan = (name = '', key = '') => {
    setBanName(name);
    setBanKey(key);
    setBanReason('');
    setBanTarget({ name, key });
  };
  const resetStats = (name: string) =>
    void confirmDanger({
      title: '清空 ' + name + ' 的统计？',
      content: '切换统计周期，小时/日趋势、命中记录和来源排行同时清空；不清除额度或封禁。',
      onOk: () => reset.mutateAsync({ body: { name } }),
    });
  const rulesColumns = [
    {
      title: '规则',
      dataIndex: 'name',
      width: 210,
      render: (name: string, r: RateLimitRule) => (
        <Space vertical align="start" spacing={2}>
          <Text strong>{name}</Text>
          <Space>
            <Tag size="small">{r.predefined ? '内置' : '自定义'}</Tag>
            <Tag size="small" color={r.mode === 'monitor' ? 'orange' : 'blue'}>
              {r.mode === 'monitor' ? '观察' : '拦截'}
            </Tag>
          </Space>
        </Space>
      ),
    },
    {
      title: '说明 / 接口范围',
      dataIndex: 'description',
      render: (_: unknown, r: RateLimitRule) => (
        <>
          <div>{renderEllipsis(r.description ?? '未填写描述')}</div>
          <Text type="tertiary" size="small">
            {r.mountSource.includes('code') ? '含具名业务保护 · ' : ''}
            {r.matchedOperationCount ?? 0} 个路径匹配 · {(r.methods ?? []).join('/') || '全部方法'}
          </Text>
          {r.warnings?.map((w) => (
            <div key={w}>
              <Text type="warning">{w}</Text>
            </div>
          ))}
        </>
      ),
    },
    { title: '限额', width: 190, render: (_: unknown, r: RateLimitRule) => rateLimitSummary(r) },
    {
      title: '近24小时 命中/拦截',
      width: 160,
      render: (_: unknown, r: RateLimitRule) => {
        const s = statMap.get(r.name);
        return s ? s.hitCount + ' / ' + s.blockedCount : '—';
      },
    },
    {
      title: '状态',
      width: 100,
      render: (_: unknown, r: RateLimitRule) => (
        <Tag color={r.enabled ? 'green' : 'grey'}>{r.enabled ? '启用' : '停用'}</Tag>
      ),
    },
    createOperationColumn<RateLimitRule>({
      width: 160,
      desktopInlineKeys: ['detail', 'edit'],
      actions: (r) => [
        { key: 'detail', label: '详情', onClick: () => setDetail(r) },
        { key: 'edit', label: '编辑', hidden: !manage, onClick: () => modal.openEdit(r) },
        {
          key: 'toggle',
          label: r.enabled ? '停用' : '启用',
          hidden: !manage,
          onClick: () => void save.mutateAsync({ id: r.id, values: { enabled: !r.enabled } }).catch(() => undefined),
        },
        { key: 'reset', label: '清空统计', hidden: !canReset, danger: true, onClick: () => resetStats(r.name) },
        {
          key: 'delete',
          label: '删除',
          hidden: !manage || r.predefined,
          danger: true,
          onClick: () =>
            void confirmDanger({
              title: '删除 ' + r.name + '？',
              content: '删除自定义规则，已产生的统计按保留期限回收。',
              onOk: () => remove.mutateAsync({ params: { id: r.id } }),
            }),
        },
      ],
    }),
  ];
  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={tab} onChange={(key) => setTab(key as typeof tab)} type="line" collapsible="auto">
        <TabPane tab="规则管理" itemKey="rules">
          <InstantFilterToolbar
            primary={<KeywordInput value={keyword} onChange={setKeyword} placeholder="搜索规则、说明或路径" />}
            filters={
              <>
                <FilterSelect items={modeOptions} value={mode} onChange={setMode} placeholder="全部模式" />
                <FilterSelect
                  items={[
                    { value: 'enabled', label: '启用' },
                    { value: 'disabled', label: '停用' },
                  ]}
                  value={enabled}
                  onChange={setEnabled}
                  placeholder="全部状态"
                />
              </>
            }
            actions={
              <>
                <Button
                  onClick={() => {
                    diagnose.reset();
                    setDiagOpen(true);
                  }}
                >
                  匹配诊断
                </Button>
                {manage && (
                  <Button type="primary" onClick={modal.openCreate}>
                    新增规则
                  </Button>
                )}
              </>
            }
            onRefresh={() => void rulesQuery.refetch()}
            refreshing={rulesQuery.isFetching}
          />
          <ConfigurableTable
            {...listTableProps(rulesQuery)}
            dataSource={filtered}
            columns={rulesColumns}
            pagination={{ pageSize: 20 }}
          />
        </TabPane>
        <TabPane tab="运行概览" itemKey="overview">
          <InstantFilterToolbar onRefresh={() => void stats.refetch()} refreshing={stats.isFetching} />
          <StatGrid minItemWidth={155}>
            <StatCard title="启用 / 全部" value={rules.filter((r) => r.enabled).length + ' / ' + rules.length} />
            <StatCard title="规则命中" value={totals.hits} />
            <StatCard title="实际拦截" value={totals.blocked} />
            <StatCard title="观察命中" value={totals.monitor} />
            <StatCard title="故障放行 / 拒绝" value={totals.degraded} />
          </StatGrid>
          <LineChart {...trend} options={chartOptions} height={280} />
        </TabPane>
        <TabPane tab="命中记录" itemKey="blocks">
          <InstantFilterToolbar
            primary={
              <KeywordInput
                value={eventKeyword}
                onChange={(value) => {
                  setEventKeyword(value);
                  setPage(1);
                }}
                placeholder="搜索身份或安全路由"
              />
            }
            filters={
              <>
                <FilterSelect
                  items={rules.map((r) => ({ value: r.name, label: r.name }))}
                  value={eventRule}
                  onChange={(value) => {
                    setEventRule(value);
                    setPage(1);
                  }}
                  placeholder="全部规则"
                />
                <FilterSelect
                  items={RATE_LIMIT_DECISIONS.filter((d) => d !== 'allowed' && d !== 'exempt').map((value) => ({
                    value,
                    label: RATE_LIMIT_DECISION_LABELS[value],
                  }))}
                  value={eventDecision}
                  onChange={(value) => {
                    setEventDecision(value as typeof eventDecision);
                    setPage(1);
                  }}
                  placeholder="全部决策"
                />
              </>
            }
            onRefresh={() => void events.refetch()}
            refreshing={events.isFetching}
          />
          <Text type="tertiary">每规则最多保留500条近期异常决策，7天到期；统计聚合独立保存，不代表完整请求审计。</Text>
          <ConfigurableTable
            {...listTableProps(events, { loadingMode: 'initial' })}
            rowKey="id"
            columns={[
              dateTimeColumn('时间', 'at'),
              { title: '规则', dataIndex: 'name', width: 180 },
              { title: '方法 / 安全路由', render: (_: unknown, r) => r.method + ' ' + r.path },
              { title: '身份', dataIndex: 'key', width: 200, render: renderEllipsis },
              {
                title: '决策',
                dataIndex: 'decision',
                width: 100,
                render: (d: (typeof RATE_LIMIT_DECISIONS)[number]) => RATE_LIMIT_DECISION_LABELS[d],
              },
              createOperationColumn({
                width: 150,
                actions: (r: { name: string; key: string; correlationId?: string | null }) => [
                  {
                    key: 'clear',
                    label: '清额度',
                    hidden: !canReset,
                    onClick: () =>
                      void confirmDanger({
                        title: '清除此身份的计数窗口？',
                        content: '保留统计记录和临时封禁。',
                        onOk: () => unblock.mutateAsync({ name: r.name, key: r.key }),
                      }),
                  },
                  { key: 'ban', label: '封禁', hidden: !canBan, danger: true, onClick: () => openBan(r.name, r.key) },
                  {
                    key: 'trace',
                    label: '链路',
                    hidden: !r.correlationId,
                    onClick: () =>
                      navigate('/system/api-access-logs?correlationId=' + encodeURIComponent(r.correlationId ?? '')),
                  },
                ],
              }),
            ]}
            pagination={{ currentPage: page, pageSize: 20, total: events.data?.total ?? 0, onPageChange: setPage }}
          />
        </TabPane>
        <TabPane tab="临时封禁" itemKey="bans">
          <InstantFilterToolbar
            actions={canBan && <Button onClick={() => openBan()}>新增封禁</Button>}
            onRefresh={() => void bans.refetch()}
            refreshing={bans.isFetching}
          />
          <ConfigurableTable
            {...listTableProps(bans, { loadingMode: 'initial', rowKey: (r) => (r?.name ?? '') + '|' + (r?.key ?? '') })}
            columns={[
              { title: '规则', dataIndex: 'name', width: 180 },
              { title: '身份', dataIndex: 'key', render: renderEllipsis },
              { title: '原因', dataIndex: 'reason' },
              dateTimeColumn('到期', 'expiresAt'),
              createOperationColumn({
                width: 120,
                actions: (r: { name: string; key: string }) => [
                  {
                    key: 'unban',
                    label: '解除封禁',
                    hidden: !canBan,
                    danger: true,
                    onClick: () =>
                      void confirmDanger({
                        title: '解除临时封禁？',
                        content: '只解除显式封禁，普通限额继续生效。',
                        onOk: () => unban.mutateAsync({ name: r.name, key: r.key }),
                      }),
                  },
                ],
              }),
            ]}
            pagination={{ pageSize: 20 }}
          />
        </TabPane>
      </Tabs>
      <EditFormSheet modal={modal} width={680} okText="保存规则">
        {!modal.editing && (
          <Select
            placeholder="参考预设（填充策略，仍保持停用）"
            style={{ width: '100%', marginBottom: 12 }}
            optionList={['auth', 'captcha', 'chunk_upload', 'payment_public_link_session'].map((name) => ({
              value: name,
              label: DEFAULT_RATE_LIMIT_RULES[name].description ?? name,
            }))}
            onChange={(value) => {
              const preset = DEFAULT_RATE_LIMIT_RULES[String(value)];
              if (preset)
                modal.formApi.current?.setValues({
                  ...preset,
                  name: '',
                  windowSeconds: preset.windowMs / 1000,
                  enabled: false,
                  mode: 'monitor',
                });
            }}
          />
        )}
        <Collapse defaultActiveKey={['basic', 'scope', 'limits']} keepDOM>
          <Collapse.Panel header="基本信息" itemKey="basic">
            {!modal.editing && (
              <Form.Input field="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]} />
            )}
            <Form.Input field="description" label="描述" maxLength={255} />
            <Form.RadioGroup field="mode" label="执行模式" type="button" options={modeOptions} />
            <Form.Switch field="enabled" label="启用规则" />
          </Collapse.Panel>
          <Collapse.Panel header="接口范围" itemKey="scope">
            <Form.Select
              field="pathPatterns"
              label="接口路径 / 路由模板"
              multiple
              filter
              allowCreate
              showClear
              optionList={paths.data ?? []}
              style={{ width: '100%' }}
              extraText="支持 {id}、单段 * 和末尾 /*；具名内置保护无须额外绑定。"
            />
            <Form.Select
              field="methods"
              label="HTTP 方法"
              multiple
              optionList={RATE_LIMIT_METHODS.map((value) => ({ value, label: value }))}
              style={{ width: '100%' }}
              placeholder="留空表示全部方法"
            />
            <Form.Select
              field="keyType"
              label="计数维度"
              optionList={RATE_LIMIT_KEY_TYPE_OPTIONS}
              style={{ width: '100%' }}
              extraText="身份维度只在认证成功后执行，管理员、会员、开放应用与租户互相隔离。"
            />
          </Collapse.Panel>
          <Collapse.Panel header="限额策略" itemKey="limits">
            <Form.InputNumber
              field="windowSeconds"
              label="主窗口（秒）"
              min={1}
              max={86400}
              rules={[{ required: true, message: '请输入窗口' }]}
            />
            <Form.InputNumber
              field="limit"
              label="主窗口请求上限"
              min={1}
              max={1000000}
              rules={[{ required: true, message: '请输入上限' }]}
            />
            <Form.Select
              field="algorithm"
              label="算法"
              optionList={RATE_LIMIT_ALGORITHM_OPTIONS}
              style={{ width: '100%' }}
            />
          </Collapse.Panel>
          <Collapse.Panel header="高级策略与豁免" itemKey="advanced">
            <Form.InputNumber field="burstSeconds" label="附加窗口（秒，可选）" min={1} max={86400} />
            <Form.InputNumber field="burstLimit" label="附加窗口上限" min={1} max={1000000} />
            <Form.InputNumber field="priority" label="同阶段路径优先级" min={0} max={9999} />
            <Form.TagInput
              field="allowlist"
              label="豁免 IP / CIDR / 身份"
              extraText="如 10.0.0.0/8、u:platform:1、m:3:7；临时封禁优先。"
            />
            <Form.RadioGroup
              field="failMode"
              label="Redis 异常策略"
              options={[
                { value: 'open', label: '故障放行' },
                { value: 'closed', label: '故障拒绝（503）' },
              ]}
            />
            <Form.Input field="blockedMessage" label="拦截提示" maxLength={255} />
          </Collapse.Panel>
          <Collapse.Panel header="告警" itemKey="alerts">
            <Form.InputNumber field="alertThreshold" label="每小时实际拦截阈值" min={1} max={1000000} />
            <Form.TagInput field="alertUserIds" label="接收人用户 ID" extraText="留空通知平台管理员" />
            <Form.InputNumber field="alertCooldownSeconds" label="告警冷却（秒）" min={60} max={86400} />
          </Collapse.Panel>
        </Collapse>
      </EditFormSheet>
      <SideSheet title={detail?.name} visible={detail !== null} onCancel={() => setDetail(null)} width={680}>
        {detail && (
          <Space vertical align="start" style={{ width: '100%' }}>
            <Text>{detail.description}</Text>
            <Text>{rateLimitSummary(detail)}</Text>
            <Text>
              配置版本 {detail.policyVersion} ·{' '}
              {detail.loadState === 'loaded' ? '当前实例已加载' : '等待加载 / 兜底刷新'}
            </Text>
            <Text>
              路径绑定 {detail.pathPatterns.join('、') || '无'}；
              {detail.mountSource.includes('code') ? '同时存在具名业务保护' : '仅路径绑定'}
            </Text>
            <Text>
              近24小时：命中 {detailStats.data?.hitCount ?? 0} / 实际拦截 {detailStats.data?.blockedCount ?? 0} / 观察{' '}
              {detailStats.data?.monitoredCount ?? 0}
            </Text>
            <Text strong>30天趋势</Text>
            <LineChart
              {...makeLineSpec({
                data: detailStats.data?.dailySeries ?? [],
                series: [
                  { name: '规则命中', field: 'hits' },
                  { name: '实际拦截', field: 'blocked' },
                ],
                xField: 'day',
                palette,
              })}
              options={chartOptions}
              height={230}
            />
            <Text strong>今日实际拦截来源</Text>
            {detailStats.data?.topSources.map((source) => (
              <Text key={source.key}>
                {source.key} · {source.count}
              </Text>
            ))}
          </Space>
        )}
      </SideSheet>
      <Modal
        title="规则匹配诊断"
        visible={diagOpen}
        onCancel={() => setDiagOpen(false)}
        onOk={() =>
          void diagnose.mutateAsync({
            body: { method: diagMethod as (typeof RATE_LIMIT_METHODS)[number], path: diagPath, principal },
          }).catch(() => undefined)
        }
        okText="执行诊断"
        confirmLoading={diagnose.isPending}
        width={640}
      >
        <Space vertical align="start" style={{ width: '100%' }}>
          <Select
            value={diagMethod}
            onChange={(v) => setDiagMethod(String(v))}
            optionList={RATE_LIMIT_METHODS.map((value) => ({ value, label: value }))}
          />
          <Input
            value={diagPath}
            onChange={setDiagPath}
            placeholder="实际请求路径，如 /api/users/42"
            style={{ width: '100%' }}
          />
          <RadioGroup value={principal} onChange={(e) => setPrincipal(e.target.value)}>
            <Radio value="anonymous">匿名</Radio>
            <Radio value="admin">管理员</Radio>
            <Radio value="member">会员</Radio>
            <Radio value="app">开放应用</Radio>
          </RadioGroup>
          {diagnose.data && (
            <>
              <Banner closeIcon={null} description={diagnose.data.note} />
              <Text>选中：{diagnose.data.selected.join('、') || '无路径规则'}</Text>
              {diagnose.data.matches.map((match) => (
                <Text key={match.name}>
                  {match.name} · {match.stage} · {match.reason}
                </Text>
              ))}
            </>
          )}
        </Space>
      </Modal>
      <Modal
        title="临时封禁身份"
        visible={banTarget !== null}
        onCancel={() => setBanTarget(null)}
        okText="封禁"
        confirmLoading={ban.isPending}
        onOk={() =>
          void ban
            .mutateAsync({
              body: { name: banName, key: banKey, durationSeconds: duration, reason: banReason || '管理员临时封禁' },
            })
            .then(() => setBanTarget(null))
            .catch(() => undefined)
        }
        width={480}
      >
        <Space vertical align="start" style={{ width: '100%' }}>
          <Select
            value={banName || undefined}
            placeholder="选择规则"
            optionList={rules.map((r) => ({ value: r.name, label: r.name }))}
            onChange={(v) => setBanName(String(v))}
            style={{ width: '100%' }}
          />
          <Input value={banKey} onChange={setBanKey} placeholder="精确计数身份：IP / u:platform:1 / m:3:7" />
          <Input value={banReason} onChange={setBanReason} placeholder="封禁原因" />
          <Select
            value={duration}
            onChange={(v) => setDuration(Number(v))}
            optionList={RATE_LIMIT_BAN_DURATION_OPTIONS}
          />
        </Space>
      </Modal>
    </div>
  );
}
