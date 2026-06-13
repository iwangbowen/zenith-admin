import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Descriptions, Form, InputNumber,
  Select, Space, Spin, Tag, Toast, Typography, SplitButtonGroup, Dropdown,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import {
  Activity, ChevronDown, Download, RefreshCw, Search, X,
} from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { config } from '@/config';
import { TOKEN_KEY } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import type { ProcessInfo, ProcessListResponse } from '@zenith/shared';

// 让操作列的固定分隔线在任何情况下都可见
const processesTableStyle = `
  .processes-table .semi-table-cell-fixed-right-first {
    border-left: 2px solid var(--semi-color-border) !important;
    box-shadow: -4px 0 8px -4px rgba(0,0,0,.15) !important;
  }
`;

// ─── 工具函数 ─────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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
  idle:       { color: '#8c8c8c', text: '未连接' },
  connecting: { color: '#1890ff', text: '连接中' },
  open:       { color: '#52c41a', text: '实时推送中' },
  error:      { color: '#ff4d4f', text: '连接断开' },
};

// ════════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════════
export default function ProcessesPage() {
  const { hasPermission } = usePermission();
  const priorityFormApi = useRef<FormApi | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);

  // ─── 数据状态 ──────────────────────────────────────────────────────────
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [platform, setPlatform] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sseStatus, setSseStatus] = useState<SseStatus>('idle');
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);

  // ─── 搜索状态 ──────────────────────────────────────────────────────────
  const [keyword, setKeyword] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // ─── 详情弹窗 ──────────────────────────────────────────────────────────
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailProcess, setDetailProcess] = useState<ProcessInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ─── 结束进程弹窗 ──────────────────────────────────────────────────────
  const [killVisible, setKillVisible] = useState(false);
  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null);
  const [killSignal, setKillSignal] = useState('SIGTERM');
  const [killing, setKilling] = useState(false);

  // ─── 优先级调整弹窗 ────────────────────────────────────────────────────
  const [priorityVisible, setPriorityVisible] = useState(false);
  const [priorityTarget, setPriorityTarget] = useState<ProcessInfo | null>(null);
  const [settingPriority, setSettingPriority] = useState(false);

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

  // ─── SSE 连接 ──────────────────────────────────────────────────────────
  const connectSse = useCallback(() => {
    sseAbortRef.current?.abort();
    const ctrl = new AbortController();
    sseAbortRef.current = ctrl;
    setSseStatus('connecting');
    let buffer = '';

    (async () => {
      try {
        const token = localStorage.getItem(TOKEN_KEY);
        const res = await fetch(`${config.apiBaseUrl}/api/processes/stream`, {
          headers: { Authorization: `Bearer ${token ?? ''}` },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          setSseStatus('error');
          return;
        }
        setSseStatus('open');
        // 注意：loading 在收到第一帧数据后才关闭（不在 SSE open 时关闭）
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            let currentEvent = '';
            let dataLine = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLine += line.slice(5).trimStart();
            }
            if (!dataLine || currentEvent === 'ping') continue;
            try {
              const payload = JSON.parse(dataLine) as ProcessListResponse;
              if (currentEvent === 'processes') {
                setProcesses(payload.processes);
                setPlatform(payload.platform);
                setLastUpdated(new Date());
                setLoading(false); // 收到第一帧数据后关闭 loading spin
              }
            } catch { /* ignore parse errors */ }
          }
        }
        setSseStatus('idle');
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setSseStatus('error');
      }
    })();
  }, []);

  useEffect(() => {
    setLoading(true);
    connectSse();
    return () => sseAbortRef.current?.abort();
  }, [connectSse]);

  // ─── 查看详情 ──────────────────────────────────────────────────────────
  async function openDetail(p: ProcessInfo) {
    setDetailProcess(p);
    setDetailVisible(true);
    setDetailLoading(true);
    const res = await request.get<ProcessInfo>(`/api/processes/${p.pid}`);
    setDetailLoading(false);
    if (res.code === 0 && res.data) setDetailProcess(res.data);
  }

  // ─── 结束进程 ──────────────────────────────────────────────────────────
  async function confirmKill() {
    if (!killTarget) return;
    setKilling(true);
    try {
      const res = await request.delete(`/api/processes/${killTarget.pid}`, { signal: killSignal });
      if (res.code === 0) {
        Toast.success(`已向进程 ${killTarget.name}（PID: ${killTarget.pid}）发送 ${killSignal}`);
        setKillVisible(false);
        setKillTarget(null);
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setKilling(false);
    }
  }

  // ─── 调整优先级 ────────────────────────────────────────────────────────
  async function confirmPriority() {
    if (!priorityTarget) return;
    let values: Record<string, unknown>;
    try { values = await priorityFormApi.current?.validate() ?? {}; }
    catch { throw new Error('validation'); }

    setSettingPriority(true);
    try {
      const res = await request.put(`/api/processes/${priorityTarget.pid}/priority`, values);
      if (res.code === 0) {
        Toast.success('优先级已调整');
        setPriorityVisible(false);
        setPriorityTarget(null);
      } else {
        throw new Error(res.message || '操作失败');
      }
    } finally {
      setSettingPriority(false);
    }
  }

  // ─── 导出 ─────────────────────────────────────────────────────────────
  async function handleExportExcel() {
    setExportLoading(true);
    try { await request.download('/api/processes/export', '进程列表.xlsx'); }
    finally { setExportLoading(false); }
  }

  async function handleExportCsv() {
    setExportCsvLoading(true);
    try { await request.download('/api/processes/export/csv', '进程列表.csv'); }
    finally { setExportCsvLoading(false); }
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
      width: 200,
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
      render: (v: string) => v || <span style={{ color: '#bbb' }}>—</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: string) => {
        const meta = STATUS_META[status] ?? STATUS_META.unknown;
        return <Tag color={meta.color as never} size="small">{meta.label}</Tag>;
      },
    },
    {
      title: 'CPU%',
      dataIndex: 'cpu',
      width: 80,
      sorter: (a, b) => (a?.cpu ?? 0) - (b?.cpu ?? 0),
      render: (cpu: number) => {
        let cpuColor: string | undefined;
        if (cpu > 50) cpuColor = '#ff4d4f';
        else if (cpu > 20) cpuColor = '#fa8c16';
        return <span style={{ color: cpuColor }}>{cpu.toFixed(1)}%</span>;
      },
    },
    {
      title: '内存',
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
        if (v === null || v === undefined || v === '') return <span style={{ color: '#bbb' }}>—</span>;
        if (platform !== 'win32') {
          const n = Number(v);
          let niceColor: string | undefined;
          if (n < 0) niceColor = '#52c41a';
          else if (n > 0) niceColor = '#ff4d4f';
          return <span style={{ color: niceColor }}>{typeof v === 'number' ? String(v) : String(Number(v))}</span>;
        }
        return <span>{typeof v === 'string' ? v : String(Number(v))}</span>;
      },
    },
    {
      title: '启动时间',
      dataIndex: 'startTime',
      width: 155,
      render: (v: string | null) => v ?? <span style={{ color: '#bbb' }}>—</span>,
    },
    {
      title: '端口',
      dataIndex: 'ports',
      width: 130,
      render: (v: string | null) => v
        ? <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text>
        : <span style={{ color: '#bbb' }}>—</span>,
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: hasPermission('system:process:priority') ? 230 : 160,
      render: (_: unknown, record: ProcessInfo) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          {hasPermission('system:process:kill') && (
            <Button
              theme="borderless"
              type="danger"
              size="small"
              onClick={() => { setKillTarget(record); setKillSignal('SIGTERM'); setKillVisible(true); }}
            >
              结束
            </Button>
          )}
          {hasPermission('system:process:priority') && (
            <Button
              theme="borderless"
              size="small"
              onClick={() => { setPriorityTarget(record); setPriorityVisible(true); }}
            >
              优先级
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const sseIndicator = SSE_STATUS_META[sseStatus];

  // ════════════════════════════════════════════════════════════════════════
  // 渲染
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="page-container">
      <style>{processesTableStyle}</style>
      {/* 搜索与操作栏 */}
      <SearchToolbar>
        {/* 搜索框 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          border: '1px solid var(--semi-color-border)', borderRadius: 6,
          padding: '0 8px', background: 'var(--semi-color-bg-1)', width: 240 }}>
          <Search size={14} style={{ color: '#8c8c8c', flexShrink: 0 }} />
          <input
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1,
              fontSize: 14, color: 'inherit', padding: '5px 0' }}
            placeholder="搜索进程名、用户、PID..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {keyword && (
            <button
              style={{ border: 'none', background: 'transparent', cursor: 'pointer',
                color: '#8c8c8c', display: 'flex', alignItems: 'center', padding: 0 }}
              onClick={() => setKeyword('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {/* 状态筛选 */}
        <Select
          placeholder="全部状态"
          value={filterStatus || undefined}
          onChange={(v) => setFilterStatus((v as string) ?? '')}
          showClear
          style={{ width: 120 }}
          optionList={Object.entries(STATUS_META).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        {/* 手动刷新 */}
        <Button
          type="tertiary"
          icon={<RefreshCw size={14} />}
          onClick={() => { sseAbortRef.current?.abort(); connectSse(); }}
          loading={sseStatus === 'connecting'}
        >
          刷新
        </Button>
        {/* 导出 */}
        <SplitButtonGroup>
          <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={handleExportExcel}>
            导出
          </Button>
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={(
              <Dropdown.Menu>
                <Dropdown.Item onClick={handleExportExcel}>导出 Excel</Dropdown.Item>
                <Dropdown.Item onClick={handleExportCsv}>导出 CSV</Dropdown.Item>
              </Dropdown.Menu>
            )}
          >
            <Button type="primary" icon={<ChevronDown size={14} />} loading={exportCsvLoading} />
          </Dropdown>
        </SplitButtonGroup>
        {/* SSE 状态指示 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: sseIndicator.color,
            boxShadow: sseStatus === 'open' ? `0 0 0 2px ${sseIndicator.color}40` : undefined,
          }} />
          <Typography.Text type="tertiary" size="small">{sseIndicator.text}</Typography.Text>
          {lastUpdated && (
            <Typography.Text type="tertiary" size="small">
              · {lastUpdated.toLocaleTimeString()}
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
      </SearchToolbar>

      {/* 统计信息 */}
      <div style={{ display: 'flex', gap: 20, padding: '8px 0', fontSize: 13, color: 'var(--semi-color-text-2)' }}>
        <span><Activity size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />共 {filteredProcesses.length} 个进程</span>
        {keyword && <span>（匹配 "{keyword}"）</span>}
      </div>

      {/* 虚拟化表格 */}
      <ConfigurableTable
        bordered
        virtualized
        className="processes-table"
        scroll={{ y: tableHeight, x: 1380 }}
        columns={columns}
        dataSource={filteredProcesses}
        loading={loading && processes.length === 0}
        rowKey="pid"
        size="small"
        empty="暂无进程数据"
        pagination={false}
        onRefresh={() => { sseAbortRef.current?.abort(); connectSse(); }}
        refreshLoading={sseStatus === 'connecting'}
      />

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
        <Spin spinning={detailLoading}>
          {detailProcess && (
            <>
            <Descriptions
              align="center"
              size="small"
              row
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
                { key: '启动时间', value: detailProcess.startTime ?? '—' },
                {
                  key: '命令行',
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
        okButtonProps={{ type: 'danger', theme: 'solid', loading: killing }}
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
                  onChange={(v) => setKillSignal(v as string)}
                />
              </Form>
            )}
          </div>
        )}
      </AppModal>

      {/* ── 调整优先级弹窗 ── */}
      <AppModal
        title={`调整优先级：${priorityTarget?.name ?? ''}（PID: ${priorityTarget?.pid ?? ''}）`}
        visible={priorityVisible}
        onOk={confirmPriority}
        onCancel={() => { setPriorityVisible(false); setPriorityTarget(null); }}
        okButtonProps={{ loading: settingPriority }}
        okText="确认调整"
        width={420}
        closeOnEsc
      >
        {priorityTarget && (
          <Form
            key={priorityTarget.pid}
            getFormApi={(api) => { priorityFormApi.current = api; }}
            labelPosition="left"
            labelWidth={100}
            initValues={
              platform === 'win32'
                ? { priorityClass: priorityTarget.priorityClass ?? 'Normal' }
                : { nice: priorityTarget.nice ?? 0 }
            }
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
                    defaultValue={priorityTarget.nice ?? 0}
                    min={-20}
                    max={19}
                    style={{ width: '100%' }}
                    onChange={(v) => priorityFormApi.current?.setValue('nice', v)}
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
