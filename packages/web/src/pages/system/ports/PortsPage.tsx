import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Select, Space, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import type { PortEntry } from '@zenith/shared/ops';
import { hostQueryOf } from '@/hooks/queries/ops-hosts';
import { useKillPortProcess, usePortList } from '@/hooks/queries/ports';
import { ResetButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { HostSelector } from '@/components/HostSelector';
import { useOpsHostSelection } from '@/hooks/useOpsHostSelection';

function localDisplay(entry: PortEntry): string {
  const addr = entry.localAddress === '0.0.0.0' || entry.localAddress === '::' || entry.localAddress === '*' ? '*' : entry.localAddress;
  return `${addr}:${entry.localPort}`;
}

const REFRESH_OPTIONS = [
  { label: '自动刷新：关闭', value: 0 },
  { label: '自动刷新：5 秒', value: 5000 },
  { label: '自动刷新：10 秒', value: 10000 },
  { label: '自动刷新：30 秒', value: 30000 },
];

export default function PortsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canKill = hasPermission('system:process:kill');
  const [hostId, setHostId] = useOpsHostSelection();
  const [keyword, setKeyword] = useState('');
  const [protocol, setProtocol] = useState<string | undefined>();
  const [refreshInterval, setRefreshInterval] = useState(0);
  const listQuery = usePortList(refreshInterval > 0 ? refreshInterval : false, hostId);
  const all = listQuery.data ?? [];
  const killMutation = useKillPortProcess();
  const killingPid = killMutation.isPending ? (killMutation.variables?.params.pid ?? null) : null;

  const handleReset = () => { setKeyword(''); setProtocol(''); void listQuery.refetch(); };

  async function handleKill(pid: number) {
    await killMutation.mutateAsync({ params: { pid }, query: hostQueryOf(hostId) });
    Toast.success('进程已结束');
  }

  const kw = keyword.trim().toLowerCase();
  const data = all.filter((p) => {
    if (protocol && p.protocol !== protocol) return false;
    if (!kw) return true;
    return String(p.localPort).includes(kw)
      || (p.processName ?? '').toLowerCase().includes(kw)
      || (p.serviceName ?? '').toLowerCase().includes(kw)
      || p.localAddress.toLowerCase().includes(kw)
      || p.protocol.includes(kw);
  });

  const columns: ColumnProps<PortEntry>[] = [
    { title: '协议', dataIndex: 'protocol', width: 80, render: (v: string) => <Tag color="blue" size="small">{v.toUpperCase()}</Tag> },
    { title: '本地地址', width: 190, render: (_: unknown, r: PortEntry) => <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{localDisplay(r)}</span> },
    { title: '端口', dataIndex: 'localPort', width: 90, sorter: (a, b) => (a?.localPort ?? 0) - (b?.localPort ?? 0), render: (v: number) => <strong>{v}</strong> },
    { title: '服务', dataIndex: 'serviceName', width: 120, render: (v: string | null) => v ? <Tag color="cyan" size="small" type="light">{v}</Tag> : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span> },
    { title: '状态', dataIndex: 'state', width: 100, render: (v: string) => <Tag color={v === 'LISTEN' ? 'green' : 'orange'} size="small">{v}</Tag> },
    { title: 'PID', dataIndex: 'pid', width: 80, render: (v: number | null) => v ?? '—' },
    { title: '进程名', dataIndex: 'processName', render: (v: string | null) => v ?? '—' },
    createOperationColumn<PortEntry>({
      width: 210,
      emptyContent: <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
      actions: (record) => [
        {
          key: 'process',
          label: '查看进程',
          hidden: !record.pid,
          onClick: () => navigate(
            `/system/processes?pid=${record.pid}${hostId == null ? '' : `&hostId=${hostId}`}`,
          ),
        },
        {
          key: 'kill',
          label: '结束进程',
          danger: true,
          loading: killingPid === record.pid,
          hidden: !canKill || !record.pid,
          onClick: () => {
            confirmDanger({
              title: '结束该进程？',
              content: `将向 PID ${record.pid}（${record.processName ?? '未知'}）发送终止信号`,
              onOk: () => handleKill(record.pid as number),
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <HostSelector value={hostId} onChange={setHostId} />
            <KeywordInput placeholder="搜索端口/进程/服务/地址" value={keyword} onChange={setKeyword} width={240} />
            <FilterSelect
              placeholder="全部协议"
              items={[{ label: 'TCP', value: 'tcp' }, { label: 'UDP', value: 'udp' }]}
              value={protocol}
              onChange={setProtocol}
            />
            <Select value={refreshInterval} onChange={(v) => setRefreshInterval(v as number)} style={{ width: 180 }} optionList={REFRESH_OPTIONS} />
            <ResetButton onClick={handleReset} />
            <Space style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>共 {data.length} 个监听端口</Space>
          </>
        )}
        mobilePrimary={(
          <>
            <HostSelector value={hostId} onChange={setHostId} />
            <KeywordInput placeholder="搜索端口/进程/服务/地址" value={keyword} onChange={setKeyword} width={240} />
          </>
        )}
        mobileFilters={(
          <>
            <FilterSelect
              placeholder="全部协议"
              items={[{ label: 'TCP', value: 'tcp' }, { label: 'UDP', value: 'udp' }]}
              value={protocol}
              onChange={setProtocol}
            />
            <Select value={refreshInterval} onChange={(v) => setRefreshInterval(v as number)} style={{ width: 180 }} optionList={REFRESH_OPTIONS} />
          </>
        )}
        mobileActions={<ResetButton onClick={handleReset} />}
        filterTitle="端口筛选"
        actionTitle="端口操作"
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        rowKey={(r) => `${r?.protocol}-${r?.localAddress}-${r?.localPort}`}
        dataSource={data}
        columns={columns}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        empty="暂无监听端口数据"
        pagination={{ pageSize: 50, showSizeChanger: true }}
      />
    </div>
  );
}
