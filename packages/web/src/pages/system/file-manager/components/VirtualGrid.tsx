/**
 * 网格视图：自实现的按行虚拟滚动（行高固定，ResizeObserver 自适应列数）。
 * 卡片高度 VG_CARD_H 必须与 CSS `.fm-grid-card` 的 height 保持一致。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '@douyinfe/semi-ui';
import { Icon } from '@iconify/react';
import { getFileIcon, getFolderIcon } from '@/utils/fileIcons';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import type { FsEntry } from '../types';
import { formatBytes } from '@zenith/shared/core';

interface GridCardProps {
  entry: FsEntry;
  selected: boolean;
  cut?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function FsGridCard({ entry, selected, cut, onSelect, onOpen, onContextMenu }: Readonly<GridCardProps>) {
  const isDir = entry.type === 'dir';
  const iconId = isDir ? getFolderIcon(entry.name, false) : getFileIcon(entry.name);
  return (
    <button
      type="button"
      className={`fm-grid-card${selected ? ' fm-grid-card--selected' : ''}${cut ? ' fm-row--cut' : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      aria-pressed={selected}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <div className="fm-grid-card__icon">
        <Icon icon={iconId} width={36} height={36} />
      </div>
      <Tooltip content={entry.name} position="bottom">
        <div className="fm-grid-card__name">{entry.name}</div>
      </Tooltip>
      <div className="fm-grid-card__meta">{isDir ? EMPTY_PLACEHOLDER : formatBytes(entry.size)}</div>
    </button>
  );
}

const VG_CARD_MIN_W = 104; // 每卡最小宽（px）
const VG_CARD_H = 96;     // 每卡固定高度（必须与 CSS .fm-grid-card height 一致）
const VG_GAP = 6;          // 横纵间距
const VG_PAD = 8;          // 容器内边距
const VG_OVERSCAN = 2;     // 上下额外渲染行数

interface VirtualGridProps {
  readonly entries: FsEntry[];
  readonly selectedPaths: Set<string>;
  readonly cutPaths?: Set<string>;
  readonly onSelect: (path: string) => void;
  readonly onOpen: (entry: FsEntry) => void;
  readonly onContextMenu: (e: React.MouseEvent, entry: FsEntry) => void;
}

export default function VirtualGrid({ entries, selectedPaths, cutPaths, onSelect, onOpen, onContextMenu }: Readonly<VirtualGridProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ob = new ResizeObserver((res) => {
      const r = res[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  const cols = size.w > 0
    ? Math.max(1, Math.floor((size.w - VG_PAD * 2 + VG_GAP) / (VG_CARD_MIN_W + VG_GAP)))
    : 0;

  if (cols === 0) {
    // 尚未完成宽度测量，展示占位
    return <div ref={containerRef} style={{ height: '100%' }} />;
  }

  const rowCount = Math.ceil(entries.length / cols);

  // 每行用实际组件渲染，高度由 DOM 决定。作为虚拟滚动可视区估算基准
  const estimatedRowH = VG_CARD_H + VG_GAP;

  const firstRow = Math.max(0, Math.floor((scrollTop - VG_PAD) / estimatedRowH) - VG_OVERSCAN);
  const lastRow  = Math.min(rowCount - 1, Math.ceil((scrollTop + size.h - VG_PAD) / estimatedRowH) + VG_OVERSCAN);

  const topSpace    = firstRow * estimatedRowH;
  const bottomSpace = Math.max(0, (rowCount - 1 - lastRow) * estimatedRowH);

  return (
    <div
      ref={containerRef}
      style={{ height: '100%', overflowY: 'auto' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ paddingTop: VG_PAD + topSpace, paddingBottom: VG_PAD + bottomSpace, paddingLeft: VG_PAD, paddingRight: VG_PAD }}>
        {Array.from({ length: lastRow - firstRow + 1 }, (_, i) => {
          const rowIdx = firstRow + i;
          return (
            <div
              key={rowIdx}
              style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: VG_GAP, marginBottom: VG_GAP }}
            >
              {Array.from({ length: cols }, (_, ci) => {
                const idx = rowIdx * cols + ci;
                if (idx >= entries.length) return <div key={`empty-${ci}`} />;
                const e = entries[idx];
                return (
                  <FsGridCard
                    key={e.path}
                    entry={e}
                    selected={selectedPaths.has(e.path)}
                    cut={cutPaths?.has(e.path)}
                    onSelect={() => onSelect(e.path)}
                    onOpen={() => onOpen(e)}
                    onContextMenu={(ev) => onContextMenu(ev, e)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
