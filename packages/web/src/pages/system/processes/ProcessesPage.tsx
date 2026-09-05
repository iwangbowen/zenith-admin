import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Descriptions, Form, InputNumber, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import {
  Activity, RefreshCw,
} from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { readSseStream } from '@/utils/streaming';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { PROCESS_KILL_SIGNALS, PROCESS_PRIORITY_CLASSES, type ProcessInfo, type ProcessKillSignal, type ProcessListResponse, type SetProcessPriorityInput } from '@zenith/shared/ops';
import { enumValueOf } from '@zenith/shared/core';
import { hostQueryOf } from '@/hooks/queries/ops-hosts';
import { processStreamUrl, useKillProcess, useProcessDetail, useProcessList, useSetProcessPriority } from '@/hooks/queries/processes';
import { dateTimeColumn } from '@/utils/table-columns';
import { HostSelector } from '@/components/HostSelector';
import { useOpsHostSelection } from '@/hooks/useOpsHostSelection';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { formatBytes } from '@zenith/shared/core';

// 自定义进程表格 CSS
const processesTableStyle = '';

// ─── 工具函数 ─────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { color: string; label: string }> = {
  running:    { color: 'green',  label: '运行中' },
  sleeping:   { color: 'blue',   label: '休眠' },
  'disk-sleep': { color: 'orange', label: '等待磁盘' },
  stopped:    { color: 'grey',   label: '已停止' },
  zombie:     { color: 'red',    label: '僵尸' },
  idle:       { color: 'grey',   label: '空闲' },
  unknown:    { color: 'grey',   label: '未知' },
};

const WIN_PRIORITY_OPTIONS = [
  { value: 'Idle',        label: 'Idle（最低）' },
  { value: 'BelowNormal', label: 'BelowNormal（低于正常）' },
  { value: 'Normal',      label: 'Normal（正常）' },
  { value: 'AboveNormal', label: 'AboveNormal（高于正常）' },
  { value: 'High',        label: 'High（高）' },
  { value: 'RealTime',    label: 'RealTime（实时，慎用）' },
];

const SIGNAL_OPTIONS = [
  { value: 'SIGTERM', label: 'SIGTERM（优雅退出，推荐）' },
  { value: 'SIGKILL', label: 'SIGKILL（强制终止）' },
  { value: 'SIGINT',  label: 'SIGINT（中断）' },
  { value: 'SIGHUP',  label: 'SIGHUP（挂起/重载）' },
];

type SseStatus = 'idle' | 'connecting' | 'open' | 'error';

const SSE_STATUS_META: Record<SseStatus, { color: string; text: string }> = {
  idle:       { color: 'var(--semi-color-text-2)', text: '未连接' },
  connecting: { color: 'var(--semi-color-info)', text: '连接中' },
  open:       { color: 'var(--semi-color-success)', text: '实时推送中' },
  error:      { color: 'var(--semi-color-danger)', text: '连接断开' },
};

interface PriorityRecord {
  id: number;
  pid: number;
  name: string;
  nice?: number | null;
  priorityClass?: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════════
export default function ProcessesPage() {
  const { hasPermission } = usePermission();
  const sseAbortRef = useRef<AbortController | null>(null);

  // ─── 数据状态 ──────────────────────────────────────────────────────────
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [platform, setPlatform] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sseStatus, setSseStatus] = useState<SseStatus>('idle');
  const [loading, setLoading] = useState(false);

  // ─── 搜索状态 ──────────────────────────────────────────────────────────
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();
  // 深链:?pid= 直接定位到指定进程(端口页「查看进程」跳入),消费后清空参数
  const [searchParams, setSearchParams] = useSearchParams();
  const initialHostId = (() => {
    const value = Number(searchParams.get('hostId'));
    return Number.isInteger(value) && value > 0 ? value : null;
  })();
  // 带 pid 的深链若未显式给 hostId，语义是本机进程；不能继承上次远端选择。
  const [hostId, setHostId] = useOpsHostSelection(
    searchParams.has('hostId') ? initialHostId : searchParams.has('pid') ? null : undefined,
  );
  useEffect(() => {
    const pid = searchParams.get('pid');
    if (!pid) return;
    setKeyword(pid);
    setSearchParams(hostId == null ? {} : { hostId: String(hostId) }, { replace: true });
  }, [searchParams, setSearchParams, hostId]);
  const [filterStatus, setFilterStatus] = useState<string | undefined>();

  // ─── 详情弹窗 ──────────────────────────────────────────────────────────
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailProcess, setDetailProcess] = useState<ProcessInfo | null>(null);

  // ─── 结束进程弹窗 ──────────────────────────────────────────────────────
  const [killVisible, setKillVisible] = useState(false);
  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null);
  const [killSignal, setKillSignal] = useState<ProcessKillSignal>('SIGTERM');

  const remoteListQuery = useProcessList(hostId, hostId != null);
  const detailQuery = useProcessDetail(detailProcess?.pid, detailVisible, hostId);
  const killMutation = useKillProcess();
  const priorityMutation = useSetProcessPriority();
  const priorityModal = useEditModal<PriorityRecord, SetProcessPriorityInput>({
    save: {
      mutateAsync: async ({ id, values }) => {
        await priorityMutation.mutateAsync({ params: { pid: id ?? 0 }, query: hostQueryOf(hostId), body: values });
        return { id: id ?? 0, pid: id ?? 0, name: '' };
      },
      isPending: priorityMutation.isPending,
    },
    toValues: (record) => platform === 'win32'
      ? { priorityClass: enumValueOf(PROCESS_PRIORITY_CLASSES, record.priorityClass) ?? 'Normal' }
      : { nice: record.nice ?? 0 },
    successMessage: () => '优先级已调整',
    labelWidth: 100,
  });
  const handleHostChange = useCallback((nextHostId: number | null) => {
    sseAbortRef.current?.abort();
    setHostId(nextHostId);
    setProcesses([]);
    setDetailVisible(false);
    setDetailProcess(null);
    setSearchParams(nextHostId == null ? {} : { hostId: String(nextHostId) }, { replace: true });
  }, [setHostId, setSearchParams]);

  // ─── 虚拟表格高度（Semi UI 要求数字型 scroll.y）──────────────────────────
  const [tableHeight, setTableHeight] = useState(() => Math.max(200, window.innerHeight - 320));

  useEffect(() => {
    const onResize = () => setTableHeight(Math.max(200, window.innerHeight - 320));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ─── 客户端过滤 ────────────────────────────────────────────────────────
  const filteredProcesses = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return processes.filter((p) => {
      const matchKw = !kw
        || p.name.toLowerCase().includes(kw)
        || p.command.toLowerCase().includes(kw)
        || p.user.toLowerCase().includes(kw)
        || String(p.pid).includes(kw);
      const matchStatus = !filterStatus || p.status === filterStatus;
      return matchKw && matchStatus;
    });
  }, [processes, keyword, filterStatus]);
  const buildExportQuery = () => ({
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
    ...(filterStatus ? { status: filterStatus } : {}),
  });

  // ─── SSE 连接 ──────────────────────────────────────────────────────────
  const connectSse = useCallback(() => {
    sseAbortRef.current?.abort();
    const ctrl = new AbortController();
    sseAbortRef.current = ctrl;
    setSseStatus('connecting');

    (async () => {
      try {
        const res = await request.fetchRaw(processStreamUrl(), { signal: ctrl.signal, silent: true });
        if (!res || !res.ok || !res.body) {
          setSseStatus('error');
          return;
        }
        setSseStatus('open');
        // 注意：loading 在收到第一帧数据后才关闭（不在 SSE open 时关闭）
        await readSseStream(res, (events) => {
          for (const { event, data } of events) {
            if (event !== 'processes') continue;
            try {
              const payload = JSON.parse(data) as ProcessListResponse;
              setProcesses(payload.processes);
              setPlatform(payload.platform);
              setLastUpdated(new Date());
              setLoading(false); // 收到第一帧数据后关闭 loading spin
            } catch { /* ignore parse errors */ }
          }
        });
        setSseStatus('idle');
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setSseStatus('error');
      }
    })();
  }, []);

  useEffect(() => {
    if (hostId == null) {
      setLoading(true);
      connectSse();
    } else {
      sseAbortRef.current?.abort();
      setSseStatus('idle');
      setLoading(remoteListQuery.isPending);
    }
    return () => sseAbortRef.current?.abort();
  }, [connectSse, hostId, remoteListQuery.isPending]);

  useEffect(() => {
    if (hostId == null || !remoteListQuery.data) return;
    setProcesses(remoteListQuery.data.processes);
    setPlatform(remoteListQuery.data.platform);
    setLastUpdated(new Date());
    setLoading(false);
  }, [hostId, remoteListQuery.data]);

  useEffect(() => {
    if (detailVisible && detailQuery.data) setDetailProcess(detailQuery.data);
  }, [detailVisible, detailQuery.data]);

  // ─── 查看详情 ──────────────────────────────────────────────────────────
  function openDetail(p: ProcessInfo) {
    setDetailProcess(p);
    setDetailVisible(true);
  }

  // ─── 结束进程 ──────────────────────────────────────────────────────────
  async function confirmKill() {
    if (!killTarget) return;
    await killMutation.mutateAsync({ params: { pid: killTarget.pid }, query: hostQueryOf(hostId), body: { signal: killSignal } });
    Toast.success(`已向进程 ${killTarget.name}（PID: ${killTarget.pid}）发送 ${killSignal}`);
    setKillVisible(false);
    setKillTarget(null);
  }

  // ─── 表格列定义 ────────────────────────────────────────────────────────
  const columns: ColumnProps<ProcessInfo>[] = [
    {
      title: 'PID',
      dataIndex: 'pid',
      width: 80,
      sorter: (a, b) => (a?.pid ?? 0) - (b?.pid ?? 0),
    },
    {
      title: '进程名',
      dataIndex: 'name',
      minWidth: 160,
      render: (name: string) => (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
          {name}
        </Typography.Text>
      ),
    },
    {
      title: '用户',
      dataIndex: 'user',
      width: 100,
      render: (v: string) => v || <span style={{ color: 'var(--semi-color-text-3)' }}>—</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => {
        const meta = STATUS_META[status] ?? STATUS_META.unknown;
        return <Tag color={meta.color as never} size="small">{meta.label}</Tag>;
      },
    },
    {
      title: 'CPU%',
      align: 'right',
      dataIndex: 'cpu',
      width: 80,
      sorter: (a, b) => (a?.cpu ?? 0) - (b?.cpu ?? 0),
      render: (cpu: number) => {
        let cpuColor: string | undefined;
        if (cpu > 50) cpuColor = 'var(--semi-color-danger)';
        else if (cpu > 20) cpuColor = 'var(--semi-color-warning)';
        return <span style={{ color: cpuColor }}>{cpu.toFixed(1)}%</span>;
      },
    },
    {
      title: '内存',
      align: 'right',
      dataIndex: 'memory',
      width: 110,
      sorter: (a, b) => (a?.memory ?? 0) - (b?.memory ?? 0),
      render: (_: unknown, row: ProcessInfo) => (
        <span title={`${row.memoryPercent.toFixed(1)}%`}>
          {formatBytes(row.memory)}
        </span>
      ),
    },
    {
      title: '线程',
      dataIndex: 'threads',
      width: 90,
      sorter: (a, b) => (a?.threads ?? 0) - (b?.threads ?? 0),
    },
    {
      title: platform === 'win32' ? '优先级类' : 'Nice',
      dataIndex: platform === 'win32' ? 'priorityClass' : 'nice',
      width: platform === 'win32' ? 110 : 70,
      render: (v: unknown) => {
        if (v === null || v === undefined || v === '') return <span style={{ color: 'var(--semi-color-text-3)' }}>—</span>;
        if (platform !== 'win32') {
          const n = Number(v);
          let niceColor: string | undefined;
          if (n < 0) niceColor = 'var(--semi-color-success)';
          else if (n > 0) niceColor = 'var(--semi-color-danger)';
          return <span style={{ color: niceColor }}>{typeof v === 'number' ? String(v) : String(Number(v))}</span>;
        }
        return <span>{typeof v === 'string' ? v : String(Number(v))}</span>;
      },
    },
    dateTimeColumn('启动时间', 'startTime'),
    {
      title: '端口',
      dataIndex: 'ports',
      width: 130,
      render: (v: string | null) => v
        ? <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text>
        : <span style={{ color: 'var(--semi-color-text-3)' }}>—</span>,
    },
    createOperationColumn<ProcessInfo>({
      width: hasPermission('system:process:priority') ? 220 : 150,
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => openDetail(record),
        },
        {
          key: 'kill',
          label: '结束',
          danger: true,
          hidden: !hasPermission('system:process:kill'),
          onClick: () => { setKillTarget(record); setKillSignal('SIGTERM'); setKillVisible(true); },
        },
        {
          key: 'priority',
          label: '优先级',
          hidden: !hasPermission('system:process:priority'),
          onClick: () => { priorityModal.openEdit({ ...record, id: record.pid }); },
        },
      ],
    }),
  ];

  const sseIndicator = SSE_STATUS_META[sseStatus];

  // ════════════════════════════════════════════════════════════════════════
  // 渲染
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="page-container">
      <style>{processesTableStyle}</style>
      {/* 搜索与操作栏 */}
      <SearchToolbar
        primary={(
          <>
            <HostSelector
              value={hostId}
              onChange={handleHostChange}
            />
            <KeywordInput
              placeholder="搜索进程名、用户、PID..."
              value={keyword}
              onChange={setKeyword}
              width={240}
            />
            {/* 状态筛选 */}
            <StatusSelect
              items={Object.entries(STATUS_META).map(([k, v]) => ({ value: k, label: v.label }))}
              value={filterStatus}
              onChange={setFilterStatus}
            />
            {/* 手动刷新 */}
            <Button
              type="tertiary"
              icon={<RefreshCw size={14} />}
              onClick={() => {
                if (hostId == null) {
                  sseAbortRef.current?.abort();
                  connectSse();
                } else {
                  void remoteListQuery.refetch();
                }
              }}
              loading={hostId == null ? sseStatus === 'connecting' : remoteListQuery.isFetching}
            >
              刷新
            </Button>
            {/* SSE 状态指示 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: hostId == null ? sseIndicator.color : 'var(--semi-color-info)',
                boxShadow: hostId == null && sseStatus === 'open' ? '0 0 0 2px color-mix(in srgb, var(--semi-color-success) 25%, transparent)' : undefined,
              }} />
              <Typography.Text type="tertiary" size="small">{hostId == null ? sseIndicator.text : '5 秒轮询'}</Typography.Text>
              {lastUpdated && (
                <Typography.Text type="tertiary" size="small">
                  · {formatDateTime(lastUpdated)}
                </Typography.Text>
              )}
            </div>
            {/* 平台信息 */}
            {platform && (
              <Tag size="small" color="cyan" style={{ marginLeft: 4 }}>
              {(() => {
                if (platform === 'win32') return 'Windows';
                if (platform === 'darwin') return 'macOS';
                return platform;
              })()}
              </Tag>
            )}
          </>
        )}
        actions={hostId == null ? <ExportButton entity="system.processes" query={buildExportQuery()} /> : undefined}
        mobilePrimary={(
          <>
            <HostSelector value={hostId} onChange={handleHostChange} />
            <KeywordInput
              placeholder="搜索进程名、用户、PID..."
              value={keyword}
              onChange={setKeyword}
              width={240}
            />
          </>
        )}
        mobileFilters={(
          <StatusSelect
            items={Object.entries(STATUS_META).map(([k, v]) => ({ value: k, label: v.label }))}
            value={filterStatus}
            onChange={setFilterStatus}
          />
        )}
        mobileActions={(
          <>
            <Button
              type="tertiary"
              icon={<RefreshCw size={14} />}
              onClick={() => {
                if (hostId == null) {
                  sseAbortRef.current?.abort();
                  connectSse();
                } else {
                  void remoteListQuery.refetch();
                }
              }}
              loading={hostId == null ? sseStatus === 'connecting' : remoteListQuery.isFetching}
            >
              刷新
            </Button>
            {hostId == null && <ExportButton entity="system.processes" query={buildExportQuery()} variant="flat" />}
          </>
        )}
        filterTitle="进程筛选"
        actionTitle="进程操作"
      />

      {/* 统计信息 */}
      <div style={{ display: 'flex', gap: 20, padding: '8px 0', fontSize: 13, color: 'var(--semi-color-text-2)' }}>
        <span><Activity size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />共 {filteredProcesses.length} 个进程</span>
        {keyword && <span>（匹配 "{keyword}"）</span>}
      </div>

      {/* 虚拟化表格 */}
      <div style={{ flex: 1, minHeight: 0 }}>
      <ConfigurableTable
        bordered
        virtualized
        className="processes-table"
        scroll={{ y: tableHeight }}
        columns={columns}
        dataSource={filteredProcesses}
        loading={loading && processes.length === 0}
        rowKey="pid"
        size="small"
        empty="暂无进程数据"
        pagination={false}
        onRefresh={() => {
          if (hostId == null) {
            sseAbortRef.current?.abort();
            connectSse();
          } else {
            void remoteListQuery.refetch();
          }
        }}
        refreshLoading={hostId == null ? sseStatus === 'connecting' : remoteListQuery.isFetching}
      />
      </div>

      {/* ── 详情弹窗 ── */}
      <AppModal
        title={`进程详情：${detailProcess?.name ?? ''}（PID: ${detailProcess?.pid ?? ''}）`}
        visible={detailVisible}
        onOk={() => setDetailVisible(false)}
        onCancel={() => setDetailVisible(false)}
        okText="关闭"
        cancelButtonProps={{ style: { display: 'none' } }}
        width={640}
        closeOnEsc
      >
        <Spin spinning={detailQuery.isFetching}>
          {detailProcess && (
            <>
            <Descriptions
              align="plain"
              layout="horizontal"
              column={2}
              size="small"
              style={{ width: '100%' }}
              data={[
                { key: 'PID', value: detailProcess.pid },
                { key: '父进程 PID', value: detailProcess.ppid || '—' },
                { key: '进程名', value: detailProcess.name },
                { key: '用户', value: detailProcess.user || '—' },
                {
                  key: '状态', value: (
                    <Tag color={(STATUS_META[detailProcess.status]?.color ?? 'grey') as never} size="small">
                      {STATUS_META[detailProcess.status]?.label ?? detailProcess.status}
                    </Tag>
                  ),
                },
                { key: 'CPU', value: `${detailProcess.cpu.toFixed(1)}%` },
                {
                  key: '内存', value: `${formatBytes(detailProcess.memory)} (${detailProcess.memoryPercent.toFixed(1)}%)`,
                },
                { key: '线程数', value: detailProcess.threads },
                {
                  key: platform === 'win32' ? '优先级类' : 'Nice 值',
                  value: platform === 'win32'
                    ? (detailProcess.priorityClass ?? '—')
                    : (detailProcess.nice ?? '—'),
                },
                { key: '端口', value: detailProcess.ports ?? '—' },
                { key: '启动时间', value: detailProcess.startTime ?? '—', span: 2 },
                {
                  key: '命令行',
                  span: 2,
                  value: (
                    <Typography.Text
                      copyable
                      ellipsis={{ rows: 3, showTooltip: { opts: { content: detailProcess.command } } }}
                      style={{ maxWidth: '100%', wordBreak: 'break-all' }}
                    >
                      {detailProcess.command || '—'}
                    </Typography.Text>
                  ),
                },
                ...(detailProcess.cwd ? [{
                  key: '工作目录',
                  span: 2,
                  value: (
                    <Space>
                      <Typography.Text copyable style={{ wordBreak: 'break-all' }}>{detailProcess.cwd}</Typography.Text>
                      <Button
                        size="small"
                        theme="borderless"
                        onClick={() => navigate(
                          hostId == null
                            ? `/system/terminal?cwd=${encodeURIComponent(detailProcess.cwd as string)}`
                            : `/system/terminal?open=${encodeURIComponent(`host:${hostId}`)}&cwd=${encodeURIComponent(detailProcess.cwd as string)}`,
                        )}
                      >
                        在终端打开
                      </Button>
                    </Space>
                  ),
                }] : []),
              ]}
            />
            {/* 网络连接 */}
            {detailProcess.connections && detailProcess.connections.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Typography.Title heading={6} style={{ marginBottom: 8 }}>网络连接</Typography.Title>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--semi-color-fill-0)' }}>
                      <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--semi-color-border)' }}>协议</th>
                      <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--semi-color-border)' }}>本地地址</th>
                      <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--semi-color-border)' }}>远端地址</th>
                      <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--semi-color-border)' }}>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailProcess.connections.map((c) => (
                      <tr key={`${c.protocol}-${c.localAddr}-${c.localPort}`} style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
                        <td style={{ padding: '3px 8px' }}>{c.protocol}</td>
                        <td style={{ padding: '3px 8px' }}>{c.localAddr}:{c.localPort}</td>
                        <td style={{ padding: '3px 8px' }}>{c.remoteAddr ? `${c.remoteAddr}:${c.remotePort}` : '—'}</td>
                        <td style={{ padding: '3px 8px' }}>{c.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* 环境变量（Linux /proc） */}
            {detailProcess.env && Object.keys(detailProcess.env).length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Typography.Title heading={6} style={{ marginBottom: 8 }}>环境变量（{Object.keys(detailProcess.env).length}）</Typography.Title>
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
                    <tbody>
                      {Object.entries(detailProcess.env).map(([k, v]) => (
                        <tr key={k} style={{ borderBottom: '1px solid var(--semi-color-fill-1)' }}>
                          <td style={{ padding: '3px 8px', color: 'var(--semi-color-primary)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
                          <td style={{ padding: '3px 8px', wordBreak: 'break-all' }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            </>
          )}
        </Spin>
      </AppModal>

      {/* ── 结束进程弹窗 ── */}
      <AppModal
        title="结束进程"
        visible={killVisible}
        onOk={confirmKill}
        onCancel={() => { setKillVisible(false); setKillTarget(null); }}
        okButtonProps={{ type: 'danger', theme: 'solid', loading: killMutation.isPending }}
        okText="确认结束"
        width={440}
        closeOnEsc
      >
        {killTarget && (
          <div>
            <p style={{ marginBottom: 12, color: 'var(--semi-color-text-1)' }}>
              即将向进程 <strong>{killTarget.name}</strong>（PID: {killTarget.pid}）发送终止信号，请谨慎操作。
            </p>
            {platform !== 'win32' && (
              <Form labelPosition="left" labelWidth={90}>
                <Form.Select
                  field="signal"
                  label="终止信号"
                  initValue="SIGTERM"
                  style={{ width: '100%' }}
                  optionList={SIGNAL_OPTIONS}
                  onChange={(v) => setKillSignal(enumValueOf(PROCESS_KILL_SIGNALS, v) ?? 'SIGTERM')}
                />
              </Form>
            )}
          </div>
        )}
      </AppModal>

      {/* ── 调整优先级弹窗 ── */}
      <AppModal
        {...priorityModal.modalProps}
        title={`调整优先级：${priorityModal.editing?.name ?? ''}（PID: ${priorityModal.editing?.pid ?? ''}）`}
        okText="确认调整"
        width={420}
      >
        {priorityModal.editing && (
          <Form
            key={priorityModal.formKey} {...priorityModal.formProps}
          >
            {platform === 'win32' ? (
              <Form.Select
                field="priorityClass"
                label="优先级类"
                style={{ width: '100%' }}
                optionList={WIN_PRIORITY_OPTIONS}
                rules={[{ required: true, message: '请选择优先级类' }]}
              />
            ) : (
              <>
                <Form.Slot label="Nice 值">
                  <InputNumber
                    defaultValue={priorityModal.editing.nice ?? 0}
                    min={-20}
                    max={19}
                    style={{ width: '100%' }}
                    onChange={(v) => priorityModal.formApi.current?.setValue('nice', v)}
                  />
                </Form.Slot>
                <div style={{ fontSize: 12, color: 'var(--semi-color-text-3)', marginTop: 4, paddingLeft: 104 }}>
                  范围 -20（最高优先级）到 19（最低优先级），降低 nice 值需要 root 权限
                </div>
              </>
            )}
          </Form>
        )}
      </AppModal>
    </div>
  );
}
