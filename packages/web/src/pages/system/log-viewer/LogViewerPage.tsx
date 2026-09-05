import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, Tag, Typography, Select, Switch,
} from '@douyinfe/semi-ui';
import { FolderOpen, Play, Square, Search, FileText, Download } from 'lucide-react';
import { request } from '@/utils/request';
import { streamText } from '@/utils/streaming';
import { logViewerDownloadUrl, logViewerKeys, logViewerStreamUrl, useLogViewerContent, useLogViewerRoots } from '@/hooks/queries/log-viewer';
import { HostSelector } from '@/components/HostSelector';
import { useOpsHostSelection } from '@/hooks/useOpsHostSelection';
import { FilterSelect } from '@/components/search-filters';

// ─── ANSI 颜色解析器 ────────────────────────────────────────────────────────
const ANSI_FG = ['#3c3c3c','#c0392b','#27ae60','#d4ac0d','#2980b9','#8e44ad','#17a589','#bdc3c7'];
const ANSI_FG_BRIGHT = ['#7f8c8d','#e74c3c','#2ecc71','#f1c40f','#3498db','#9b59b6','#1abc9c','#ecf0f1'];

interface AnsiSpan { text: string; color?: string; bg?: string; bold?: boolean; italic?: boolean; dim?: boolean }

function parseAnsi(raw: string): AnsiSpan[] {
  const result: AnsiSpan[] = [];
  let color: string | undefined;
  let bg: string | undefined;
  let bold = false; let italic = false; let dim = false;
  const segs = raw.split(
    // eslint-disable-next-line no-control-regex
    /(\x1b\[[0-9;]*m)/,
  );
  for (const seg of segs) {
    if (seg.startsWith('\x1b[') && seg.endsWith('m')) {
      const codes = seg.slice(2, -1).split(';').map(Number);
      for (const code of codes) {
        if (code === 0) { color = undefined; bg = undefined; bold = false; italic = false; dim = false; }
        else if (code === 1) { bold = true; }
        else if (code === 2) { dim = true; }
        else if (code === 3) { italic = true; }
        else if (code === 22) { bold = false; dim = false; }
        else if (code === 23) { italic = false; }
        else if (code === 39) { color = undefined; }
        else if (code === 49) { bg = undefined; }
        else if (code >= 30 && code <= 37) { color = ANSI_FG[code - 30]; }
        else if (code >= 90 && code <= 97) { color = ANSI_FG_BRIGHT[code - 90]; }
        else if (code >= 40 && code <= 47) { bg = ANSI_FG[code - 40]; }
      }
    } else if (seg) {
      result.push({ text: seg, color, bg, bold: bold || undefined, italic: italic || undefined, dim: dim || undefined });
    }
  }
  return result;
}

/** 去除所有 ANSI 转义序列（用于关键词匹配） */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replaceAll(/\x1b\[[0-9;]*m/g, '');
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
const LEVEL_BORDER: Record<LogLevel, string> = { error: '#e74c3c', warn: '#f39c12', info: '#3498db', debug: '#95a5a6' };
const LEVEL_RE: Record<LogLevel, RegExp> = {
  error: /\b(error|err|fatal|critical|crit|panic|emerg|fail(ed|ure)?)\b/i,
  warn: /\b(warn(ing)?)\b/i,
  info: /\b(info|notice)\b/i,
  debug: /\b(debug|trace|verbose)\b/i,
};
/** 检测一行日志的级别（按优先级 error>warn>info>debug） */
function detectLevel(line: string): LogLevel | null {
  const s = stripAnsi(line);
  if (LEVEL_RE.error.test(s)) return 'error';
  if (LEVEL_RE.warn.test(s)) return 'warn';
  if (LEVEL_RE.info.test(s)) return 'info';
  if (LEVEL_RE.debug.test(s)) return 'debug';
  return null;
}

/** 渲染单行（含 ANSI 颜色 + 日志级别高亮） */
function AnsiLine({ raw, highlight, level }: { raw: string; highlight: boolean; level: LogLevel | null }) {
  const spans = useMemo(() => parseAnsi(raw), [raw]);
  const levelStyle = level && !highlight
    ? { display: 'block', borderLeft: `3px solid ${LEVEL_BORDER[level]}`, paddingLeft: 4, background: level === 'error' ? 'rgba(231,76,60,0.07)' : level === 'warn' ? 'rgba(243,156,18,0.06)' : undefined }
    : undefined;
  const hlStyle = highlight ? { background: 'rgba(255,230,0,0.25)', display: 'block', borderLeft: '3px solid #f1c40f', paddingLeft: 4 } : undefined;
  return (
    <span style={hlStyle ?? levelStyle}>
      {spans.map((s, i) => (
        <span key={i} style={{
          color: s.color,
          backgroundColor: s.bg,
          fontWeight: s.bold ? 'bold' : undefined,
          fontStyle: s.italic ? 'italic' : undefined,
          opacity: s.dim ? 0.6 : undefined,
        }}>
          {s.text}
        </span>
      ))}
    </span>
  );
}

/** 常用日志路径 */
const COMMON_LOG_PATHS = [
  '/var/log/syslog',
  '/var/log/messages',
  '/var/log/auth.log',
  '/var/log/kern.log',
  '/var/log/nginx/access.log',
  '/var/log/nginx/error.log',
  '/var/log/apache2/access.log',
  '/var/log/apache2/error.log',
  '/var/log/mysql/error.log',
  '/var/log/postgresql/postgresql.log',
  '/var/log/redis/redis-server.log',
];

export default function LogViewerPage() {
  const queryClient = useQueryClient();
  const [filePath, setFilePath] = useState('');
  const [submittedPath, setSubmittedPath] = useState('');
  // 深链:?path= 直接加载指定日志(Nginx 站点页等跳入),消费后清空参数
  const [searchParams, setSearchParams] = useSearchParams();
  const initialHostId = (() => {
    const value = Number(searchParams.get('hostId'));
    return Number.isInteger(value) && value > 0 ? value : null;
  })();
  // 显式 ?path= 且无 hostId 的站内深链（如本机 Nginx 日志）必须落本机，
  // 不能被上一次持久化的远端主机选择污染。
  const [hostId, setHostId] = useOpsHostSelection(
    searchParams.has('hostId') ? initialHostId : searchParams.has('path') ? null : undefined,
  );
  useEffect(() => {
    const p = searchParams.get('path');
    if (!p) return;
    setFilePath(p);
    setSubmittedPath(p);
    setSearchParams(hostId == null ? {} : { hostId: String(hostId) }, { replace: true });
  }, [searchParams, setSearchParams, hostId]);
  const [keyword, setKeyword] = useState('');
  const [filterOnly, setFilterOnly] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string | undefined>();
  const [content, setContent] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [following, setFollowing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentParams = { path: submittedPath, lines: 500, ...(hostId == null ? {} : { hostId }) };
  const contentQuery = useLogViewerContent(contentParams, !!submittedPath && !following);
  const rootsQuery = useLogViewerRoots(hostId ?? undefined);


  // 追踪模式下自动滚到底部
  useEffect(() => {
    if (following && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, following]);

  // 组件卸载清理
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    if (!following && contentQuery.data) {
      setContent(contentQuery.data.content);
    }
  }, [contentQuery.data, following]);

  const loadContent = useCallback(() => {
    const path = filePath.trim();
    if (!path) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setFollowing(false);
    if (path === submittedPath) {
      void queryClient.invalidateQueries({
        queryKey: logViewerKeys.content({ path, lines: 500, ...(hostId == null ? {} : { hostId }) }),
      });
      void contentQuery.refetch();
      return;
    }
    setSubmittedPath(path);
  }, [contentQuery, filePath, queryClient, submittedPath, hostId]);

  const startFollow = useCallback(() => {
    if (!filePath.trim()) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setFollowing(true);
    void streamText(logViewerStreamUrl(filePath.trim(), hostId), (text) => setContent((prev) => prev + text), abort.signal)
      .catch(() => { /* abort = ok */ })
      .finally(() => setFollowing(false));
  }, [filePath, hostId]);

  const stopFollow = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setFollowing(false);
    setContent((prev) => `${prev}\n\n⬛ 已停止追踪\n`);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!filePath.trim()) return;
    setDownloading(true);
    try {
      const name = filePath.trim().split('/').pop() ?? 'log.txt';
      await request.download(logViewerDownloadUrl(filePath.trim(), hostId), name);
    } finally {
      setDownloading(false);
    }
  }, [filePath, hostId]);

  // 按关键词过滤行（在去除 ANSI 码的文本上匹配）+ 级别过滤 + 级别检测
  const displayLines = useMemo(() => {
    const lines = content.split('\n');
    const kw = keyword.trim().toLowerCase();
    return lines
      .map((raw) => ({ raw, level: detectLevel(raw), highlight: kw ? stripAnsi(raw).toLowerCase().includes(kw) : false }))
      .filter((l) => (!filterOnly || !kw || l.highlight) && (!levelFilter || l.level === levelFilter));
  }, [content, keyword, filterOnly, levelFilter]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 12 }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={18} style={{ color: 'var(--semi-color-primary)' }} />
        <Typography.Title heading={6} style={{ margin: 0 }}>日志查看器</Typography.Title>
        <HostSelector
          value={hostId}
          onChange={(next) => {
            abortRef.current?.abort();
            setFollowing(false);
            setHostId(next);
            setSubmittedPath('');
            setContent('');
          }}
        />
      </div>

      {/* 文件路径区 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Typography.Text size="small" type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            日志文件路径
            {rootsQuery.data && (
              <span style={{ marginLeft: 8 }}>
                （仅允许：{rootsQuery.data.roots.length > 0 ? rootsQuery.data.roots.join('、') : '未配置 LOG_VIEWER_ROOTS'}）
              </span>
            )}
          </Typography.Text>
          <Input
            prefix={<FolderOpen size={13} />}
            placeholder="/var/log/syslog"
            value={filePath}
            onChange={setFilePath}
            showClear
            onEnterPress={() => void loadContent()}
          />
        </div>
        <div style={{ minWidth: 200 }}>
          <Typography.Text size="small" type="secondary" style={{ display: 'block', marginBottom: 4 }}>常用路径</Typography.Text>
          <Select
            placeholder="选择常用路径"
            onChange={(v) => setFilePath(v as string)}
            style={{ width: '100%' }}
            optionList={COMMON_LOG_PATHS.map((p) => ({ value: p, label: p.split('/').pop() ?? p }))}
          />
        </div>
        <Button type="primary" icon={<FolderOpen size={13} />} loading={contentQuery.isFetching} onClick={() => void loadContent()}>
          加载
        </Button>
        {!following
          ? <Button icon={<Play size={13} />} onClick={startFollow} disabled={!filePath.trim()}>追踪末尾</Button>
          : <Button type="danger" icon={<Square size={13} />} onClick={stopFollow}>停止追踪</Button>
        }
        <Button icon={<Download size={13} />} loading={downloading} onClick={() => void handleDownload()} disabled={!filePath.trim()}>下载</Button>
      </div>

      {/* 关键词过滤区 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Input
            prefix={<Search size={13} />}
            placeholder="关键词高亮"
            value={keyword}
            onChange={setKeyword}
            showClear
            style={{ width: 220 }}
          />
          <Typography.Text size="small" type="secondary">仅显示匹配行</Typography.Text>
          <Switch size="small" checked={filterOnly} onChange={setFilterOnly} />
        </div>
        <FilterSelect
          placeholder="全部级别"
          items={[
            { label: 'ERROR', value: 'error' },
            { label: 'WARN', value: 'warn' },
            { label: 'INFO', value: 'info' },
            { label: 'DEBUG', value: 'debug' },
          ]}
          value={levelFilter}
          onChange={setLevelFilter}
          size="small"
        />
        {following && <Tag color="green" size="small">● 实时追踪中</Tag>}
        {content && (
          <Typography.Text size="small" type="tertiary">
            {displayLines.length} 行{keyword && ` / 全 ${content.split('\n').length} 行`}
          </Typography.Text>
        )}
        {content && (
          <Button size="small" theme="borderless" type="tertiary" onClick={() => setContent('')}>清空</Button>
        )}
      </div>

      {/* 输出区（ANSI 色彩渲染） */}
      <div style={{ flex: 1, minHeight: 0, borderRadius: 'var(--semi-border-radius-medium)', overflow: 'hidden', border: '1px solid var(--semi-color-border)' }}>
        <div
          ref={scrollRef}
          style={{
            padding: '8px 12px',
            fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: 12,
            lineHeight: 1.6,
            background: 'var(--surface-card)',
            height: '100%',
            overflow: 'auto',
            color: 'var(--semi-color-text-0)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {displayLines.length > 0 && content
            ? displayLines.map((line, i) => (
                <AnsiLine key={i} raw={line.raw} highlight={line.highlight} level={line.level} />
              ))
            : (
              <Typography.Text type="tertiary" style={{ fontStyle: 'italic' }}>
                {contentQuery.isFetching ? '加载中...' : '请选择日志文件并点击「加载」'}
              </Typography.Text>
            )
          }
        </div>
      </div>
    </div>
  );
}
