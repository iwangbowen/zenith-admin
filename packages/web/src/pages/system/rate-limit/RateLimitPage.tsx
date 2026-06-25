import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Popconfirm,
  Space,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Gauge, Plus, RotateCcw, ShieldOff, Zap } from 'lucide-react';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';

const { Title, Text } = Typography;

type RateLimitKeyType = 'ip' | 'user' | 'ip_path';

interface RateLimitRule {
  id: number;
  name: string;
  description: string | null;
  windowMs: number;
  limit: number;
  keyType: RateLimitKeyType;
  enabled: boolean;
  blockedMessage: string | null;
  pathPatterns: string[];
  createdAt: string;
  updatedAt: string;
}

interface RecentBlock {
  at: string;
  key: string;
  path: string;
}
interface RateLimitStatItem {
  name: string;
  description: string | null;
  windowMs: number;
  limit: number;
  keyType: string;
  enabled: boolean;
  hitCount: number;
  blockedCount: number;
  blockRate: number;
  recentBlocks: RecentBlock[];
  hourlySeries: { hour: string; hits: number; blocked: number }[];
}

interface RateLimitStats {
  items: RateLimitStatItem[];
}

interface UpdateForm {
  windowMs: number;
  limit: number;
  keyType: RateLimitKeyType;
  enabled: boolean;
  blockedMessage: string | null;
  pathPatterns: string[];
}

interface CreateForm {
  name: string;
  description: string | null;
  windowMs: number;
  limit: number;
  keyType: RateLimitKeyType;
  enabled: boolean;
  blockedMessage: string | null;
  pathPatterns: string[];
}

const PREDEFINED_NAMES = new Set(['auth', 'captcha', 'sensitive']);

const KEY_TYPE_OPTIONS = [
  { label: 'IP 地址', value: 'ip' },
  { label: '登录用户', value: 'user' },
  { label: 'IP + 路径', value: 'ip_path' },
];

function formatWindow(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟`;
  const hr = Math.floor(min / 60);
  return `${hr} 小时`;
}

export default function RateLimitPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:rate-limit:manage');
  const [rules, setRules] = useState<RateLimitRule[]>([]);
  const [stats, setStats] = useState<RateLimitStats>({ items: [] });
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<RateLimitRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [formApi, setFormApi] = useState<FormApi<UpdateForm> | null>(null);
  const [createFormApi, setCreateFormApi] = useState<FormApi<CreateForm> | null>(null);
  const [apiPaths, setApiPaths] = useState<{ label: string; value: string }[]>([]);

  // 加载 OpenAPI 路径列表（用于路径绑定选择器）
  useEffect(() => {
    fetch('/api/openapi.json')
      .then((r) => r.json())
      .then((spec: { paths?: Record<string, unknown> }) => {
        if (spec?.paths) {
          const opts = Object.keys(spec.paths)
            .filter((p) => p.startsWith('/api/'))
            .sort((a, b) => a.localeCompare(b))
            .map((p) => ({ label: p, value: p }));
          setApiPaths(opts);
        }
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, statsRes] = await Promise.all([
        request.get<RateLimitRule[]>('/api/rate-limit/rules'),
        request.get<RateLimitStats>('/api/rate-limit/stats'),
      ]);
      if (rulesRes.code === 0) setRules(rulesRes.data);
      if (statsRes.code === 0) setStats(statsRes.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 自动刷新统计（30s）
  useEffect(() => {
    const timer = setInterval(() => { fetchData(); }, 30 * 1000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const handleSave = async () => {
    if (!editing || !formApi) return;
    try {
      const values = await formApi.validate();
      const res = await request.patch<RateLimitRule>(`/api/rate-limit/rules/${editing.id}`, values);
      if (res.code === 0) {
        Toast.success('规则已更新');
        setEditing(null);
        await fetchData();
      }
    } catch { /* validation error */ }
  };

  const handleCreate = async () => {
    if (!createFormApi) return;
    try {
      const values = await createFormApi.validate();
      const res = await request.post<RateLimitRule>('/api/rate-limit/rules', values);
      if (res.code === 0) {
        Toast.success('规则已创建');
        setCreating(false);
        await fetchData();
      }
    } catch { /* validation error */ }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete<null>(`/api/rate-limit/rules/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      await fetchData();
    }
  };

  const handleUnblock = async (name: string, key: string) => {
    const res = await request.post<null>('/api/rate-limit/unblock', { name, key });
    if (res.code === 0) {
      Toast.success(`已解封：${key}`);
      await fetchData();
    }
  };

  const handleResetStats = async (name: string) => {
    const res = await request.post<null>('/api/rate-limit/reset-stats', { name });
    if (res.code === 0) {
      Toast.success('统计已清空');
      await fetchData();
    }
  };

  const statsByName = new Map(stats.items.map((s) => [s.name, s]));

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Text type="tertiary" style={{ fontSize: 13 }}>
              管理 API 接口限流规则，保存后立即热更新到运行中的服务，无需重启。统计每 30 秒自动刷新。
            </Text>
            {canManage && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                新增规则
              </Button>
            )}
            <Button type="primary" icon={<RotateCcw size={14} />} onClick={fetchData} loading={loading}>
              刷新
            </Button>
          </>
        )}
        mobilePrimary={(
          <>
            {canManage && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                新增规则
              </Button>
            )}
            <Button type="primary" icon={<RotateCcw size={14} />} onClick={fetchData} loading={loading}>
              刷新
            </Button>
          </>
        )}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 16, marginTop: 16 }}>
        {rules.map((rule) => {
          const stat = statsByName.get(rule.name);
          const hit = stat?.hitCount ?? 0;
          const blocked = stat?.blockedCount ?? 0;
          const rate = stat?.blockRate ?? 0;
          return (
            <Card
              key={rule.id}
              style={{ borderTop: `3px solid ${rule.enabled ? 'var(--semi-color-success)' : 'var(--semi-color-disabled-text)'}` }}
              title={
                <Space>
                  <Gauge size={16} />
                  <span style={{ fontWeight: 600 }}>{rule.name}</span>
                  {rule.enabled
                    ? <Tag size="small" color="green">启用中</Tag>
                    : <Tag size="small" color="grey">已禁用</Tag>}
                </Space>
              }
              headerExtraContent={
                canManage && (
                  <Space>
                    <Button size="small" theme="borderless" onClick={() => setEditing(rule)}>编辑</Button>
                    {!PREDEFINED_NAMES.has(rule.name) && (
                      <Popconfirm title="确定删除该自定义规则？" onConfirm={() => handleDelete(rule.id)}>
                        <Button size="small" theme="borderless" type="danger">删除</Button>
                      </Popconfirm>
                    )}
                    <Popconfirm title="确定清空该规则的统计计数器？" onConfirm={() => handleResetStats(rule.name)}>
                      <Button size="small" theme="borderless" type="danger">重置统计</Button>
                    </Popconfirm>
                  </Space>
                )
              }
            >
              {rule.description && (
                <Text type="tertiary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  {rule.description}
                </Text>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <InfoBlock label="时间窗口" value={formatWindow(rule.windowMs)} />
                <InfoBlock label="窗口内上限" value={`${rule.limit} 次`} />
                <InfoBlock label="计数维度" value={KEY_TYPE_OPTIONS.find((o) => o.value === rule.keyType)?.label ?? rule.keyType} />
                <InfoBlock label="拦截率" value={`${rate}%`} />
              </div>
              <div style={{ display: 'flex', gap: 24, paddingTop: 8, borderTop: '1px solid var(--semi-color-border)' }}>
                <Stat icon={<Zap size={14} />} label="命中" value={hit} />
                <Stat icon={<ShieldOff size={14} />} label="拦截" value={blocked} danger={blocked > 0} />
              </div>
            </Card>
          );
        })}
      </div>

      <Title heading={5} style={{ marginTop: 32, marginBottom: 12 }}>近 24 小时拦截趋势</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
        {stats.items.map((item) => {
          const totalHits = item.hourlySeries.reduce((acc, p) => acc + p.hits, 0);
          const totalBlocked = item.hourlySeries.reduce((acc, p) => acc + p.blocked, 0);
          return (
            <Card
              key={`trend-${item.name}`}
              title={
                <Space>
                  <span style={{ fontWeight: 600 }}>{item.name}</span>
                  <Tag size="small" color="blue">命中 {totalHits.toLocaleString()}</Tag>
                  <Tag size="small" color="red">拦截 {totalBlocked.toLocaleString()}</Tag>
                </Space>
              }
              bodyStyle={{ padding: '8px 12px 12px' }}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={item.hourlySeries} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--semi-color-border)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={3} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="hits" name="命中" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="blocked" name="拦截" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          );
        })}
      </div>

      <Title heading={5} style={{ marginTop: 32, marginBottom: 12 }}>最近拦截记录</Title>
      <ConfigurableTable
        bordered
        rowKey="_rowId"
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        dataSource={stats.items.flatMap((s) =>
          s.recentBlocks.map((b, idx) => ({
            _rowId: `${s.name}-${b.at}-${b.key}-${idx}`,
            rule: s.name,
            at: b.at,
            key: b.key,
            path: b.path,
          })),
        )}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: '规则', dataIndex: 'rule', width: 120, render: (v: string) => <Tag color="blue" size="small">{v}</Tag> },
          { title: '拦截时间', dataIndex: 'at', width: 180 },
          { title: '触发 Key', dataIndex: 'key', render: (v: string) => <Text copyable>{v}</Text> },
          { title: '请求路径', dataIndex: 'path', render: (v: string) => <Text code>{v || '-'}</Text> },
          createOperationColumn<{ _rowId: string; rule: string; at: string; key: string; path: string }>({
            width: 120,
            emptyContent: <span style={{ color: 'var(--semi-color-text-3)' }}>—</span>,
            actions: (row) => [
              {
                key: 'unblock',
                label: '解封',
                hidden: !canManage,
                onClick: () => handleUnblock(row.rule, row.key),
              },
            ],
          }),
        ]}
      />

      <AppModal
        title="新增限流规则"
        visible={creating}
        onCancel={() => setCreating(false)}
        onOk={handleCreate}
        okText="创建（立即生效）"
        cancelText="取消"
        width={520}
      >
        <Form<CreateForm>
          getFormApi={setCreateFormApi}
          allowEmpty
          initValues={{ name: '', description: null, keyType: 'ip', enabled: true, windowMs: 60000, limit: 30, blockedMessage: null, pathPatterns: [] }}
          labelPosition="left"
          labelWidth={130}
        >
          <Form.Input
            field="name"
            label="规则名称"
            placeholder="小写字母/数字/下划线/连字符，如 upload"
            rules={[
              { required: true, message: '请输入规则名称' },
              { pattern: /^[a-z][a-z0-9_-]*$/, message: '只能小写字母、数字、下划线、连字符，且以字母开头' },
            ]}
          />
          <Form.Input field="description" label="描述" placeholder="可选" />
          <Form.Select
            field="pathPatterns"
            label="绑定路径"
            placeholder="选择或输入路径，支持 /* 通配符，留空则不自动应用"
            multiple
            filter
            allowCreate
            showClear
            searchPosition="dropdown"
            style={{ width: '100%' }}
            optionList={apiPaths}
            virtualize={{ height: 260, width: '100%', itemSize: 36 }}
          />
          <Form.Switch field="enabled" label="启用" />
          <Form.InputNumber field="windowMs" label="时间窗口(ms)" min={1000} step={1000} style={{ width: '100%' }} rules={[{ required: true }]} />
          <Form.InputNumber field="limit" label="窗口内上限" min={1} style={{ width: '100%' }} rules={[{ required: true }]} />
          <Form.Select
            field="keyType"
            label="计数维度"
            optionList={KEY_TYPE_OPTIONS}
            style={{ width: '100%' }}
          />
          <Form.Input field="blockedMessage" label="拦截提示文案" placeholder="为空使用默认提示" />
        </Form>
      </AppModal>

      <AppModal
        title={editing ? `编辑限流规则：${editing.name}` : ''}
        visible={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={handleSave}
        okText="保存（立即生效）"
        cancelText="取消"
        width={520}
      >
        {editing && (
          <Form<UpdateForm>
            getFormApi={setFormApi}
            allowEmpty
            initValues={{
              windowMs: editing.windowMs,
              limit: editing.limit,
              keyType: editing.keyType,
              enabled: editing.enabled,
              blockedMessage: editing.blockedMessage,
              pathPatterns: editing.pathPatterns ?? [],
            }}
            labelPosition="left"
            labelWidth={130}
          >
            <Form.Select
              field="pathPatterns"
              label="绑定路径"
              placeholder="选择或输入路径，支持 /* 通配符，留空则不自动应用"
              multiple
              filter
              allowCreate
              showClear
              searchPosition="dropdown"
              style={{ width: '100%' }}
              optionList={apiPaths}
              virtualize={{ height: 260, width: '100%', itemSize: 36 }}
            />
            <Form.Switch field="enabled" label="启用" />
            <Form.InputNumber field="windowMs" label="时间窗口(ms)" min={1000} step={1000} style={{ width: '100%' }} rules={[{ required: true }]} />
            <Form.InputNumber field="limit" label="窗口内上限" min={1} style={{ width: '100%' }} rules={[{ required: true }]} />
            <Form.Select field="keyType" label="计数维度" optionList={KEY_TYPE_OPTIONS} style={{ width: '100%' }} />
            <Form.Input field="blockedMessage" label="拦截提示文案" placeholder="为空使用默认提示" />
          </Form>
        )}
      </AppModal>
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

function Stat({ icon, label, value, danger }: { readonly icon: React.ReactNode; readonly label: string; readonly value: number; readonly danger?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: danger ? 'var(--semi-color-danger)' : 'var(--semi-color-text-2)' }}>{icon}</span>
      <Text type="tertiary" style={{ fontSize: 12 }}>{label}</Text>
      <Text strong style={{ color: danger ? 'var(--semi-color-danger)' : undefined }}>{value.toLocaleString()}</Text>
    </div>
  );
}
