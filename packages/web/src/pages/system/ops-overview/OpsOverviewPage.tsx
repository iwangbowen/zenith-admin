import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Card, Empty, List, Space, Tag, Typography } from '@douyinfe/semi-ui';
import {
  Activity, Container, Cpu, FileText, Flame, Globe, HardDrive as DiskIcon,
  Lock, MemoryStick, Monitor, Network, Server, Settings, Shield, TerminalSquare, Wifi,
} from 'lucide-react';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { RefreshButton } from '@/components/toolbar-controls';
import PageLoading from '@/components/PageLoading';
import type { OpsOverview, OpsOverviewSection } from '@zenith/shared/ops';
import { useOpsOverview } from '@/hooks/queries/ops-overview';
import ConfigurableTable from '@/components/ConfigurableTable';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatBytes } from '@zenith/shared/core';

const { Text } = Typography;

const DANGER = 'var(--semi-color-danger)';
const WARNING = 'var(--semi-color-warning)';
const SUCCESS = 'var(--semi-color-success)';

function usageAccent(percent: number | null | undefined): string {
  if (percent == null) return SUCCESS;
  if (percent >= 90) return DANGER;
  if (percent >= 75) return WARNING;
  return SUCCESS;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d} 天 ${h} 小时`;
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

/** 组件可用性行:可用显示状态徽章,不可用显示降级原因 */
interface CapabilityRow {
  key: string;
  icon: React.ReactNode;
  label: string;
  path: string;
  section: OpsOverviewSection<unknown>;
  render: () => React.ReactNode;
}

type HostMatrixItem = NonNullable<OpsOverview['hosts']['data']>[number];

function buildCapabilityRows(data: OpsOverview): CapabilityRow[] {
  return [
    {
      key: 'docker',
      icon: <Container size={16} />,
      label: 'Docker',
      path: '/system/docker',
      section: data.docker,
      render: () => {
        const d = data.docker.data;
        if (!d) return null;
        return (
          <Space>
            <Tag color="green">运行 {d.running}</Tag>
            {d.stopped > 0 && <Tag color="grey">停止 {d.stopped}</Tag>}
          </Space>
        );
      },
    },
    {
      key: 'services',
      icon: <Settings size={16} />,
      label: 'systemd 服务',
      path: '/system/services',
      section: data.services,
      render: () => {
        const d = data.services.data;
        if (!d) return null;
        return (
          <Space>
            <Tag color="green">活动 {d.active}</Tag>
            {d.failed > 0 ? <Tag color="red">失败 {d.failed}</Tag> : <Tag color="grey">共 {d.total}</Tag>}
          </Space>
        );
      },
    },
    {
      key: 'nginx',
      icon: <Globe size={16} />,
      label: 'Nginx',
      path: '/system/nginx-sites',
      section: data.nginx,
      render: () => {
        const d = data.nginx.data;
        if (!d) return null;
        return (
          <Space>
            <Tag color={d.running ? 'green' : 'red'}>{d.running ? '运行中' : '已停止'}</Tag>
            <Tag color="grey">站点 {d.enabledCount}/{d.siteCount}</Tag>
            {d.version && <Text type="tertiary" size="small">v{d.version}</Text>}
          </Space>
        );
      },
    },
    {
      key: 'firewall',
      icon: <Shield size={16} />,
      label: '防火墙',
      path: '/system/firewall',
      section: data.firewall,
      render: () => {
        const d = data.firewall.data;
        if (!d) return null;
        return (
          <Space>
            <Tag color={d.enabled ? 'green' : 'orange'}>{d.enabled ? '已启用' : '未启用'}</Tag>
            <Tag color="grey">{d.type}</Tag>
          </Space>
        );
      },
    },
    {
      key: 'database',
      icon: <Activity size={16} />,
      label: 'PostgreSQL / Redis',
      path: '/system/db-admin',
      section: data.host,
      render: () => {
        const d = data.host.data;
        if (!d) return null;
        return (
          <Space>
            <Tag color={d.databaseOk ? 'green' : 'red'}>
              PG {d.databaseOk ? '正常' : '异常'}{d.databaseConnections != null ? ` · ${d.databaseConnections} 连接` : ''}
            </Tag>
            <Tag color={d.redisOk ? 'green' : 'red'}>Redis {d.redisOk ? '正常' : '异常'}</Tag>
          </Space>
        );
      },
    },
  ];
}

const QUICK_ENTRIES = [
  { icon: <TerminalSquare size={14} />, label: 'Web 终端', path: '/system/terminal' },
  { icon: <Monitor size={14} />, label: '终端会话', path: '/system/terminal/sessions' },
  { icon: <DiskIcon size={14} />, label: '文件管理器', path: '/system/file-manager' },
  { icon: <Cpu size={14} />, label: '进程管理', path: '/system/processes' },
  { icon: <Network size={14} />, label: '端口监听', path: '/system/ports' },
  { icon: <Container size={14} />, label: 'Docker', path: '/system/docker' },
  { icon: <Settings size={14} />, label: '服务管理', path: '/system/services' },
  { icon: <FileText size={14} />, label: '日志查看器', path: '/system/log-viewer' },
  { icon: <Wifi size={14} />, label: '网络诊断', path: '/system/network-diag' },
  { icon: <Shield size={14} />, label: '防火墙', path: '/system/firewall' },
  { icon: <Globe size={14} />, label: 'Nginx 站点', path: '/system/nginx-sites' },
  { icon: <Lock size={14} />, label: 'SSL 证书', path: '/system/ssl-certificates' },
  { icon: <Activity size={14} />, label: '服务监控', path: '/system/monitor' },
  { icon: <Server size={14} />, label: '主机管理', path: '/system/hosts' },
];

export default function OpsOverviewPage() {
  const navigate = useNavigate();
  const overviewQuery = useOpsOverview();
  const data = overviewQuery.data;

  const capabilityRows = useMemo(() => (data ? buildCapabilityRows(data) : []), [data]);

  if (!data) {
    if (overviewQuery.isError) {
      return (
        <div className="page-container" style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
          <Empty title="概览加载失败" description={(overviewQuery.error as Error | null)?.message} />
        </div>
      );
    }
    // 统一页面加载形态:跟随偏好设置(loadingStyle),并在内容区居中
    return <PageLoading inline />;
  }

  const host = data.host.data;
  const remoteHosts = data.hosts.data ?? [];
  const failedServices = data.services.data?.failed ?? 0;
  const sslRisk = (data.ssl.data?.expiring ?? 0) + (data.ssl.data?.expired ?? 0);

  return (
    <div className="page-container zx-flat-panels" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <Typography.Title heading={5} style={{ margin: 0 }}>运维概览</Typography.Title>
          {host && (
            <Text type="tertiary" size="small">
              {host.hostname} · {host.platform} · 已运行 {fmtUptime(host.uptimeSeconds)}
            </Text>
          )}
        </Space>
        <Space>
          <Text type="tertiary" size="small">生成于 {data.generatedAt}</Text>
          <RefreshButton onClick={() => void overviewQuery.refetch()} loading={overviewQuery.isFetching} />
        </Space>
      </div>

      {!data.host.available && (
        <Banner type="warning" closeIcon={null} fullMode={false} description={`主机指标不可用:${data.host.reason}`} />
      )}

      <StatGrid minItemWidth={168}>
        <StatCard
          title="CPU 使用率"
          value={host ? `${host.cpuUsage.toFixed(0)}%` : '—'}
          sub={host ? `${host.cpuCores} 核 · 负载 ${host.load1.toFixed(2)}` : undefined}
          icon={<Cpu size={19} />}
          accent={usageAccent(host?.cpuUsage)}
          onClick={() => navigate('/system/monitor')}
        />
        <StatCard
          title="内存使用率"
          value={host ? `${host.memUsagePercent}%` : '—'}
          sub={host ? `${formatBytes(host.memUsed)} / ${formatBytes(host.memTotal)}` : undefined}
          icon={<MemoryStick size={19} />}
          accent={usageAccent(host?.memUsagePercent)}
          onClick={() => navigate('/system/monitor')}
        />
        <StatCard
          title="主磁盘"
          value={host?.diskUsagePercent != null ? `${host.diskUsagePercent}%` : '—'}
          sub={host?.diskTotal != null ? `${formatBytes(host.diskUsed ?? 0)} / ${formatBytes(host.diskTotal)}` : undefined}
          icon={<DiskIcon size={19} />}
          accent={usageAccent(host?.diskUsagePercent)}
          onClick={() => navigate('/system/monitor')}
        />
        <StatCard
          title="失败服务"
          value={data.services.available ? failedServices : '—'}
          icon={<Flame size={19} />}
          accent={failedServices > 0 ? DANGER : SUCCESS}
          onClick={() => navigate('/system/services')}
        />
        <StatCard
          title="证书风险"
          value={data.ssl.available ? sslRisk : '—'}
          sub={data.ssl.data ? `共 ${data.ssl.data.total} 张` : undefined}
          icon={<Lock size={19} />}
          accent={sslRisk > 0 ? WARNING : SUCCESS}
          onClick={() => navigate('/system/ssl-certificates')}
        />
        <StatCard
          title="活动终端"
          value={data.terminals.available ? (data.terminals.data?.active ?? 0) : '—'}
          icon={<Monitor size={19} />}
          onClick={() => navigate('/system/terminal/sessions')}
        />
        <StatCard
          title="监听端口"
          value={data.ports.available ? (data.ports.data?.listening ?? 0) : '—'}
          icon={<Network size={19} />}
          onClick={() => navigate('/system/ports')}
        />
      </StatGrid>

      <Card title="组件状态" bodyStyle={{ padding: '4px 16px 12px' }}>
        <List
          dataSource={capabilityRows}
          renderItem={(row) => (
            <List.Item
              main={(
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(row.path)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(row.path); }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer', gap: 12 }}
                >
                  <Space>
                    {row.icon}
                    <Text strong>{row.label}</Text>
                  </Space>
                  {row.section.available
                    ? row.render()
                    : <Text type="tertiary" size="small">{row.section.reason ?? '不可用'}</Text>}
                </div>
              )}
            />
          )}
        />
      </Card>

      <Card
        title={(
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>远程主机健康矩阵</span>
            <Button theme="borderless" onClick={() => navigate('/system/hosts')}>主机管理</Button>
          </div>
        )}
        bodyStyle={{ padding: '4px 0 12px' }}
      >
        <ConfigurableTable
          bordered
          rowKey="id"
          pagination={false}
          dataSource={remoteHosts}
          columns={[
            { title: '主机', dataIndex: 'name', width: 150 },
            { title: '连接地址', dataIndex: 'address', width: 220 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => (
                <Tag color={value === 'online' ? 'green' : value === 'offline' ? 'red' : 'grey'}>
                  {value === 'online' ? '在线' : value === 'offline' ? '离线' : '未探测'}
                </Tag>
              ),
            },
            {
              title: 'CPU / 负载',
              width: 130,
              render: (_value: unknown, record: HostMatrixItem) =>
                record.snapshot ? `${record.snapshot.cpuCores ?? '—'} 核 / ${record.snapshot.load1 ?? '—'}` : '—',
            },
            {
              title: '内存',
              width: 100,
              render: (_value: unknown, record: HostMatrixItem) =>
                record.snapshot?.memUsagePercent == null ? '—' : `${record.snapshot.memUsagePercent}%`,
            },
            {
              title: '磁盘',
              width: 100,
              render: (_value: unknown, record: HostMatrixItem) =>
                record.snapshot?.diskUsagePercent == null ? '—' : `${record.snapshot.diskUsagePercent}%`,
            },
            {
              title: '最近采集',
              dataIndex: 'probedAt',
              width: 180,
              render: (value: string | null, record: HostMatrixItem) =>
                value ?? record.probeError ?? '从未探测',
            },
          ] satisfies ColumnProps<HostMatrixItem>[]}
          onRefresh={() => void overviewQuery.refetch()}
          refreshLoading={overviewQuery.isFetching}
          empty={data.hosts.available ? '尚未配置远程主机' : (data.hosts.reason ?? '主机矩阵不可用')}
        />
      </Card>

      <Card title="快捷入口" bodyStyle={{ padding: '12px 16px 16px' }}>
        <Space wrap>
          {QUICK_ENTRIES.map((entry) => (
            <Tag
              key={entry.path}
              size="large"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(entry.path)}
            >
              <Space spacing={4}>{entry.icon}{entry.label}</Space>
            </Tag>
          ))}
        </Space>
      </Card>
    </div>
  );
}
