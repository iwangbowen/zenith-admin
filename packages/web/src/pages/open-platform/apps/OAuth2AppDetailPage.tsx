import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Modal,
  Skeleton,
  Space,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ArrowLeft } from 'lucide-react';
import dayjs from 'dayjs';
import type {
  AppWebhookSubscription,
  OAuth2Token,
  OAuth2UserGrant,
} from '@zenith/shared';
import {
  OPEN_APP_ENVIRONMENT_LABELS,
  OPEN_APP_REVIEW_STATUS_LABELS,
} from '@zenith/shared';
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
    stack: true,
  }), [palette, trend]);

  return (
    <div>
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
      <Card title="端点分布" style={{ marginTop: 16 }} loading={endpointsQuery.isFetching}>
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
              { title: '调用数', dataIndex: 'total', width: 120 },
              { title: '失败数', dataIndex: 'failed', width: 120 },
              { title: '平均耗时', dataIndex: 'avgDurationMs', width: 120, render: (value: number) => `${value} ms` },
            ]}
          />
        ) : <Empty description="暂无端点调用数据" />}
      </Card>
    </div>
  );
}

function GrantsTab({ appId }: Readonly<{ appId: number }>) {
  const [page, setPage] = useState(1);
  const query = useOAuth2AppGrants(appId, page, 10);
  const data = query.data;
  const columns: ColumnProps<OAuth2UserGrant>[] = [
    { title: '用户', dataIndex: 'nickname', render: (value: string | null, row) => value || row.username || `用户 ${row.userId}` },
    { title: '用户名', dataIndex: 'username', width: 160, render: (value: string | null) => value ?? '—' },
    { title: '授权 Scope', dataIndex: 'scopes', render: (values: string[]) => <Space wrap>{values.map((value) => <Tag key={value} size="small" color="blue">{value}</Tag>)}</Space> },
    { title: '首次授权', dataIndex: 'createdAt', width: 170 },
    { title: '最近更新', dataIndex: 'updatedAt', width: 170 },
  ];
  return (
    <ConfigurableTable
      bordered
      columns={columns}
      dataSource={data?.list ?? []}
      loading={query.isFetching}
      onRefresh={() => void query.refetch()}
      refreshLoading={query.isFetching}
      rowKey="id"
      empty="暂无用户授权记录"
      pagination={{
        currentPage: page,
        pageSize: 10,
        total: data?.total ?? 0,
        onPageChange: setPage,
      }}
    />
  );
}

function TokensTab({ clientId }: Readonly<{ clientId: string }>) {
  const [page, setPage] = useState(1);
  const query = useOAuth2AppTokens(clientId, page, 10);
  const revokeMutation = useRevokeOAuth2Token();
  const data = query.data;
  const columns: ColumnProps<OAuth2Token>[] = [
    { title: '令牌', dataIndex: 'tokenPrefix', render: (value: string | null) => value ?? '—' },
    { title: '类型', dataIndex: 'tokenType', width: 100, render: (value: string) => <Tag size="small">{value}</Tag> },
    { title: '用户 ID', dataIndex: 'userId', width: 100, render: (value: number | null) => value ?? '服务账号' },
    { title: 'Scope', dataIndex: 'scopes', render: (values: string[]) => <Space wrap>{values.map((value) => <Tag key={value} size="small" color="blue">{value}</Tag>)}</Space> },
    { title: '过期时间', dataIndex: 'expiresAt', width: 170, render: (value: string | null) => value ?? '永久' },
    {
      title: '状态',
      dataIndex: 'revoked',
      width: 90,
      fixed: 'right',
      render: (revoked: boolean) => <Tag size="small" color={revoked ? 'grey' : 'green'}>{revoked ? '已撤销' : '有效'}</Tag>,
    },
    createOperationColumn<OAuth2Token>({
      width: 90,
      actions: (record) => [{
        key: 'revoke',
        label: '撤销',
        danger: true,
        hidden: record.revoked,
        onClick: () => {
          Modal.confirm({
            title: '确认撤销该令牌？',
            content: '撤销后客户端必须重新获取令牌。',
            onOk: async () => {
              await revokeMutation.mutateAsync(record.id);
              Toast.success('令牌已撤销');
            },
          });
        },
      }],
    }),
  ];
  return (
    <ConfigurableTable
      bordered
      columns={columns}
      dataSource={data?.list ?? []}
      loading={query.isFetching}
      onRefresh={() => void query.refetch()}
      refreshLoading={query.isFetching}
      rowKey="id"
      empty="暂无已颁发令牌"
      pagination={{
        currentPage: page,
        pageSize: 10,
        total: data?.total ?? 0,
        onPageChange: setPage,
      }}
    />
  );
}

function WebhooksTab({ clientId }: Readonly<{ clientId: string }>) {
  const [page, setPage] = useState(1);
  const query = useWebhookList({ page, pageSize: 10, clientId });
  const data = query.data;
  const columns: ColumnProps<AppWebhookSubscription>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '回调地址', dataIndex: 'url' },
    { title: '事件', dataIndex: 'events', render: (values: string[]) => values.length ? `${values.length} 个事件` : '全部事件' },
    { title: '连续失败', dataIndex: 'consecutiveFailures', width: 100 },
    { title: '最近投递', dataIndex: 'lastDeliveryAt', width: 170, render: (value: string | null) => value ?? '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: string, row) => (
        <Tag size="small" color={value === 'enabled' ? 'green' : row.autoDisabledAt ? 'red' : 'grey'}>
          {row.autoDisabledAt ? '自动停用' : value === 'enabled' ? '启用' : '禁用'}
        </Tag>
      ),
    },
  ];
  return (
    <ConfigurableTable
      bordered
      columns={columns}
      dataSource={data?.list ?? []}
      loading={query.isFetching}
      onRefresh={() => void query.refetch()}
      refreshLoading={query.isFetching}
      rowKey="id"
      empty="该应用暂无 Webhook 订阅"
      pagination={{
        currentPage: page,
        pageSize: 10,
        total: data?.total ?? 0,
        onPageChange: setPage,
      }}
    />
  );
}

export default function OAuth2AppDetailPage() {
  const navigate = useNavigate();
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
        <Tag color={app.status === 'enabled' ? 'green' : 'grey'}>{app.status === 'enabled' ? '启用' : '禁用'}</Tag>
        <Text type="tertiary" copyable={{ content: app.clientId }}>{app.clientId}</Text>
      </div>
      <Tabs type="line" lazyRender keepDOM={false}>
        <TabPane tab="概览" itemKey="overview">
          <Descriptions
            row
            data={[
              { key: '应用名称', value: app.name },
              { key: '客户端类型', value: app.isPublic ? '公开客户端（PKCE）' : '机密客户端' },
              { key: '限流套餐', value: ratePlan?.name ?? '默认套餐' },
              { key: '运行环境', value: OPEN_APP_ENVIRONMENT_LABELS[app.environment] },
              { key: '审核状态', value: OPEN_APP_REVIEW_STATUS_LABELS[app.reviewStatus] },
              { key: '审核意见', value: app.reviewComment || '—' },
              { key: 'HMAC 签名', value: app.signEnabled ? '已启用' : '未启用' },
              { key: '授权类型', value: app.grantTypes.join('、') },
              { key: '允许 Scope', value: app.allowedScopes.join('、') },
              { key: '回调 URL', value: app.redirectUris.length ? app.redirectUris.join('\n') : '—' },
              { key: 'IP 白名单', value: app.ipAllowlist.length ? app.ipAllowlist.join('\n') : '不限制' },
              { key: '旧密钥有效期', value: app.previousSecretExpiresAt || '—' },
              { key: '描述', value: app.description || '—' },
              { key: '创建时间', value: app.createdAt },
              { key: '更新时间', value: app.updatedAt },
            ]}
          />
        </TabPane>
        <TabPane tab="调用统计" itemKey="stats"><AppStatsTab clientId={app.clientId} /></TabPane>
        <TabPane tab="授权用户" itemKey="grants"><GrantsTab appId={app.id} /></TabPane>
        <TabPane tab="令牌" itemKey="tokens"><TokensTab clientId={app.clientId} /></TabPane>
        <TabPane tab="Webhook" itemKey="webhooks"><WebhooksTab clientId={app.clientId} /></TabPane>
      </Tabs>
    </div>
  );
}
