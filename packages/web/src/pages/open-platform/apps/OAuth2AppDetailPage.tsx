import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Empty, Skeleton, Space, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ArrowLeft } from 'lucide-react';
import dayjs from 'dayjs';
import type { AppWebhookSubscription, OAuth2Token, OAuth2UserGrant } from '@zenith/shared/open-platform';
import { OPEN_APP_ENVIRONMENT_LABELS, OPEN_APP_REVIEW_STATUS_LABELS } from '@zenith/shared/open-platform';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AreaChart, EmptyChart, chartOptions, makeAreaSpec, useChartPalette } from '@/components/charts';
import {
  useOAuth2AppDetail,
  useOAuth2AppGrants,
  useOAuth2AppTokens,
  useOAuth2RatePlans,
  useRevokeOAuth2Token,
} from '@/hooks/queries/oauth2-apps';
import {
  useOpenApiStatsByEndpoint,
  useOpenApiStatsOverview,
  useOpenApiStatsTrend,
  useWebhookList,
} from '@/hooks/queries/open-platform';
import { usePermission } from '@/hooks/usePermission';
import { confirmDanger } from '@/utils/confirm';
import { dateTimeColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { OpenPlatformPaginatedTab } from '../OpenPlatformPaginatedTab';

import { useUrlTabState } from '@/hooks/useUrlTabState';
const { Text, Title } = Typography;

function AppStatsTab({ clientId }: Readonly<{ clientId: string }>) {
  const palette = useChartPalette();
  const range = useMemo(() => ({
    startTime: dayjs().subtract(29, 'day').startOf('day').format('YYYY-MM-DD HH:mm:ss'),
    endTime: dayjs().endOf('day').format('YYYY-MM-DD HH:mm:ss'),
    clientId,
  }), [clientId]);
  const overviewQuery = useOpenApiStatsOverview(range);
  const trendQuery = useOpenApiStatsTrend({ ...range, granularity: 'day' });
  const endpointsQuery = useOpenApiStatsByEndpoint(range);
  const overview = overviewQuery.data;
  const trend = useMemo(() => trendQuery.data ?? [], [trendQuery.data]);
  const endpoints = endpointsQuery.data ?? [];
  const trendSpec = useMemo(() => makeAreaSpec({
    data: trend,
    xField: 'time',
    series: [
      { field: 'success', name: '成功', color: '#16a34a' },
      { field: 'failed', name: '失败', color: '#dc2626' },
    ],
    palette,
  }), [palette, trend]);

  return (
    <div className="zx-flat-panels">
      <Descriptions
        row
        data={[
          { key: '近 30 天调用', value: String(overview?.totalCalls ?? 0) },
          { key: '成功率', value: `${overview?.successRate ?? 0}%` },
          { key: '平均耗时', value: `${overview?.avgDurationMs ?? 0} ms` },
          { key: 'P95', value: `${overview?.p95DurationMs ?? 0} ms` },
          { key: 'P99', value: `${overview?.p99DurationMs ?? 0} ms` },
          { key: '今日调用', value: String(overview?.todayCalls ?? 0) },
        ]}
        style={{ marginBottom: 16 }}
      />
      <Card title="近 30 天调用趋势" loading={trendQuery.isFetching}>
        {trend.length ? <AreaChart {...trendSpec} options={chartOptions} height={280} /> : <EmptyChart height={280} />}
      </Card>
      <Card title="端点分布" loading={endpointsQuery.isFetching}>
        {endpoints.length ? (
          <ConfigurableTable
            bordered
            rowKey="key"
            pagination={false}
            onRefresh={() => void endpointsQuery.refetch()}
            refreshLoading={endpointsQuery.isFetching}
            dataSource={endpoints}
            columns={[
              { title: '端点', dataIndex: 'label' },
              { title: '调用数', dataIndex: 'total', width: 120, align: 'right' },
              { title: '失败数', dataIndex: 'failed', width: 120 },
              { title: '平均耗时', dataIndex: 'avgDurationMs', width: 120, align: 'right', render: (value: number) => `${value} ms` },
            ]}
          />
        ) : <Empty description="暂无端点调用数据" />}
      </Card>
    </div>
  );
}

function GrantsTab({ appId }: Readonly<{ appId: number }>) {
  const useList = (page: number, pageSize: number) => useOAuth2AppGrants(appId, page, pageSize);
  const columns: ColumnProps<OAuth2UserGrant>[] = [
    { title: '用户', dataIndex: 'nickname', render: (value: string | null, row) => value || row.username || `用户 ${row.userId}` },
    { title: '用户名', dataIndex: 'username', width: 160, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '授权 Scope', dataIndex: 'scopes', render: (values: string[]) => <Space wrap>{values.map((value) => <Tag key={value} size="small" color="blue">{value}</Tag>)}</Space> },
    dateTimeColumn('首次授权', 'createdAt'),
    dateTimeColumn('最近更新', 'updatedAt'),
  ];
  return (
    <OpenPlatformPaginatedTab
      useList={useList}
      columns={columns}
      rowKey="id"
      empty="暂无用户授权记录"
    />
  );
}

function TokensTab({ clientId, canManage }: Readonly<{ clientId: string; canManage: boolean }>) {
  const useList = (page: number, pageSize: number) => useOAuth2AppTokens(clientId, page, pageSize);
  const revokeMutation = useRevokeOAuth2Token();
  const columns: ColumnProps<OAuth2Token>[] = [
    { title: '令牌', dataIndex: 'tokenPrefix', render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '类型', dataIndex: 'tokenType', width: 100, render: (value: string) => <Tag size="small">{value}</Tag> },
    { title: '用户 ID', dataIndex: 'userId', width: 100, render: (value: number | null) => value ?? '服务账号' },
    { title: 'Scope', dataIndex: 'scopes', render: (values: string[]) => <Space wrap>{values.map((value) => <Tag key={value} size="small" color="blue">{value}</Tag>)}</Space> },
    dateTimeColumn('过期时间', 'expiresAt', { empty: '永久' }),
    {
      title: '状态',
      dataIndex: 'revoked',
      width: 90,
      fixed: 'right',
      render: (revoked: boolean) => <Tag size="small" color={revoked ? 'grey' : 'green'}>{revoked ? '已撤销' : '有效'}</Tag>,
    },
    createOperationColumn<OAuth2Token>({
      width: 100,
      actions: (record) => [{
        key: 'revoke',
        label: '撤销',
        danger: true,
        hidden: record.revoked || !canManage,
        onClick: () => {
          confirmDanger({
            title: '确认撤销该令牌？',
            content: '撤销后客户端必须重新获取令牌。',
            onOk: async () => {
              await revokeMutation.mutateAsync({ params: { id: record.id } });
              Toast.success('令牌已撤销');
            },
          });
        },
      }],
    }),
  ];
  return (
    <OpenPlatformPaginatedTab
      useList={useList}
      columns={columns}
      rowKey="id"
      empty="暂无已颁发令牌"
    />
  );
}

function WebhooksTab({ clientId }: Readonly<{ clientId: string }>) {
  const useList = (page: number, pageSize: number) => useWebhookList({ page, pageSize, clientId });
  const columns: ColumnProps<AppWebhookSubscription>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '回调地址', dataIndex: 'url' },
    { title: '事件', dataIndex: 'events', render: (values: string[]) => values.length ? `${values.length} 个事件` : '全部非支付事件' },
    { title: '连续失败', dataIndex: 'consecutiveFailures', width: 100 },
    dateTimeColumn('最近投递', 'lastDeliveryAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (value: string, row) => (
        // eslint-disable-next-line no-restricted-syntax -- 三态：启用 / 自动停用（红）/ 禁用
        <Tag size="small" color={value === 'enabled' ? 'green' : row.autoDisabledAt ? 'red' : 'grey'}>
          {row.autoDisabledAt ? '自动停用' : value === 'enabled' ? '启用' : '禁用'}
        </Tag>
      ),
    },
  ];
  return (
    <OpenPlatformPaginatedTab
      useList={useList}
      columns={columns}
      rowKey="id"
      empty="该应用暂无 Webhook 订阅"
    />
  );
}

export default function OAuth2AppDetailPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['overview', 'stats', 'grants', 'tokens', 'webhooks'] as const, 'overview');
  const navigate = useNavigate();
  const { hasPermission, hasAnyPermission } = usePermission();
  const canManage = hasPermission('system:oauth2-apps:manage');
  const canViewStats = hasPermission('open:stats:view');
  const canViewWebhooks = hasAnyPermission('open:webhook:view', 'open:webhook:manage');
  const id = Number(useParams<{ id: string }>().id);
  const detailQuery = useOAuth2AppDetail(Number.isFinite(id) ? id : undefined);
  const ratePlans = useOAuth2RatePlans().data ?? [];
  const app = detailQuery.data;

  if (!Number.isFinite(id)) return <Empty description="应用 ID 无效" />;
  if (detailQuery.isLoading) {
    return <div className="page-container"><Skeleton placeholder={<Skeleton.Paragraph rows={8} />} loading active /></div>;
  }
  if (!app) return <div className="page-container"><Empty description="应用不存在" /></div>;
  const ratePlan = ratePlans.find((item) => item.id === app.ratePlanId);

  return (
    <div className="page-container page-tabs-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Button theme="borderless" icon={<ArrowLeft size={16} />} onClick={() => navigate('/system/oauth2-apps')}>返回</Button>
        <Title heading={4} style={{ margin: 0 }}>{app.name}</Title>
        {/* eslint-disable-next-line no-restricted-syntax -- 页头标签与标题同排，保留默认尺寸（renderEnabledStatusTag 为表格用的 small） */}
        <Tag color={app.status === 'enabled' ? 'green' : 'grey'}>{app.status === 'enabled' ? '启用' : '禁用'}</Tag>
        <Text type="tertiary" copyable={{ content: app.clientId }}>{app.clientId}</Text>
      </div>
      <Tabs collapsible="auto" type="line" lazyRender keepDOM={false} activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        <TabPane tab="概览" itemKey="overview">
          <Descriptions
            align="plain"
            layout="horizontal"
            column={2}
            style={{ width: '100%' }}
            data={[
              { key: '应用名称', value: app.name },
              { key: '客户端类型', value: app.isPublic ? '公开客户端（PKCE）' : '机密客户端' },
              { key: '限流套餐', value: ratePlan?.name ?? '默认套餐' },
              { key: '运行环境', value: OPEN_APP_ENVIRONMENT_LABELS[app.environment] },
              { key: '审核状态', value: OPEN_APP_REVIEW_STATUS_LABELS[app.reviewStatus] },
              { key: 'AppKey 签名通道', value: app.signEnabled ? '已开启（强制签名）' : '未开启（仅 Bearer）' },
              { key: '旧密钥有效期', value: app.previousSecretExpiresAt || EMPTY_PLACEHOLDER },
              { key: '创建时间', value: app.createdAt },
              { key: '更新时间', value: app.updatedAt },
              { key: '审核意见', value: app.reviewComment || EMPTY_PLACEHOLDER, span: 2 },
              { key: '授权类型', value: app.grantTypes.join('、'), span: 2 },
              { key: '允许 Scope', value: app.allowedScopes.join('、'), span: 2 },
              { key: '回调 URL', value: app.redirectUris.length ? app.redirectUris.join('\n') : EMPTY_PLACEHOLDER, span: 2 },
              { key: 'IP 白名单', value: app.ipAllowlist.length ? app.ipAllowlist.join('\n') : '不限制', span: 2 },
              { key: '描述', value: app.description || EMPTY_PLACEHOLDER, span: 2 },
            ]}
          />
        </TabPane>
        {canViewStats && <TabPane tab="调用统计" itemKey="stats"><AppStatsTab clientId={app.clientId} /></TabPane>}
        <TabPane tab="授权用户" itemKey="grants"><GrantsTab appId={app.id} /></TabPane>
        <TabPane tab="令牌" itemKey="tokens"><TokensTab clientId={app.clientId} canManage={canManage} /></TabPane>
        {canViewWebhooks && <TabPane tab="Webhook" itemKey="webhooks"><WebhooksTab clientId={app.clientId} /></TabPane>}
      </Tabs>
    </div>
  );
}
