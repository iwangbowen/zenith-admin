import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, SetStateAction } from 'react';
import { Button, Dropdown, Input, Modal, Select, Spin, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Icon } from '@iconify/react';
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, Download, FileText, ListOrdered,
  MoreHorizontal, RefreshCw, Search, StopCircle, Trash2, WrapText,
} from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { formatFileSize } from '@/utils/file-utils';
import { usePermission } from '@/hooks/usePermission';
import { config } from '@/config';
import { TOKEN_KEY } from '@zenith/shared';
import { type LogFile, useDeleteLogFile, useLogFileContent, useLogFiles } from '@/hooks/queries/log-files';
import { buildSearchIndex, computeEffectiveLevels, type LogLevel } from './logFilesSearch';
import { LogContentView } from './LogContentView';

const EMPTY_LOG_FILES: LogFile[] = [];
const EMPTY_LINES: string[] = [];
const MAX_TAIL_LINES = 5000;
const TAIL_RETRY_LIMIT = 3;
const TAIL_RETRY_DELAY_MS = 1500;

const LEVEL_FILTER_OPTIONS = [
  { value: 'all', label: '全部级别' },
  { value: 'error', label: 'ERROR' },
  { value: 'warn', label: 'WARN' },
  { value: 'info', label: 'INFO' },
  { value: 'debug', label: 'DEBUG' },
];

const LINE_COUNT_OPTIONS = [500, 1000, 2000, 5000].map((n) => ({ value: n, label: `最后 ${n} 行` }));

/** 显示偏好持久化到 localStorage */
function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch { /* ignore */ }
    return initialValue;
  });
  const set = useCallback((next: SetStateAction<T>) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch { /* ignore */ }
      return resolved;
    });
  }, [key]);
  return [value, set] as const;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** 打开 tail SSE 连接；401 时借助统一请求层触发 token 刷新后重试一次 */
async function fetchTailStream(fileName: string, signal: AbortSignal): Promise<Response> {
  const doFetch = () => fetch(`${config.apiBaseUrl}/api/log-files/${encodeURIComponent(fileName)}/tail`, {
    headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ''}` },
    signal,
  });
  let res = await doFetch();
  if (res.status === 401) {
    await request.get('/api/log-files', { silent: true });
    res = await doFetch();
  }
  return res;
}

/** 读取 SSE 流，按 chunk 批量回调（而非逐行 setState） */
async function readTailStream(res: Response, onBatch: (batch: string[]) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    const batch: string[] = [];
    for (const part of parts) {
      if (part.startsWith('data:')) {
        const line = part.slice(5).trimStart();
        if (line) batch.push(line);
      }
    }
    if (batch.length > 0) onBatch(batch);
  }
}

export default function LogFilesPage() {
  const { hasPermission } = usePermission();
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<LogFile | null>(null);

  // 内容搜索：输入即时高亮（防抖），全文模式回车提交服务端过滤
  const [searchDraft, setSearchDraft] = useState('');
  const debouncedSearch = useDebouncedValue(searchDraft.trim(), 250);
  const [fullText, setFullText] = useState(false);
  const [serverKeyword, setServerKeyword] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all');

  // 显示偏好（持久化）
  const [showLineNumbers, setShowLineNumbers] = usePersistentState('logFiles.lineNumbers', true);
  const [wrap, setWrap] = usePersistentState('logFiles.wrap', true);
  const [lineCount, setLineCount] = usePersistentState('logFiles.lineCount', 5000);

  // 实时追踪
  const [tailing, setTailing] = useState(false);
  const [tailLines, setTailLines] = useState<string[]>([]);
  const tailAbortRef = useRef<AbortController | null>(null);

  const filesQuery = useLogFiles();
  const files = filesQuery.data ?? EMPTY_LOG_FILES;
  const deleteMutation = useDeleteLogFile();

  const contentParams = useMemo(
    () => ({ lines: lineCount, keyword: fullText && serverKeyword ? serverKeyword : undefined }),
    [lineCount, fullText, serverKeyword],
  );
  const contentQuery = useLogFileContent(selected?.name, contentParams, !!selected && !tailing);
  const refetchContent = contentQuery.refetch;

  const filteredFiles = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return files;
    return files.filter((file) => file.name.toLowerCase().includes(normalizedKeyword));
  }, [files, keyword]);

  // ── 派生数据：级别 → 可见行 → 搜索索引 ──
  const rawLines = tailing ? tailLines : (contentQuery.data?.lines ?? EMPTY_LINES);
  const levels = useMemo(() => computeEffectiveLevels(rawLines), [rawLines]);
  const visibleIndexes = useMemo(() => {
    if (levelFilter === 'all') return rawLines.map((_, i) => i);
    const out: number[] = [];
    levels.forEach((level, i) => {
      if (level === levelFilter) out.push(i);
    });
    return out;
  }, [rawLines, levels, levelFilter]);
  const displayLines = useMemo(
    () => (levelFilter === 'all' ? rawLines : visibleIndexes.map((i) => rawLines[i])),
    [levelFilter, rawLines, visibleIndexes],
  );
  const searchIndex = useMemo(() => buildSearchIndex(displayLines, debouncedSearch), [displayLines, debouncedSearch]);
  const matches = searchIndex.matches;
  const safeMatchIndex = matches.length === 0 ? 0 : Math.min(activeMatchIndex, matches.length - 1);
  const activeMatch = matches[safeMatchIndex] ?? null;

  // ── 实时追踪 ──
  const abortTail = useCallback(() => {
    tailAbortRef.current?.abort();
    tailAbortRef.current = null;
    setTailing(false);
  }, []);

  const stopTail = useCallback(() => {
    const wasTailing = tailAbortRef.current !== null;
    abortTail();
    // 停止追踪后回源拉最新静态内容（refetch 可绕过 enabled）
    if (wasTailing) void refetchContent();
  }, [abortTail, refetchContent]);

  useEffect(() => () => {
    tailAbortRef.current?.abort();
  }, []);

  const toggleTail = async () => {
    if (tailing) {
      stopTail();
      return;
    }
    if (!selected) return;

    const fileName = selected.name;
    const ctrl = new AbortController();
    tailAbortRef.current = ctrl;
    setTailing(true);
    setTailLines([]);
    setServerKeyword('');

    const appendBatch = (batch: string[]) => {
      setTailLines((prev) => (prev.length + batch.length > MAX_TAIL_LINES
        ? [...prev, ...batch].slice(-MAX_TAIL_LINES)
        : [...prev, ...batch]));
    };

    let failures = 0;
    try {
      // 断线自动重连：收到数据即清零计数，连续失败达到上限才停止
      while (!ctrl.signal.aborted) {
        let gotData = false;
        try {
          const res = await fetchTailStream(fileName, ctrl.signal);
          if (res.ok && res.body) {
            await readTailStream(res, (batch) => {
              gotData = true;
              appendBatch(batch);
            });
          }
        } catch (e: unknown) {
          if (ctrl.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
        }
        if (ctrl.signal.aborted) return;
        failures = gotData ? 0 : failures + 1;
        if (failures >= TAIL_RETRY_LIMIT) {
          Toast.error('实时追踪连接中断，已停止');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, TAIL_RETRY_DELAY_MS));
      }
    } finally {
      if (tailAbortRef.current === ctrl) {
        tailAbortRef.current = null;
        setTailing(false);
      }
    }
  };

  // ── 交互 ──
  const selectFile = (file: LogFile) => {
    if (selected?.name === file.name) return;
    abortTail();
    setSelected(file);
    setTailLines([]);
    setSearchDraft('');
    setServerKeyword('');
    setActiveMatchIndex(0);
    setLevelFilter('all');
  };

  const jumpToMatch = useCallback((direction: -1 | 1) => {
    if (matches.length === 0 || tailing) return;
    setActiveMatchIndex((prev) => {
      const current = Math.min(prev, matches.length - 1);
      return (current + direction + matches.length) % matches.length;
    });
  }, [matches.length, tailing]);

  const handleSearchChange = (value: string) => {
    setSearchDraft(value);
    setActiveMatchIndex(0);
    if (!value.trim() && serverKeyword) setServerKeyword('');
  };

  const handleSearchEnter = (e: ReactKeyboardEvent) => {
    if (fullText) {
      setServerKeyword(searchDraft.trim());
      setActiveMatchIndex(0);
      return;
    }
    jumpToMatch(e.shiftKey ? -1 : 1);
  };

  const toggleFullText = () => {
    setFullText((prev) => {
      const next = !prev;
      if (!next) setServerKeyword('');
      else if (searchDraft.trim()) setServerKeyword(searchDraft.trim());
      return next;
    });
  };

  const handleDownload = async (file: LogFile) => {
    try {
      await request.download(`/api/log-files/${encodeURIComponent(file.name)}/download`, file.name);
    } catch {
      Toast.error('下载失败');
    }
  };

  const handleDelete = (file: LogFile) => {
    Modal.confirm({
      title: `确定要删除 ${file.name} 吗？`,
      content: '删除后无法恢复，请谨慎操作。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(file.name);
        Toast.success('删除成功');
        if (selected?.name === file.name) {
          abortTail();
          setSelected(null);
          setTailLines([]);
        }
      },
    });
  };

  const contentLoading = !tailing && contentQuery.isFetching && !contentQuery.data;
  const contentError = !tailing && contentQuery.isError;
  const resetKey = `${selected?.name ?? ''}|${tailing ? 'tail' : 'static'}|${contentQuery.dataUpdatedAt}`;
  const emptyText = tailing
    ? '等待日志输出…'
    : rawLines.length > 0 && levelFilter !== 'all'
      ? '当前级别下无日志'
      : fullText && serverKeyword
        ? '未找到匹配的日志内容'
        : '（文件为空）';

  const matchCounter = debouncedSearch ? (
    <span
      style={{
        fontSize: 11,
        color: 'var(--semi-color-text-2)',
        padding: '0 6px',
        flexShrink: 0,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {matches.length === 0 ? '0/0' : `${safeMatchIndex + 1}/${matches.length}`}
    </span>
  ) : undefined;

  return (
    <MasterDetailLayout
      defaultSize={260}
      minSize={200}
      maxSize={480}
      persistKey="log-files"
      showDetail={selected !== null}
      onBack={() => setSelected(null)}
      master={(
          <NavListPanel
            title="日志文件"
            headerExtra={
              <Button
                icon={<RefreshCw size={13} />}
                size="small"
                theme="borderless"
                loading={filesQuery.isFetching}
                onClick={() => void filesQuery.refetch()}
              />
            }
            search={{
              value: keyword,
              onChange: (value) => setKeyword(value),
              placeholder: '搜索文件名',
            }}
            loading={filesQuery.isFetching}
            emptyText={files.length === 0 ? '暂无日志文件' : '未找到匹配的日志文件'}
            dataSource={filteredFiles}
            renderItem={(file) => {
              const active = selected?.name === file.name;
              return (
                <NavListItem
                  key={file.name}
                  active={active}
                  onClick={() => selectFile(file)}
                  icon={<Icon icon="vscode-icons:file-type-log" width={13} height={13} />}
                  primary={file.name}
                  meta={
                    <>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 4px',
                        borderRadius: 'var(--semi-border-radius-small)',
                        lineHeight: '14px',
                        background: file.isGzip ? 'var(--semi-color-fill-2)' : 'var(--semi-color-primary-light-default)',
                        color: file.isGzip ? 'var(--semi-color-text-2)' : 'var(--semi-color-primary)',
                      }}>
                        {file.isGzip ? 'gz' : 'log'}
                      </span>
                      <span>{formatFileSize(file.size)}</span>
                      <span>{formatDateTime(file.modifiedAt)}</span>
                    </>
                  }
                  extra={
                    <Dropdown
                      trigger="click"
                      position="bottomRight"
                      clickToHide
                      render={
                        <Dropdown.Menu>
                          {hasPermission('system:log:files:download') && (
                            <Dropdown.Item onClick={() => void handleDownload(file)}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Download size={14} /> 下载
                              </span>
                            </Dropdown.Item>
                          )}
                          {hasPermission('system:log:files:delete') && (
                            <Dropdown.Item
                              type="danger"
                              onClick={() => handleDelete(file)}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Trash2 size={14} /> 删除
                              </span>
                            </Dropdown.Item>
                          )}
                        </Dropdown.Menu>
                      }
                    >
                      <Button
                        theme="borderless"
                        size="small"
                        icon={<MoreHorizontal size={14} />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
                  }
                />
              );
            }}
          />
      )}
      detail={(
        <>
          {selected ? (
            <>
            {/* 顶部工具栏 */}
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--semi-color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}>
              <Icon icon="vscode-icons:file-type-log" width={14} height={14} style={{ flexShrink: 0 }} />
              <Typography.Text style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
                {selected.name}
              </Typography.Text>
              {tailing && (
                <Tag color="green" size="small">
                  <Activity size={10} style={{ marginRight: 4 }} />实时追踪中
                </Tag>
              )}
              {tailing && tailLines.length >= MAX_TAIL_LINES && (
                <Tag color="orange" size="small">仅保留最近 {MAX_TAIL_LINES} 行</Tag>
              )}
              {!tailing && fullText && serverKeyword && (
                <Tag color="purple" size="small" closable onClose={() => setServerKeyword('')}>
                  全文过滤：{serverKeyword}
                </Tag>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Input
                  prefix={<Search size={14} />}
                  suffix={matchCounter}
                  placeholder={fullText ? '全文搜索，回车提交' : '搜索日志内容'}
                  value={searchDraft}
                  onChange={handleSearchChange}
                  onEnterPress={handleSearchEnter}
                  showClear
                  size="small"
                  style={{ width: 240 }}
                />
                <Tooltip content="上一个匹配（Shift+Enter）">
                  <Button
                    size="small"
                    theme="borderless"
                    icon={<ArrowUp size={13} />}
                    disabled={matches.length === 0 || tailing}
                    onClick={() => jumpToMatch(-1)}
                  />
                </Tooltip>
                <Tooltip content="下一个匹配（Enter）">
                  <Button
                    size="small"
                    theme="borderless"
                    icon={<ArrowDown size={13} />}
                    disabled={matches.length === 0 || tailing}
                    onClick={() => jumpToMatch(1)}
                  />
                </Tooltip>
                <Tooltip content="全文搜索：按关键词过滤整个文件（服务端），回车提交">
                  <Button
                    size="small"
                    theme={fullText ? 'solid' : 'borderless'}
                    type={fullText ? 'primary' : 'tertiary'}
                    disabled={tailing}
                    onClick={toggleFullText}
                  >
                    全文
                  </Button>
                </Tooltip>
                <Select
                  size="small"
                  value={levelFilter}
                  onChange={(value) => setLevelFilter(value as 'all' | LogLevel)}
                  optionList={LEVEL_FILTER_OPTIONS}
                  style={{ width: 108 }}
                />
                <Select
                  size="small"
                  value={lineCount}
                  onChange={(value) => setLineCount(value as number)}
                  optionList={LINE_COUNT_OPTIONS}
                  disabled={tailing}
                  style={{ width: 122 }}
                />
                {!selected.isGzip && hasPermission('system:log:files') && (
                  <Button
                    size="small"
                    icon={tailing ? <StopCircle size={13} /> : <Activity size={13} />}
                    type={tailing ? 'danger' : 'primary'}
                    theme="light"
                    onClick={() => void toggleTail()}
                  >
                    {tailing ? '停止追踪' : '实时追踪'}
                  </Button>
                )}
                <Tooltip content={showLineNumbers ? '隐藏行号' : '显示行号'}>
                  <Button
                    size="small"
                    theme={showLineNumbers ? 'light' : 'borderless'}
                    type={showLineNumbers ? 'primary' : 'tertiary'}
                    icon={<ListOrdered size={13} />}
                    onClick={() => setShowLineNumbers((v) => !v)}
                  />
                </Tooltip>
                <Tooltip content={wrap ? '关闭自动换行' : '开启自动换行'}>
                  <Button
                    size="small"
                    theme={wrap ? 'light' : 'borderless'}
                    type={wrap ? 'primary' : 'tertiary'}
                    icon={<WrapText size={13} />}
                    onClick={() => setWrap((v) => !v)}
                  />
                </Tooltip>
                {hasPermission('system:log:files') && (
                  <Tooltip content="刷新">
                    <Button
                      size="small"
                      theme="borderless"
                      icon={<RefreshCw size={13} />}
                      loading={!tailing && contentQuery.isFetching}
                      disabled={tailing}
                      onClick={() => void refetchContent()}
                    />
                  </Tooltip>
                )}
                {hasPermission('system:log:files:download') && (
                  <Tooltip content="下载">
                    <Button
                      size="small"
                      theme="borderless"
                      icon={<Download size={13} />}
                      onClick={() => void handleDownload(selected)}
                    />
                  </Tooltip>
                )}
                {hasPermission('system:log:files:delete') && (
                  <Tooltip content="删除">
                    <Button
                      size="small"
                      theme="borderless"
                      type="danger"
                      icon={<Trash2 size={13} />}
                      onClick={() => handleDelete(selected)}
                    />
                  </Tooltip>
                )}
              </div>
            </div>

            {/* 日志内容 */}
            {contentError ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <AlertTriangle size={32} style={{ color: 'var(--semi-color-danger)' }} />
                <Typography.Text type="tertiary">日志内容加载失败</Typography.Text>
                <Button size="small" theme="light" type="primary" icon={<RefreshCw size={13} />} onClick={() => void refetchContent()}>
                  重试
                </Button>
              </div>
            ) : contentLoading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin size="large" />
              </div>
            ) : (
              <LogContentView
                lines={rawLines}
                visibleIndexes={visibleIndexes}
                levels={levels}
                lineRanges={searchIndex.lineRanges}
                activeMatch={activeMatch}
                showLineNumbers={showLineNumbers}
                wrap={wrap}
                following={tailing}
                resetKey={resetKey}
                emptyText={emptyText}
              />
            )}
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <FileText size={40} style={{ color: 'var(--semi-color-text-3)' }} />
              <Typography.Text type="tertiary">请从左侧选择一个日志文件查看</Typography.Text>
            </div>
          )}
        </>
      )}
    />
  );
}
