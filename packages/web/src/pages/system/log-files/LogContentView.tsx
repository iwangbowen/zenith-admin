import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, Typography } from '@douyinfe/semi-ui';
import { ChevronsDown } from 'lucide-react';
import type { LogLevel, MatchRange, SearchMatch } from './logFilesSearch';

const LEVEL_COLORS: Partial<Record<LogLevel, string>> = {
  error: 'var(--semi-color-danger)',
  warn: 'var(--semi-color-warning)',
  debug: 'var(--semi-color-text-2)',
};

const markStyle: CSSProperties = {
  backgroundColor: 'var(--semi-color-warning-light-default)',
  color: 'inherit',
  borderRadius: 'var(--semi-border-radius-small)',
  padding: '0 1px',
  fontWeight: 600,
};

const activeMarkStyle: CSSProperties = {
  ...markStyle,
  backgroundColor: 'var(--semi-color-warning)',
  color: 'var(--semi-color-text-0)',
};

function renderHighlightedLine(text: string, ranges: MatchRange[] | undefined, activeStart: number | null): ReactNode {
  if (!ranges || ranges.length === 0) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark key={`${index}-${range.start}`} style={range.start === activeStart ? activeMarkStyle : markStyle}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export interface LogContentViewProps {
  /** 原始行（静态内容或 tail 缓冲） */
  lines: string[];
  /** 展示行 → 原始行下标（级别过滤后的可见行） */
  visibleIndexes: number[];
  /** 每个原始行的有效级别 */
  levels: Array<LogLevel | null>;
  /** 展示行下标 → 匹配区间 */
  lineRanges: Map<number, MatchRange[]>;
  /** 当前激活匹配（lineIndex 为展示行下标） */
  activeMatch: SearchMatch | null;
  showLineNumbers: boolean;
  wrap: boolean;
  /** 实时追踪中：新行到达时若已在底部则跟随；禁用匹配自动定位 */
  following: boolean;
  /** 变化时（切换文件/刷新/开始追踪）滚动到底部 */
  resetKey: string;
  emptyText: string;
}

export function LogContentView({
  lines, visibleIndexes, levels, lineRanges, activeMatch,
  showLineNumbers, wrap, following, resetKey, emptyText,
}: LogContentViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const pinRafRef = useRef(0);
  const pinningRef = useRef(false);

  const count = visibleIndexes.length;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 19,
    overscan: 15,
    paddingStart: 8,
    paddingEnd: 8,
  });

  const updateAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 钉底期间虚拟行异步测量会产生瞬时偏差，忽略，避免钉底被误判为用户上滚
    if (pinningRef.current) return;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottomRef.current !== next) {
      atBottomRef.current = next;
      setAtBottom(next);
    }
  }, []);

  /** 用户主动滚动（滚轮/触摸/按住滚动条）→ 立即停止钉底，交还控制权 */
  const cancelPin = useCallback(() => {
    if (!pinningRef.current) return;
    pinningRef.current = false;
    cancelAnimationFrame(pinRafRef.current);
  }, []);

  const scrollToBottom = useCallback((settleMs = 400) => {
    // 动态行高测量会在滚动后继续修正总高度，短暂钉住底部直到稳定
    cancelAnimationFrame(pinRafRef.current);
    pinningRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
    const deadline = performance.now() + settleMs;
    const pin = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      if (performance.now() < deadline && pinningRef.current) {
        pinRafRef.current = requestAnimationFrame(pin);
      } else {
        pinningRef.current = false;
      }
    };
    pinRafRef.current = requestAnimationFrame(pin);
  }, []);

  useEffect(() => () => cancelAnimationFrame(pinRafRef.current), []);

  // 数据源变化（切换文件/刷新/开始追踪）→ 回到底部（日志约定：最新内容在末尾）
  useEffect(() => {
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  // 内容追加（tail）→ 仅当用户已在底部时才跟随，避免打断向上翻阅
  useEffect(() => {
    if (!atBottomRef.current) return;
    scrollToBottom(150);
  }, [lines, count, scrollToBottom]);

  // 换行/行号切换会改变行高，重置测量缓存
  useEffect(() => {
    virtualizer.measure();
  }, [wrap, showLineNumbers, virtualizer]);

  // 定位到当前激活匹配；追踪模式下行窗口滑动导致下标漂移，禁用自动定位
  useEffect(() => {
    if (!activeMatch || following) return;
    virtualizer.scrollToIndex(activeMatch.lineIndex, { align: 'center' });
  }, [activeMatch, following, virtualizer]);

  const digits = Math.max(2, String(lines.length).length);
  const activeLine = activeMatch?.lineIndex ?? -1;
  const items = virtualizer.getVirtualItems();

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
      <div
        ref={scrollRef}
        onScroll={updateAtBottom}
        onWheel={cancelPin}
        onTouchMove={cancelPin}
        onPointerDown={cancelPin}
        style={{
          flex: 1,
          overflow: 'auto',
          backgroundColor: 'var(--semi-color-fill-0)',
          fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--semi-color-text-1)',
        }}
      >
        {count === 0 ? (
          <div style={{ padding: '12px 16px' }}>
            <Typography.Text type="tertiary" style={{ fontFamily: 'inherit', fontSize: 12 }}>
              {emptyText}
            </Typography.Text>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: '100%' }}>
            {items.map((item) => {
              const originalIndex = visibleIndexes[item.index];
              const text = lines[originalIndex] ?? '';
              const level = levels[originalIndex];
              const ranges = lineRanges.get(item.index);
              const isActiveLine = item.index === activeLine;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: `translateY(${item.start}px)`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    boxSizing: 'border-box',
                    minWidth: '100%',
                    width: wrap ? '100%' : 'max-content',
                    padding: '0 16px 0 13px',
                    borderLeft: isActiveLine ? '3px solid var(--semi-color-primary)' : '3px solid transparent',
                    background: isActiveLine ? 'var(--semi-color-primary-light-default)' : undefined,
                  }}
                >
                  {showLineNumbers && (
                    <span
                      aria-hidden="true"
                      style={{
                        flexShrink: 0,
                        width: `${digits}ch`,
                        marginRight: 12,
                        textAlign: 'right',
                        color: 'var(--semi-color-text-2)',
                        userSelect: 'none',
                        whiteSpace: 'pre',
                      }}
                    >
                      {originalIndex + 1}
                    </span>
                  )}
                  <span
                    style={{
                      flex: wrap ? 1 : undefined,
                      minWidth: 0,
                      whiteSpace: wrap ? 'pre-wrap' : 'pre',
                      wordBreak: wrap ? 'break-all' : undefined,
                      color: level ? LEVEL_COLORS[level] : undefined,
                    }}
                  >
                    {renderHighlightedLine(text, ranges, isActiveLine ? (activeMatch?.start ?? null) : null)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!atBottom && count > 0 && (
        <Button
          icon={<ChevronsDown size={14} />}
          size="small"
          theme="solid"
          type="tertiary"
          style={{ position: 'absolute', right: 20, bottom: 16, borderRadius: 16, opacity: 0.85 }}
          onClick={() => scrollToBottom()}
        >
          回到底部
        </Button>
      )}
    </div>
  );
}
