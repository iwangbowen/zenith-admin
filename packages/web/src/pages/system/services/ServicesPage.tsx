import { useState, useEffect, useRef } from 'react';
import { Button, Tag, Toast, SideSheet, Typography, Empty } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { FileText, RefreshCw, Play, Square } from 'lucide-react';
import { streamText } from '@/utils/streaming';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import type { SystemdAction, SystemdService } from '@zenith/shared/ops';
import { hostQueryOf } from '@/hooks/queries/ops-hosts';
import { serviceLogsStreamUrl, useServiceAction, useServiceList, useServiceLogs } from '@/hooks/queries/services';
import { HostSelector } from '@/components/HostSelector';
import { useOpsHostSelection } from '@/hooks/useOpsHostSelection';
import { usePermission } from '@/hooks/usePermission';
const ACTION_MSG: Record<SystemdAction, string> = {
  start: '已启动', stop: '已停止', restart: '已重启', reload: '已重载', enable: '已设为开机自启', disable: '已取消开机自启', mask: '已屏蔽', unmask: '已取消屏蔽',
};

const STATE_COLOR: Record<string, 'green' | 'grey' | 'red' | 'orange'> = {
  active: 'green', inactive: 'grey', failed: 'red', activating: 'orange',
};

export default function ServicesPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:service:manage');
  const [hostId, setHostId] = useOpsHostSelection();
  const [keyword, setKeyword] = useState('');
  const [stateFilter, setStateFilter] = useState<string | undefined>();
  const [logsService, setLogsService] = useState<SystemdService | null>(null);
  const [logs, setLogs] = useState('');
  const [logsFollowing, setLogsFollowing] = useState(false);
  const logsAbortRef = useRef<AbortController | null>(null);
  const logsPreRef = useRef<HTMLPreElement>(null);
  const listQuery = useServiceList(hostId);
  const services = listQuery.data?.services ?? [];
  const available = listQuery.data?.available ?? null;
  const actionMutation = useServiceAction();
  const logsMutation = useServiceLogs();
  const handleHostChange = (next: number | null) => {
    logsAbortRef.current?.abort();
    setLogsService(null);
    setLogs('');
    setLogsFollowing(false);
    setHostId(next);
  };

  // 自动滚到底部
  useEffect(() => {
    if (logsFollowing && logsPreRef.current) {
      logsPreRef.current.scrollTop = logsPreRef.current.scrollHeight;
    }
  }, [logs, logsFollowing]);

  useEffect(() => () => { logsAbortRef.current?.abort(); }, []);

  const handleAction = async (name: string, action: SystemdAction) => {
    await actionMutation.mutateAsync({ params: { name, action }, query: hostQueryOf(hostId) });
    Toast.success({ content: ACTION_MSG[action], duration: 2 });
  };

  const openLogs = async (svc: SystemdService) => {
    logsAbortRef.current?.abort();
    setLogsService(svc);
    setLogs('');
    setLogsFollowing(false);
    const res = await logsMutation.mutateAsync({ name: svc.name, hostId });
    setLogs(res.logs);
  };

  const closeLogs = () => {
    logsAbortRef.current?.abort();
    logsAbortRef.current = null;
    setLogsService(null);
    setLogs('');
    setLogsFollowing(false);
  };

  const toggleFollow = () => {
    if (logsFollowing) {
      logsAbortRef.current?.abort();
      logsAbortRef.current = null;
      setLogsFollowing(false);
    } else if (logsService) {
      setLogsFollowing(true);
      const abort = new AbortController();
      logsAbortRef.current = abort;
      void streamText(
        serviceLogsStreamUrl(logsService.name, hostId),
        (text) => setLogs((prev) => prev + text),
        abort.signal,
      ).catch(() => { /* disconnected */ }).finally(() => { setLogsFollowing(false); });
    }
  };

  const kw = keyword.trim().toLowerCase();
  const filtered = services.filter((s) => {
    if (stateFilter && s.activeState !== stateFilter) return false;
    if (!kw) return true;
    return s.name.toLowerCase().includes(kw) || s.description.toLowerCase().includes(kw);
  });
  const failedCount = services.filter((s) => s.activeState === 'failed').length;

  const columns: ColumnProps<SystemdService>[] = [
    {
      title: '服务名',
      render: (_: unknown, r: SystemdService) => (
        <Typography.Text size="small" code style={{ fontSize: 12 }}>{r.name}</Typography.Text>
      ),
    },
    {
      title: '描述',
      render: (_: unknown, r: SystemdService) => (
        <Typography.Text size="small" type="secondary" ellipsis={{ showTooltip: true }}>{r.description || '—'}</Typography.Text>
      ),
    },
    {
      title: '状态', width: 130,
      render: (_: unknown, r: SystemdService) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Tag size="small" color={STATE_COLOR[r.activeState] ?? 'grey'}>{r.activeState}</Tag>
          {r.subState && r.subState !== r.activeState && (
            <Tag size="small" color="grey">{r.subState}</Tag>
          )}
        </div>
      ),
    },
    {
      title: '加载状态', dataIndex: 'loadState', width: 100,
      render: (v: string) => <Tag size="small" color={v === 'loaded' ? 'blue' : 'grey'}>{v}</Tag>,
    },
    createOperationColumn<SystemdService>({
      width: 240,
      desktopInlineKeys: ['toggle', 'restart', 'logs'],
      actions: (record) => {
        const busy = actionMutation.isPending && actionMutation.variables?.params.name === record.name;
        const isActive = record.activeState === 'active';
        return [
          {
            key: 'toggle',
            label: isActive ? '停止' : '启动',
            danger: isActive,
            loading: busy,
            hidden: !canManage,
            onClick: () => { void handleAction(record.name, isActive ? 'stop' : 'start'); },
          },
          {
            key: 'restart',
            label: '重启',
            loading: busy,
            hidden: !canManage,
            onClick: () => { void handleAction(record.name, 'restart'); },
          },
          {
            key: 'logs',
            label: '日志',
            onClick: () => { void openLogs(record); },
          },
          {
            key: 'enable',
            label: '设为开机自启',
            hidden: !canManage,
            onClick: () => { void handleAction(record.name, 'enable'); },
          },
          {
            key: 'disable',
            label: '取消开机自启',
            hidden: !canManage,
            onClick: () => { void handleAction(record.name, 'disable'); },
          },
          {
            key: 'mask',
            label: '屏蔽服务',
            danger: true,
            dividerBefore: true,
            hidden: !canManage,
            onClick: () => { void handleAction(record.name, 'mask'); },
          },
          {
            key: 'unmask',
            label: '取消屏蔽',
            hidden: !canManage,
            onClick: () => { void handleAction(record.name, 'unmask'); },
          },
        ];
      },
    }),
  ];

  if (available === false) {
    return (
      <div className="page-container">
        <HostSelector value={hostId} onChange={setHostId} />
        <Empty
          title="systemd 不可用"
          description={hostId == null
            ? '当前系统不支持 systemd，此功能仅在 Linux 系统（systemd 可用）下生效。'
            : '所选远端主机不支持 systemd，或当前账号无 systemctl 权限。'}
          style={{ padding: '80px 0' }}
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <HostSelector value={hostId} onChange={handleHostChange} />
            <KeywordInput placeholder="搜索服务名 / 描述" value={keyword} onChange={setKeyword} width={240} />
            <StatusSelect
              items={[
                { label: '运行中', value: 'active' },
                { label: '已停止', value: 'inactive' },
                { label: '失败', value: 'failed' },
                { label: '激活中', value: 'activating' },
              ]}
              value={stateFilter}
              onChange={setStateFilter}
            />
            {failedCount > 0 && (
              <Button size="default" type={stateFilter === 'failed' ? 'primary' : 'tertiary'} theme={stateFilter === 'failed' ? 'solid' : 'light'} onClick={() => setStateFilter(stateFilter === 'failed' ? '' : 'failed')}>
                失败服务 {failedCount}
              </Button>
            )}
            <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void listQuery.refetch()}>刷新</Button>
          </>
        )}
        mobilePrimary={(
          <>
            <HostSelector value={hostId} onChange={handleHostChange} />
            <KeywordInput placeholder="搜索服务名 / 描述" value={keyword} onChange={setKeyword} width={240} />
            <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void listQuery.refetch()}>刷新</Button>
          </>
        )}
        mobileFilters={(
          <>
            <StatusSelect
              items={[
                { label: '运行中', value: 'active' },
                { label: '已停止', value: 'inactive' },
                { label: '失败', value: 'failed' },
                { label: '激活中', value: 'activating' },
              ]}
              value={stateFilter}
              onChange={setStateFilter}
            />
            {failedCount > 0 && (
              <Button size="default" type={stateFilter === 'failed' ? 'primary' : 'tertiary'} theme={stateFilter === 'failed' ? 'solid' : 'light'} onClick={() => setStateFilter(stateFilter === 'failed' ? '' : 'failed')}>
                失败服务 {failedCount}
              </Button>
            )}
          </>
        )}
        filterTitle="服务筛选"
        onFilterReset={() => setStateFilter('')}
      />
      <ConfigurableTable
        bordered rowKey="name" dataSource={filtered} columns={columns} loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching}
        empty="未找到 systemd 服务" pagination={{ pageSize: 50, showSizeChanger: true }}
      />

      <SideSheet
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span><FileText size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />服务日志：{logsService?.name ?? ''}</span>
            <Button size="small" type={logsFollowing ? 'primary' : 'tertiary'} onClick={toggleFollow} style={{ marginRight: 32 }}
              icon={logsFollowing ? <Square size={13} /> : <Play size={13} />}>
              {logsFollowing ? '停止追踪' : '实时追踪'}
            </Button>
          </div>
        }
        visible={!!logsService} onCancel={closeLogs} width={680} placement="right"
      >
        <pre ref={logsPreRef} style={{
          fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 'var(--semi-border-radius-medium)',
          height: 'calc(100vh - 120px)', overflow: 'auto', margin: 0,
        }}>
          {logs || '（暂无日志）'}
        </pre>
      </SideSheet>
    </div>
  );
}
