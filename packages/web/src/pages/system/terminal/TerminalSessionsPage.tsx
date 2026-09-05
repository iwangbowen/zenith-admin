import { useEffect, useMemo, useRef, useState } from 'react';
import { Space, Tag, Toast, Typography, SideSheet, Switch } from '@douyinfe/semi-ui';
import { Monitor as MonitorIcon } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TOKEN_KEY } from '@zenith/shared/core';
import { wsAuthProtocols } from '@zenith/shared/platform';
import '@xterm/xterm/css/xterm.css';
import { config } from '@/config';
import { usePermission } from '@/hooks/usePermission';
import { useThemeController } from '@/providers/theme-controller';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useListSearch } from '@/hooks/useListSearch';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useTerminalPreferences } from './useTerminalPreferences';
import { resolveTheme, toXtermTheme } from './themes';
import {
  terminalKeys,
  useTerminateTerminalSession,
  useTerminalSessionList,
} from '@/hooks/queries/terminal';
import type { TerminalSession, TerminalSessionKind } from '@zenith/shared/ops';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';

const KIND_META: Record<TerminalSessionKind, { label: string; color: 'blue' | 'green' | 'cyan' | 'purple' }> = {
  local: { label: '本地', color: 'blue' },
  ssh: { label: 'SSH', color: 'green' },
  docker: { label: 'Docker', color: 'cyan' },
  db: { label: '数据库', color: 'purple' },
};
const KIND_FILTER_OPTIONS = (Object.keys(KIND_META) as TerminalSessionKind[]).map((value) => ({ value, label: KIND_META[value].label }));

function buildMonitorWsUrl(sessionId: string, takeover: boolean): string {
  let wsBase = config.wsBaseUrl;
  if (!wsBase) {
    const base = config.apiBaseUrl || location.origin;
    wsBase = base.replace(/^http/, 'ws');
  }
  return `${wsBase}/api/ws/terminal-monitor?sessionId=${encodeURIComponent(sessionId)}${takeover ? '&takeover=1' : ''}`;
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

    // access token 经 Sec-WebSocket-Protocol 子协议传递，不进 URL
    const ws = new WebSocket(buildMonitorWsUrl(sessionId, takeover), wsAuthProtocols(localStorage.getItem(TOKEN_KEY) ?? ''));
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
      <div ref={ref} style={{ flex: 1, minHeight: 0, background: toXtermTheme(themeDef).background, borderRadius: 'var(--semi-border-radius-small)', padding: 4 }} />
    </div>
  );
}

export default function TerminalSessionsPage() {
  const { hasPermission } = usePermission();
  const [autoRefresh, setAutoRefresh] = useState(false);

  interface SearchParams { keyword: string; kind?: TerminalSessionKind }
  const defaultSearchParams: SearchParams = { keyword: '', kind: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, applySearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: terminalKeys.sessionLists });

  // 监控 SideSheet 状态
  const [watching, setWatching] = useState<TerminalSession | null>(null);
  const [takeover, setTakeover] = useState(false);

  const listQuery = useTerminalSessionList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    kind: submittedParams.kind || undefined,
  }, { refetchInterval: autoRefresh ? 5000 : false });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const terminateMutation = useTerminateTerminalSession();

  const handleTerminate = async (record: TerminalSession) => {
    await terminateMutation.mutateAsync({ params: { sessionId: record.sessionId } });
    Toast.success('已强制终止');
  };

  const openWatch = (record: TerminalSession) => {
    setTakeover(false);
    setWatching(record);
  };

  const columns: ColumnProps<TerminalSession>[] = [
    { title: '用户', dataIndex: 'username', width: 140, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'kind', width: 90,
      render: (k: TerminalSessionKind) => <Tag size="small" color={KIND_META[k].color}>{KIND_META[k].label}</Tag>,
    },
    { title: '标签 / 主机', dataIndex: 'label', minWidth: 200, render: renderEllipsis },
    { title: '客户端 IP', dataIndex: 'clientIp', width: 140, render: (v: string) => v || '-' },
    {
      title: '字符网格',
      dataIndex: 'cols',
      width: 140,
      render: (_: number, r) => `${r.cols} 列 × ${r.rows} 行`,
    },
    dateTimeColumn('开始时间', 'startedAt'),
    {
      title: '空闲', dataIndex: 'idleSeconds', width: 90, align: 'right',
      render: (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`),
    },
    {
      title: '状态', dataIndex: 'connected', width: 120, fixed: 'right',
      render: (connected: boolean, r) => (
        <Space spacing={4} wrap>
          {connected ? <Tag size="small" color="green">在线</Tag> : <Tag size="small" color="grey">已断开</Tag>}
          {r.takenOver && <Tag size="small" color="orange">接管中</Tag>}
          {r.observerCount > 0 && <Tag size="small" color="light-blue">监控{r.observerCount}</Tag>}
        </Space>
      ),
    },
    createOperationColumn<TerminalSession>({
      width: 180,
      actions: (record) => [
        {
          key: 'watch',
          label: '监控',
          onClick: () => openWatch(record),
        },
        {
          key: 'terminate',
          label: '强制终止',
          danger: true,
          hidden: !hasPermission('system:terminal:monitor'),
          onClick: () => {
            confirmDanger({
              title: '确定强制终止该会话？',
              onOk: () => { void handleTerminate(record); },
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
            <KeywordInput placeholder="搜索用户/主机/IP" value={draftParams.keyword} onChange={(v) => setDraftParams((s) => ({ ...s, keyword: v }))} onSearch={handleSearch} />
            <FilterSelect
              placeholder="全部类型"
              items={KIND_FILTER_OPTIONS}
              value={draftParams.kind}
              onChange={(kind) => applySearch({ ...draftParams, kind })}
            />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            <Space spacing={4} style={{ marginLeft: 4 }}>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
              <Typography.Text type="tertiary" size="small">自动刷新</Typography.Text>
            </Space>
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索用户/主机/IP" value={draftParams.keyword} onChange={(v) => setDraftParams((s) => ({ ...s, keyword: v }))} onSearch={handleSearch} />
            <SearchButton onClick={handleSearch} />
          </>
        )}
        mobileFilters={(
          <>
            <FilterSelect
              placeholder="全部类型"
              items={KIND_FILTER_OPTIONS}
              value={draftParams.kind}
              onChange={(kind) => applySearch({ ...draftParams, kind })}
            />
            <Space spacing={4}>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
              <Typography.Text type="tertiary" size="small">自动刷新</Typography.Text>
            </Space>
          </>
        )}
        mobileActions={(
          <ResetButton onClick={handleReset} />
        )}
        filterTitle="终端会话筛选"
        actionTitle="终端会话操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="sessionId"
        pagination={buildPagination(total)}
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
