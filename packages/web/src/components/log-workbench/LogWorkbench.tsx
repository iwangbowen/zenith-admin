import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, SetStateAction } from 'react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { Button, Dropdown, Input, InputNumber, Modal, Select, Spin, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, CaseSensitive, Copy, FileDown, FileText, Hash,
  ListFilter, ListOrdered, MoreHorizontal, Pause, Play, RefreshCw, Regex, Search, StopCircle, WrapText,
} from 'lucide-react';
import { FilterSelect } from '@/components/search-filters';
import { copyTextWithToast } from '@/utils/clipboard';
import { logSourceName, logSourceTailUrl, useLogSourceContent, type LogSource } from '@/hooks/queries/log-source';
import { hasAnsi, stripAnsi } from './ansi';
import { buildSearchIndex, compileSearchPattern, computeEffectiveLevels, type LogLevel, type MatchRange, type SearchMatch } from './log-search';
import { LogContentView, type LogContentViewHandle } from './LogContentView';
import { MAX_TAIL_LINES, useLogTail } from './useLogTail';

const EMPTY_LINES: string[] = [];

const LEVEL_FILTER_VALUES: Array<{ value: LogLevel; label: string }> = [
  { value: 'error', label: 'ERROR' },
  { value: 'warn', label: 'WARN' },
  { value: 'info', label: 'INFO' },
  { value: 'debug', label: 'DEBUG' },
];

const LINE_COUNT_OPTIONS = [500, 1000, 2000, 5000].map((n) => ({ value: n, label: `最后 ${n} 行` }));

const CONTEXT_OPTIONS = [0, 2, 5, 10].map((n) => ({ value: n, label: n === 0 ? '无上下文' : `上下文 ±${n} 行` }));

/** 显示偏好持久化到 localStorage（两处日志页面共享同一份偏好） */
function usePersistentState<T>(key: string, initialValue: T) {
  const storageKey = `logWorkbench.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch { /* ignore */ }
    return initialValue;
  });
  const set = useCallback((next: SetStateAction<T>) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(storageKey, JSON.stringify(resolved));
      } catch { /* ignore */ }
      return resolved;
    });
  }, [storageKey]);
  return [value, set] as const;
}

export interface LogWorkbenchProps {
  /** 日志来源；切换来源时父级用 `key={logSourceKey(source)}` 重挂载，搜索 / 级别 / 追踪状态随之重置 */
  source: LogSource;
  /** 头部标题（图标 + 名称）；缺省为来源名称 */
  title?: ReactNode;
  /** 允许实时追踪（压缩归档 / 无权限时传 false） */
  canTail?: boolean;
  /** 初始级别过滤（深链 `?level=`），仅挂载时读取 */
  initialLevel?: LogLevel;
  /** 追加到头部状态标签之后的内容 */
  headerExtra?: ReactNode;
  /** 追加到「更多」菜单末尾的页面专属动作（下载 / 删除等） */
  menuExtra?: ReactNode;
  /** 导出 txt 的文件名主体；缺省取来源名称 */
  exportName?: string;
}

/**
 * 日志工作台：末尾 N 行 / 服务端全文过滤 / 实时追踪 + 虚拟滚动查看器 + 搜索 / 级别筛选 / 复制导出。
 * 「日志文件」与「日志查看器」两个页面共用，只需提供来源与页面专属动作。
 */
export function LogWorkbench({ source, title, canTail = true, initialLevel, headerExtra, menuExtra, exportName }: LogWorkbenchProps) {
  // 内容搜索：输入即时高亮（防抖），全文模式回车提交服务端过滤
  const [searchDraft, setSearchDraft] = useState('');
  const debouncedSearch = useDebouncedValue(searchDraft.trim(), { wait: 250 })[0];
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  /** 仅显示匹配行（grep 模式） */
  const [matchesOnly, setMatchesOnly] = useState(false);
  const [fullText, setFullText] = useState(false);
  const [serverKeyword, setServerKeyword] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [levelFilter, setLevelFilter] = useState<LogLevel | undefined>(initialLevel);

  // 显示偏好（持久化）
  const [showLineNumbers, setShowLineNumbers] = usePersistentState('lineNumbers', true);
  const [wrap, setWrap] = usePersistentState('wrap', true);
  const [lineCount, setLineCount] = usePersistentState('lineCount', 5000);
  const [serverContext, setServerContext] = usePersistentState('context', 0);

  // 跳到行号
  const contentViewRef = useRef<LogContentViewHandle | null>(null);
  const [gotoValue, setGotoValue] = useState<number | null>(null);
  const [gotoVisible, setGotoVisible] = useState(false);

  const contentParams = useMemo(
    () => ({
      lines: lineCount,
      keyword: fullText && serverKeyword ? serverKeyword : undefined,
      context: fullText && serverKeyword && serverContext > 0 ? serverContext : undefined,
    }),
    [lineCount, fullText, serverKeyword, serverContext],
  );

  const tailUrl = canTail ? logSourceTailUrl(source) : null;
  const tail = useLogTail(tailUrl);
  const { tailing, paused: tailPaused } = tail;
  // 追踪中不拉静态内容
  const contentQuery = useLogSourceContent(source, contentParams, !tailing);
  const refetchContent = contentQuery.refetch;

  // ── 派生数据：ANSI 去色 → 级别过滤（base 层）→ 搜索索引 → grep 模式（display 层） ──
  const rawLines = tailing ? tail.lines : (contentQuery.data?.lines ?? EMPTY_LINES);
  // 搜索 / 级别识别 / 复制导出都基于去色文本；无 ANSI 时复用同一数组，不多占内存
  const plainLines = useMemo(() => (rawLines.some(hasAnsi) ? rawLines.map(stripAnsi) : rawLines), [rawLines]);
  const levels = useMemo(() => computeEffectiveLevels(plainLines), [plainLines]);

  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0 };
    for (const level of levels) {
      if (level) counts[level] += 1;
    }
    return counts;
  }, [levels]);
  const levelOptions = useMemo(
    () => LEVEL_FILTER_VALUES.map(({ value, label }) => ({ value, label: `${label} (${levelCounts[value]})` })),
    [levelCounts],
  );

  const baseIndexes = useMemo(() => {
    if (!levelFilter) return plainLines.map((_, i) => i);
    const out: number[] = [];
    levels.forEach((level, i) => {
      if (level === levelFilter) out.push(i);
    });
    return out;
  }, [plainLines, levels, levelFilter]);
  const baseLines = useMemo(
    () => (levelFilter ? baseIndexes.map((i) => plainLines[i]) : plainLines),
    [levelFilter, plainLines, baseIndexes],
  );

  const searchPattern = useMemo(
    () => compileSearchPattern(debouncedSearch, { regex: searchRegex, caseSensitive: searchCaseSensitive }),
    [debouncedSearch, searchRegex, searchCaseSensitive],
  );
  const searchInvalid = searchRegex && debouncedSearch !== '' && searchPattern === null;
  const searchIndex = useMemo(() => buildSearchIndex(baseLines, searchPattern), [baseLines, searchPattern]);

  const grepActive = matchesOnly && searchPattern !== null;
  const { displayIndexes, displayLines, displayRanges, displayMatches } = useMemo(() => {
    if (!grepActive) {
      return {
        displayIndexes: baseIndexes,
        displayLines: baseLines,
        displayRanges: searchIndex.lineRanges,
        displayMatches: searchIndex.matches,
      };
    }
    // 仅保留匹配行，并把 base 下标重映射为紧凑的展示下标
    const matchedBase = [...searchIndex.lineRanges.keys()].sort((a, b) => a - b);
    const baseToDisplay = new Map(matchedBase.map((b, i) => [b, i]));
    const ranges = new Map<number, MatchRange[]>();
    matchedBase.forEach((b, i) => {
      const r = searchIndex.lineRanges.get(b);
      if (r) ranges.set(i, r);
    });
    return {
      displayIndexes: matchedBase.map((b) => baseIndexes[b]),
      displayLines: matchedBase.map((b) => baseLines[b]),
      displayRanges: ranges,
      displayMatches: searchIndex.matches.map((m): SearchMatch => ({ ...m, lineIndex: baseToDisplay.get(m.lineIndex) ?? 0 })),
    };
  }, [grepActive, baseIndexes, baseLines, searchIndex]);

  const matches = displayMatches;
  const safeMatchIndex = matches.length === 0 ? 0 : Math.min(activeMatchIndex, matches.length - 1);
  const activeMatch = matches[safeMatchIndex] ?? null;

  // ── 交互 ──
  const toggleTail = () => {
    if (tailing) {
      tail.stop();
      // 停止追踪后回源拉最新静态内容（refetch 可绕过 enabled）
      void refetchContent();
      return;
    }
    // 追踪流不支持服务端过滤：清掉全文关键词，避免停止后按旧条件回源
    setServerKeyword('');
    void tail.start();
  };

  const jumpToMatch = useCallback((direction: -1 | 1) => {
    if (matches.length === 0 || (tailing && !tailPaused)) return;
    setActiveMatchIndex((prev) => {
      const current = Math.min(prev, matches.length - 1);
      return (current + direction + matches.length) % matches.length;
    });
  }, [matches.length, tailing, tailPaused]);

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

  // ── 复制 / 导出（去色文本） ──
  const handleCopy = async (mode: 'view' | 'all') => {
    const text = mode === 'all' ? plainLines : displayLines;
    if (text.length === 0) {
      Toast.info('没有可复制的内容');
      return;
    }
    await copyTextWithToast(text.join('\n'), { success: `已复制 ${text.length} 行`, error: '复制失败，请检查浏览器剪贴板权限' });
  };

  const handleExportView = () => {
    if (displayLines.length === 0) {
      Toast.info('没有可导出的内容');
      return;
    }
    const blob = new Blob([displayLines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(exportName ?? logSourceName(source)).replace(/\.log(\.gz)?$/, '')}-filtered.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGotoLine = () => {
    if (!gotoValue || rawLines.length === 0) return;
    contentViewRef.current?.scrollToOriginalLine(Math.min(Math.max(1, gotoValue), rawLines.length));
  };

  const contentLoading = !tailing && contentQuery.isFetching && !contentQuery.data;
  const contentError = !tailing && contentQuery.isError;
  const resetKey = `${tailing ? 'tail' : 'static'}|${contentQuery.dataUpdatedAt}`;
  let emptyText: string;
  if (tailing) {
    emptyText = '等待日志输出…';
  } else if (rawLines.length > 0 && grepActive) {
    emptyText = '无匹配行';
  } else if (rawLines.length > 0 && levelFilter) {
    emptyText = '当前级别下无日志';
  } else if (fullText && serverKeyword) {
    emptyText = '未找到匹配的日志内容';
  } else {
    emptyText = '（文件为空）';
  }

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
        {title ?? (
          <>
            <FileText size={14} style={{ flexShrink: 0, color: 'var(--semi-color-primary)' }} />
            <Typography.Text style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
              {logSourceName(source)}
            </Typography.Text>
          </>
        )}
        {tailing && !tailPaused && (
          <Tag color="green" size="small">
            <Activity size={10} style={{ marginRight: 4 }} />实时追踪中
          </Tag>
        )}
        {tailing && tailPaused && (
          <Tag color="orange" size="small">
            <Pause size={10} style={{ marginRight: 4 }} />
            已暂停{tail.pendingCount > 0 ? ` · 积压 ${tail.pendingCount} 行` : ''}
          </Tag>
        )}
        {tailing && tail.reconnecting && (
          <Tag color="red" size="small">连接中断，重连中…</Tag>
        )}
        {tailing && tail.capped && (
          <Tag color="orange" size="small">仅保留最近 {MAX_TAIL_LINES} 行</Tag>
        )}
        {!tailing && fullText && serverKeyword && (
          <Tag color="purple" size="small" closable onClose={() => setServerKeyword('')}>
            全文过滤：{serverKeyword}
          </Tag>
        )}
        {headerExtra}
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
            validateStatus={searchInvalid ? 'error' : 'default'}
            style={{ width: 240 }}
          />
          <Tooltip content={searchInvalid ? '正则表达式无效' : '按正则表达式搜索'}>
            <Button
              size="small"
              theme={searchRegex ? 'light' : 'borderless'}
              type={searchInvalid ? 'danger' : searchRegex ? 'primary' : 'tertiary'}
              icon={<Regex size={13} />}
              onClick={() => { setSearchRegex((v) => !v); setActiveMatchIndex(0); }}
            />
          </Tooltip>
          <Tooltip content="区分大小写">
            <Button
              size="small"
              theme={searchCaseSensitive ? 'light' : 'borderless'}
              type={searchCaseSensitive ? 'primary' : 'tertiary'}
              icon={<CaseSensitive size={15} />}
              onClick={() => { setSearchCaseSensitive((v) => !v); setActiveMatchIndex(0); }}
            />
          </Tooltip>
          <Tooltip content="仅显示匹配行（grep 模式）">
            <Button
              size="small"
              theme={matchesOnly ? 'light' : 'borderless'}
              type={matchesOnly ? 'primary' : 'tertiary'}
              icon={<ListFilter size={13} />}
              onClick={() => { setMatchesOnly((v) => !v); setActiveMatchIndex(0); }}
            />
          </Tooltip>
          <Tooltip content="上一个匹配（Shift+Enter）">
            <Button
              size="small"
              theme="borderless"
              icon={<ArrowUp size={13} />}
              disabled={matches.length === 0 || (tailing && !tailPaused)}
              onClick={() => jumpToMatch(-1)}
            />
          </Tooltip>
          <Tooltip content="下一个匹配（Enter）">
            <Button
              size="small"
              theme="borderless"
              icon={<ArrowDown size={13} />}
              disabled={matches.length === 0 || (tailing && !tailPaused)}
              onClick={() => jumpToMatch(1)}
            />
          </Tooltip>
          {!tailing && (
            <Tooltip content="全文搜索：按关键词过滤整个文件（服务端），回车提交">
              <Button
                size="small"
                theme={fullText ? 'solid' : 'borderless'}
                type={fullText ? 'primary' : 'tertiary'}
                onClick={toggleFullText}
              >
                全文
              </Button>
            </Tooltip>
          )}
          {fullText && !tailing && (
            <Select
              size="small"
              value={serverContext}
              onChange={(value) => setServerContext(value as number)}
              optionList={CONTEXT_OPTIONS}
              style={{ width: 128 }}
            />
          )}
          <FilterSelect
            placeholder="全部级别"
            items={levelOptions}
            value={levelFilter}
            onChange={(value) => { setLevelFilter(value); setActiveMatchIndex(0); }}
            size="small"
          />
          {/* 追踪中隐藏而非置灰：行数/全文/刷新此时不生效，腾出的宽度正好容纳暂停/停止，避免工具栏换行跳动 */}
          {!tailing && (
            <Select
              size="small"
              value={lineCount}
              onChange={(value) => setLineCount(value as number)}
              optionList={LINE_COUNT_OPTIONS}
              style={{ width: 122 }}
            />
          )}
          {canTail && (
            tailing ? (
              <>
                <Button
                  size="small"
                  icon={tailPaused ? <Play size={13} /> : <Pause size={13} />}
                  theme="light"
                  onClick={() => (tailPaused ? tail.resume() : tail.pause())}
                >
                  {tailPaused ? '继续' : '暂停'}
                </Button>
                <Button
                  size="small"
                  icon={<StopCircle size={13} />}
                  type="danger"
                  theme="light"
                  onClick={toggleTail}
                >
                  停止
                </Button>
              </>
            ) : (
              <Button
                size="small"
                icon={<Activity size={13} />}
                type="primary"
                theme="light"
                onClick={toggleTail}
              >
                实时追踪
              </Button>
            )
          )}
          {!tailing && (
            <Tooltip content="刷新">
              <Button
                size="small"
                theme="borderless"
                icon={<RefreshCw size={13} />}
                loading={contentQuery.isFetching}
                onClick={() => void refetchContent()}
              />
            </Tooltip>
          )}
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                <Dropdown.Item disabled={rawLines.length === 0} onClick={() => setGotoVisible(true)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Hash size={14} /> 跳到行号
                  </span>
                </Dropdown.Item>
                <Dropdown.Item onClick={() => setShowLineNumbers((v) => !v)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ListOrdered size={14} /> {showLineNumbers ? '隐藏行号' : '显示行号'}
                  </span>
                </Dropdown.Item>
                <Dropdown.Item onClick={() => setWrap((v) => !v)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <WrapText size={14} /> {wrap ? '关闭自动换行' : '开启自动换行'}
                  </span>
                </Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item disabled={rawLines.length === 0} onClick={() => void handleCopy('view')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Copy size={14} /> 复制当前视图（{displayLines.length} 行）
                  </span>
                </Dropdown.Item>
                <Dropdown.Item disabled={rawLines.length === 0} onClick={() => void handleCopy('all')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Copy size={14} /> 复制全部（{rawLines.length} 行）
                  </span>
                </Dropdown.Item>
                <Dropdown.Item disabled={rawLines.length === 0} onClick={handleExportView}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileDown size={14} /> 导出当前视图为 txt
                  </span>
                </Dropdown.Item>
                {menuExtra && <Dropdown.Divider />}
                {menuExtra}
              </Dropdown.Menu>
            }
          >
            <span style={{ display: 'inline-flex' }}>
              <Tooltip content="更多操作">
                <Button size="small" theme="borderless" icon={<MoreHorizontal size={13} />} />
              </Tooltip>
            </span>
          </Dropdown>
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
          ref={contentViewRef}
          lines={rawLines}
          visibleIndexes={displayIndexes}
          levels={levels}
          lineRanges={displayRanges}
          activeMatch={activeMatch}
          showLineNumbers={showLineNumbers}
          wrap={wrap}
          following={tailing && !tailPaused}
          resetKey={resetKey}
          emptyText={emptyText}
        />
      )}
      <Modal
        title="跳到行号"
        size="small"
        visible={gotoVisible}
        closeOnEsc
        onCancel={() => setGotoVisible(false)}
        onOk={() => { handleGotoLine(); setGotoVisible(false); }}
        okText="跳转"
        cancelText="取消"
        okButtonProps={{ disabled: !gotoValue }}
      >
        <InputNumber
          min={1}
          max={Math.max(1, rawLines.length)}
          value={gotoValue ?? undefined}
          onChange={(v) => setGotoValue(Number(v) || null)}
          onEnterPress={() => { handleGotoLine(); setGotoVisible(false); }}
          placeholder={`1 - ${rawLines.length}`}
          style={{ width: '100%' }}
        />
      </Modal>
    </>
  );
}
