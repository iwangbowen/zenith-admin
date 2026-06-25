import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Select, Space, Tag, Toast, Typography, Popconfirm, SideSheet, Switch } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Monitor as MonitorIcon } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TOKEN_KEY } from '@zenith/shared';
import '@xterm/xterm/css/xterm.css';
import { request } from '@/utils/request';
import { config } from '@/config';
import { usePermission } from '@/hooks/usePermission';
import { useThemeController } from '@/providers/theme-controller';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { renderEllipsis } from '../../../utils/table-columns';
import { useTerminalPreferences } from './useTerminalPreferences';
import { resolveTheme, toXtermTheme } from './themes';

type TerminalKind = 'local' | 'ssh' | 'docker';

interface TerminalSessionItem {
  sessionId: string;
  userId: number;
  username: string;
  kind: TerminalKind;
  label: string;
  clientIp: string;
  cols: number;
  rows: number;
  connected: boolean;
  observerCount: number;
  takenOver: boolean;
  startedAt: string;
  lastActivityAt: string;
  idleSeconds: number;
  durationSeconds: number;
}

interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

const KIND_META: Record<TerminalKind, { label: string; color: 'blue' | 'green' | 'cyan' }> = {
  local: { label: '本地', color: 'blue' },
  ssh: { label: 'SSH', color: 'green' },
  docker: { label: 'Docker', color: 'cyan' },
};

function buildMonitorWsUrl(sessionId: string, takeover: boolean): string {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  let wsBase = config.wsBaseUrl;
  if (!wsBase) {
    const base = config.apiBaseUrl || location.origin;
    wsBase = base.replace(/^http/, 'ws');
  }
  return `${wsBase}/api/ws/terminal-monitor?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}${takeover ? '&takeover=1' : ''}`;
}

/** 实时监控终端：连接监控 WS，镜像目标会话输出；takeover 时允许注入输入 */
function MonitorTerminal({ sessionId, takeover }: { readonly sessionId: string; readonly takeover: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { isDark } = useThemeController();
  const { terminal } = useTerminalPreferences();
  const [status, setStatus] = useState<'connecting' | 'attached' | 'ended' | 'error'>('connecting');

  const themeDef = useMemo(
    () => resolveTheme(isDark ? terminal.themeDark : terminal.themeLight, isDark ? 'dark' : 'light'),
    [isDark, terminal.themeDark, terminal.themeLight],
  );

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const term = new Terminal({
      theme: toXtermTheme(themeDef),
      fontSize: terminal.fontSize,
      fontFamily: terminal.fontFamily,
      cursorBlink: takeover,
      disableStdin: !takeover,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    setTimeout(() => { try { fit.fit(); } catch { /* ignore */ } }, 0);
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* ignore */ } });
    ro.observe(container);

    const ws = new WebSocket(buildMonitorWsUrl(sessionId, takeover));
    ws.onmessage = (evt) => {
      try {
        const m = JSON.parse(evt.data as string) as { type: string; data?: string };
        if (m.type === 'terminal:output' && m.data) term.write(m.data);
        else if (m.type === 'monitor:attached') setStatus('attached');
        else if (m.type === 'terminal:ended' || m.type === 'terminal:terminated') {
          term.write('\r\n\x1b[31m[会话已结束]\x1b[0m\r\n');
          setStatus('ended');
        } else if (m.type === 'monitor:not-found') {
          setStatus('error');
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => setStatus('error');

    if (takeover) {
      term.onData((d) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'terminal:input', data: d }));
      });
    }

    return () => {
      ro.disconnect();
      try { ws.close(); } catch { /* ignore */ }
      term.dispose();
    };
  }, [sessionId, takeover, themeDef, terminal.fontSize, terminal.fontFamily]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 6 }}>
        {status === 'connecting' && <Typography.Text type="tertiary" size="small">连接中…</Typography.Text>}
        {status === 'attached' && <Typography.Text type="success" size="small">● 实时监控中{takeover ? '（已接管输入）' : '（只读）'}</Typography.Text>}
        {status === 'ended' && <Typography.Text type="warning" size="small">会话已结束</Typography.Text>}
        {status === 'error' && <Typography.Text type="danger" size="small">会话不存在或连接失败</Typography.Text>}
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: 0, background: toXtermTheme(themeDef).background, borderRadius: 4, padding: 4 }} />
    </div>
  );
}

export default function TerminalSessionsPage() {
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TerminalSessionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);

  interface SearchParams { keyword: string; kind: TerminalKind | '' }
  const defaultSearchParams: SearchParams = { keyword: '', kind: '' };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  // 监控 SideSheet 状态
  const [watching, setWatching] = useState<TerminalSessionItem | null>(null);
  const [takeover, setTakeover] = useState(false);

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const { keyword, kind } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (keyword) query.set('keyword', keyword);
      if (kind) query.set('kind', kind);
      const res = await request.get<PaginatedResponse<TerminalSessionItem>>(`/api/terminal-sessions?${query}`, { silent: true });
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // 自动刷新（5s）
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => { void fetchData(); }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchData]);

  const handleTerminate = useCallback(async (record: TerminalSessionItem) => {
    const res = await request.post(`/api/terminal-sessions/${encodeURIComponent(record.sessionId)}/terminate`, {});
    if (res.code === 0) {
      Toast.success('已强制终止');
      void fetchData(page, pageSize);
    }
  }, [fetchData, page, pageSize]);

  const openWatch = (record: TerminalSessionItem) => {
    setTakeover(false);
    setWatching(record);
  };

  const columns: ColumnProps<TerminalSessionItem>[] = [
    { title: '用户', dataIndex: 'username', width: 140, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'kind', width: 90,
      render: (k: TerminalKind) => <Tag size="small" color={KIND_META[k].color}>{KIND_META[k].label}</Tag>,
    },
    { title: '标签 / 主机', dataIndex: 'label', width: 200, render: renderEllipsis },
    { title: '客户端 IP', dataIndex: 'clientIp', width: 140, render: (v: string) => v || '-' },
    { title: '尺寸', dataIndex: 'cols', width: 90, render: (_: number, r) => `${r.cols}×${r.rows}` },
    {
      title: '开始时间', dataIndex: 'startedAt', width: 190,
    },
    {
      title: '空闲', dataIndex: 'idleSeconds', width: 90,
      render: (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`),
    },
    {
      title: '状态', dataIndex: 'connected', width: 120, fixed: 'right',
      render: (connected: boolean, r) => (
        <Space spacing={4}>
          {connected ? <Tag size="small" color="green">在线</Tag> : <Tag size="small" color="grey">已断开</Tag>}
          {r.takenOver && <Tag size="small" color="orange">接管中</Tag>}
          {r.observerCount > 0 && <Tag size="small" color="light-blue">监控{r.observerCount}</Tag>}
        </Space>
      ),
    },
    {
      title: '操作', fixed: 'right', width: 180,
      render: (_: unknown, record: TerminalSessionItem) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openWatch(record)}>监控</Button>
          {hasPermission('system:terminal:monitor') && (
            <Popconfirm title="确定强制终止该会话？" okType="danger" onConfirm={() => void handleTerminate(record)}>
              <Button theme="borderless" type="danger" size="small">强制终止</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户/主机/IP"
              value={searchParams.keyword}
              onChange={(v) => setSearchParams((s) => ({ ...s, keyword: v }))}
              onEnterPress={() => { setPage(1); void fetchData(1, pageSize); }}
              style={{ width: 220 }}
              showClear
            />
            <Select
              placeholder="类型"
              value={searchParams.kind || undefined}
              onChange={(v) => { const kind = (v as TerminalKind | undefined) ?? ''; setSearchParams((s) => ({ ...s, kind })); setPage(1); void fetchData(1, pageSize, { ...searchParamsRef.current, kind }); }}
              style={{ width: 120 }}
              showClear
            >
              <Select.Option value="local">本地</Select.Option>
              <Select.Option value="ssh">SSH</Select.Option>
              <Select.Option value="docker">Docker</Select.Option>
            </Select>
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchData(1, pageSize); }}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, pageSize, defaultSearchParams); }}>重置</Button>
            <Space spacing={4} style={{ marginLeft: 4 }}>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
              <Typography.Text type="tertiary" size="small">自动刷新</Typography.Text>
            </Space>
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户/主机/IP"
              value={searchParams.keyword}
              onChange={(v) => setSearchParams((s) => ({ ...s, keyword: v }))}
              onEnterPress={() => { setPage(1); void fetchData(1, pageSize); }}
              style={{ width: 220 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchData(1, pageSize); }}>查询</Button>
          </>
        )}
        mobileFilters={(
          <>
            <Select
              placeholder="类型"
              value={searchParams.kind || undefined}
              onChange={(v) => { const kind = (v as TerminalKind | undefined) ?? ''; setSearchParams((s) => ({ ...s, kind })); setPage(1); void fetchData(1, pageSize, { ...searchParamsRef.current, kind }); }}
              style={{ width: 120 }}
              showClear
            >
              <Select.Option value="local">本地</Select.Option>
              <Select.Option value="ssh">SSH</Select.Option>
              <Select.Option value="docker">Docker</Select.Option>
            </Select>
            <Space spacing={4}>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
              <Typography.Text type="tertiary" size="small">自动刷新</Typography.Text>
            </Space>
          </>
        )}
        mobileActions={(
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, pageSize, defaultSearchParams); }}>重置</Button>
        )}
        filterTitle="终端会话筛选"
        actionTitle="终端会话操作"
        onFilterApply={() => { setPage(1); void fetchData(1, pageSize); }}
        onFilterReset={() => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, pageSize, defaultSearchParams); }}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        rowKey="sessionId"
        pagination={buildPagination(total, fetchData)}
        empty="暂无活动终端会话"
      />

      <SideSheet
        title={(
          <Space>
            <MonitorIcon size={16} />
            <span>实时监控{watching ? ` — ${watching.username} · ${watching.label}` : ''}</span>
          </Space>
        )}
        visible={!!watching}
        onCancel={() => setWatching(null)}
        width={760}
        placement="right"
        bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}
      >
        {watching && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Switch checked={takeover} onChange={setTakeover} />
              <Typography.Text>接管输入</Typography.Text>
              <Typography.Text type="tertiary" size="small">开启后你的键盘输入将直接发送到该会话，请谨慎操作</Typography.Text>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {/* key 包含 takeover：切换接管时重建连接 */}
              <MonitorTerminal key={`${watching.sessionId}:${takeover}`} sessionId={watching.sessionId} takeover={takeover} />
            </div>
          </>
        )}
      </SideSheet>
    </div>
  );
}
