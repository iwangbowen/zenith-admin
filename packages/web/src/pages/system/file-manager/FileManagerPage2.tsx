/**
 * 服务器文件管理器 — 干净版（所有 lint 问题已修复）
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Button, Input, Space, Tooltip, Dropdown, Modal, Toast,
  Typography, Tag, Spin, Breadcrumb, Popconfirm, ImagePreview, Checkbox,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Icon } from '@iconify/react';
import {
  Search, RotateCcw, LayoutGrid, List as ListIcon,
  FolderPlus, FilePlus, Upload as UploadIcon,
  Trash2, Copy, Scissors, Archive, Home,
  MoreHorizontal, FolderOpen,
} from 'lucide-react';
import { request } from '@/utils/request';
import { TOKEN_KEY } from '@zenith/shared';
import { config as appConfig } from '@/config';
import ConfigurableTable from '@/components/ConfigurableTable';
import FilePreviewModal from '@/components/FilePreviewModal';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import AppModal from '@/components/AppModal';
import { getFileIcon, getFolderIcon } from '../terminal/fileIcons';
import './FileManagerPage.css';

// ── 类型定义 ─────────────────────────────────────────────────────────────────

interface FsEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
  permissions?: string;
  uid?: number;
  gid?: number;
}

interface DirListing {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

interface RootInfo {
  home: string;
  isWindows: boolean;
  drives: string[];
}

type ViewMode = 'list' | 'grid';
type ClipOp = 'copy' | 'cut';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log2(Math.max(bytes, 1)) / 10);
  const idx = Math.min(i, units.length - 1);
  return `${(bytes / 1024 ** idx).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function buildBreadcrumbs(p: string): { label: string; path: string }[] {
  if (!p || p === '/') return [{ label: '/', path: '/' }];
  const isWin = /^[A-Za-z]:/.test(p);
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean);
  const result: { label: string; path: string }[] = [];
  if (!isWin) result.push({ label: '/', path: '/' });
  let cur = isWin ? '' : '/';
  for (const part of parts) {
    cur = isWin && cur === '' ? `${part}\\` : `${cur.replace(/[/\\]+$/, '')}${sep}${part}`;
    result.push({ label: part, path: cur });
  }
  return result;
}

function dialogTitle(mode: string | undefined): string {
  if (mode === 'rename') return '重命名';
  if (mode === 'newDir') return '新建文件夹';
  if (mode === 'newFile') return '新建文件';
  if (mode === 'move') return '移动到';
  if (mode === 'copy') return '复制到';
  if (mode === 'compress') return '压缩为 ZIP';
  if (mode === 'chmod') return '修改权限（chmod）';
  return '';
}

/** 模块级 XHR 上传（避免嵌套超深） */
function uploadOneXhrFM(
  file: File,
  dir: string,
  base: string,
  token: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('path', dir);
    fd.append('file', file);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.open('POST', `${base}/api/terminal-files/upload`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(fd);
  });
}

// ── 文件预览辅助 ──────────────────────────────────────────────────────────────

/** 非 SVG 图片展名（直接内联显示，不进 FilePreviewModal）*/
const NON_SVG_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'tif', 'avif']);

/** 文件扩展名 → MIME 类型映射 */
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff', avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/m4a', opus: 'audio/opus',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  md: 'text/markdown', markdown: 'text/markdown',
  json: 'application/json',
  zip: 'application/zip', gz: 'application/x-gzip', tar: 'application/x-tar',
  ts: 'text/typescript', tsx: 'text/typescript', js: 'text/javascript', jsx: 'text/javascript',
  html: 'text/html', htm: 'text/html', css: 'text/css', xml: 'text/xml',
  yaml: 'text/yaml', yml: 'text/yaml', sh: 'application/x-sh', bash: 'application/x-sh', zsh: 'application/x-sh',
  sql: 'text/x-sql', py: 'text/x-python', rs: 'text/x-rust', rb: 'text/plain',
  txt: 'text/plain', log: 'text/plain', conf: 'text/plain', ini: 'text/plain', env: 'text/plain', toml: 'text/plain',
};

function getFileMimeType(name: string): string | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

// ── 网格卡片 ─────────────────────────────────────────────────────────────────

interface GridCardProps {
  entry: FsEntry;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function FsGridCard({ entry, selected, onSelect, onOpen, onContextMenu }: Readonly<GridCardProps>) {
  const isDir = entry.type === 'dir';
  const iconId = isDir ? getFolderIcon(entry.name, false) : getFileIcon(entry.name);
  return (
    <div
      className={`fm-grid-card${selected ? ' fm-grid-card--selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      role="button"
      aria-pressed={selected}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <div className="fm-grid-card__icon">
        <Icon icon={iconId} width={36} height={36} />
      </div>
      <Tooltip content={entry.name} position="bottom">
        <div className="fm-grid-card__name">{entry.name}</div>
      </Tooltip>
      <div className="fm-grid-card__meta">{isDir ? '—' : formatSize(entry.size)}</div>
    </div>
  );
}

// ── 权限编辑器 ─────────────────────────────────────────────────────────────────

function modeToOctal(mode: number) { return mode.toString(8).padStart(3, '0'); }
function octalToMode(v: string) { const n = Number.parseInt(v, 8); return Number.isNaN(n) ? 0 : n; }
function modeToSymbolic(mode: number) {
  const bits = ['r', 'w', 'x'];
  return [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    .map((m, i) => (mode & m) ? bits[i % 3] : '-').join('');
}
/** 将 rwxr-xr-x 格式的权限字符串转为八进制字符串 */
function permStringToOctal(perm?: string): string {
  if (!perm) return '';
  const p = perm.replace(/^[dl-]/, '').slice(0, 9);
  const masks = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  let mode = 0;
  for (let i = 0; i < 9 && i < p.length; i++) if (p[i] !== '-') mode |= masks[i];
  return modeToOctal(mode);
}

interface ChmodEditorProps {
  readonly value: string;
  readonly onChange: (v: string) => void;
}

function ChmodEditor({ value, onChange }: Readonly<ChmodEditorProps>) {
  const mode = octalToMode(value);
  const toggle = (bit: number) => onChange(modeToOctal(mode ^ bit));
  const symbolic = value ? modeToSymbolic(mode) : '—';
  const headers = ['', '所有者', '群组', '其他用户'];
  const rows = [
    { label: '读 (r)', bits: [0o400, 0o040, 0o004] as const },
    { label: '写 (w)', bits: [0o200, 0o020, 0o002] as const },
    { label: '执行 (x)', bits: [0o100, 0o010, 0o001] as const },
  ];
  const center: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0' };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '76px 1fr 1fr 1fr', marginBottom: 14 }}>
        {headers.map((h) => (
          <div key={h} style={{ ...center, fontSize: 12, color: 'var(--semi-color-text-2)', fontWeight: h ? 500 : 400, paddingBottom: 8, justifyContent: h ? 'center' : 'flex-start' }}>{h}</div>
        ))}
        {rows.map((row) => (
          <React.Fragment key={row.label}>
            <div style={{ ...center, fontSize: 13, color: 'var(--semi-color-text-1)', justifyContent: 'flex-start' }}>{row.label}</div>
            {row.bits.map((bit) => (
              <div key={bit} style={center}>
                <Checkbox checked={(mode & bit) !== 0} onChange={() => toggle(bit)} />
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 4 }}>八进制值</Typography.Text>
          <Input value={value} onChange={onChange} placeholder="755" maxLength={4} style={{ fontFamily: 'monospace' }} />
        </div>
        <div style={{ flex: 1 }}>
          <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 4 }}>符号表示</Typography.Text>
          <div style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2, color: 'var(--semi-color-text-0)', height: 32, display: 'flex', alignItems: 'center' }}>{symbolic}</div>
        </div>
      </div>
    </div>
  );
}

// ── 文件夹选择器（移动/复制目标） ────────────────────────────────────────────────

interface FolderPickerModalProps {
  readonly visible: boolean;
  readonly title: string;
  readonly initialPath: string;
  /** Windows 盘符列表（如 ['C:', 'D:'])，为空则不显示盘符切换 */
  readonly drives?: string[];
  readonly onConfirm: (destDir: string) => void;
  readonly onCancel: () => void;
}

function FolderPickerModal({ visible, title, initialPath, drives = [], onConfirm, onCancel }: Readonly<FolderPickerModalProps>) {
  const [pickerPath, setPickerPath] = useState('');
  const [pickerParent, setPickerParent] = useState<string | null>(null);
  const [pickerFolders, setPickerFolders] = useState<{ name: string; path: string }[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (visible && !initialized) {
      void loadPickerDir(initialPath || '/');
      setInitialized(true);
    }
    if (!visible) setInitialized(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialPath]);

  async function loadPickerDir(path: string) {
    setPickerLoading(true);
    const res = await request.get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(path)}`);
    setPickerLoading(false);
    if (res.code === 0 && res.data) {
      setPickerPath(res.data.path);
      setPickerParent(res.data.parent);
      setPickerFolders(res.data.entries.filter((e) => e.type === 'dir').map((e) => ({ name: e.name, path: e.path })));
    }
  }

  const pickerBreadcrumbs = pickerPath ? buildBreadcrumbs(pickerPath) : [];
  const folderPickerOkText = title.includes('移') ? '移动到此处' : '复制到此处';

  return (
    <AppModal
      title={title}
      visible={visible}
      onCancel={onCancel}
      onOk={() => onConfirm(pickerPath)}
      okText={folderPickerOkText}
      closeOnEsc
      width={480}
      okButtonProps={{ disabled: !pickerPath }}
      fullscreenable={false}
    >
      {/* 面包屑导航 */}
      <Breadcrumb style={{ marginBottom: 8 }}>
        {pickerBreadcrumbs.map((seg, i) => (
          <Breadcrumb.Item
            key={seg.path}
            onClick={i < pickerBreadcrumbs.length - 1 ? () => void loadPickerDir(seg.path) : undefined}
            style={{ cursor: i < pickerBreadcrumbs.length - 1 ? 'pointer' : 'default', color: i < pickerBreadcrumbs.length - 1 ? 'var(--semi-color-primary)' : undefined }}
          >
            {seg.label}
          </Breadcrumb.Item>
        ))}
      </Breadcrumb>

      {/* 文件夹列表（无卡片边框，简洁风格） */}
      <div style={{ height: 280, overflowY: 'auto', background: 'var(--semi-color-fill-0)', borderRadius: 6 }}>
        {pickerLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Spin size="middle" />
          </div>
        ) : (
          <>
            {pickerParent !== null && (
              <button
                type="button"
                onClick={() => void loadPickerDir(pickerParent)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--semi-color-border)', cursor: 'pointer', color: 'var(--semi-color-text-2)', font: 'inherit', fontSize: 13 }}
              >
                <Icon icon="mdi:arrow-up" width={15} height={15} />
                <span>上级目录</span>
              </button>
            )}
            {/* Windows 盘符切换：到达盘符根目录时显示 */}
            {pickerParent === null && drives.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 14px', borderBottom: '1px solid var(--semi-color-border)' }}>
                {drives.map((d) => {
                  const isActive = pickerPath.toUpperCase().startsWith(d.toUpperCase());
                  return (
                    <Button
                      key={d}
                      size="small"
                      theme={isActive ? 'solid' : 'light'}
                      type={isActive ? 'primary' : 'tertiary'}
                      onClick={() => void loadPickerDir(d + '\\')}
                    >
                      {d}
                    </Button>
                  );
                })}
              </div>
            )}
            {pickerFolders.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--semi-color-text-2)', fontSize: 13 }}>
                当前目录无子文件夹
              </div>
            ) : (
              pickerFolders.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => void loadPickerDir(f.path)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--semi-color-fill-0)', cursor: 'pointer', color: 'var(--semi-color-text-0)', font: 'inherit', fontSize: 13 }}
                >
                  <Icon icon={getFolderIcon(f.name, false)} width={16} height={16} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{f.name}</span>
                </button>
              ))
            )}
          </>
        )}
      </div>

      <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 8 }}>
        目标目录：{pickerPath}
      </Typography.Text>
    </AppModal>
  );
}

// ── 虚拟网格 ─────────────────────────────────────────────────────────────────

const VG_CARD_MIN_W = 128; // 每卡最小宽（px）
const VG_CARD_H = 110;    // 每卡固定高度（必须与 CSS .fm-grid-card height 一致）
const VG_GAP = 8;          // 横纵间距
const VG_PAD = 12;         // 容器内边距
const VG_OVERSCAN = 2;     // 上下额外渲染行数

interface VirtualGridProps {
  readonly entries: FsEntry[];
  readonly selectedPaths: Set<string>;
  readonly onSelect: (path: string) => void;
  readonly onOpen: (entry: FsEntry) => void;
  readonly onContextMenu: (e: React.MouseEvent, entry: FsEntry) => void;
}

function VirtualGrid({ entries, selectedPaths, onSelect, onOpen, onContextMenu }: Readonly<VirtualGridProps>) {
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

// ── 主组件 ───────────────────────────────────────────────────────────────────

export default function FileManagerPage() {
  const [rootInfo, setRootInfo] = useState<RootInfo | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [clipboard, setClipboard] = useState<{ paths: string[]; op: ClipOp } | null>(null);
  const [ctxEntry, setCtxEntry] = useState<{ entry: FsEntry; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<
    | { mode: 'rename'; entry: FsEntry; value: string }
    | { mode: 'newFile' | 'newDir'; value: string }
    | { mode: 'move' | 'copy'; entry: FsEntry; value: string }
    | { mode: 'compress'; selEntries: FsEntry[]; value: string }
    | { mode: 'chmod'; entry: FsEntry; value: string }
    | null
  >(null);
  const ctxUploadDirRef = useRef('');
  const ctxUploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ name: string; progress: number }[]>([]);
  const [checksum, setChecksum] = useState<{ entry: FsEntry; algo: 'md5' | 'sha1' | 'sha256'; hash: string; size: number; loading: boolean } | null>(null);
  const [searchKw, setSearchKw] = useState('');
  const [searchResults, setSearchResults] = useState<FsEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; mimeType: string } | null>(null);
  // 图片画廈预览
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSrcList, setPreviewSrcList] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const previewBlobUrlsRef = useRef<string[]>([]);
  const previewSessionRef = useRef(0);
  // 文件夹选择器（移动/复制）
  const [folderPicker, setFolderPicker] = useState<{ mode: 'move' | 'copy'; entries: FsEntry[] } | null>(null);
  // 内容区高度（用于 Table 虚拟滚动）
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ob = new ResizeObserver((entries) => {
      for (const entry of entries) setContentHeight(Math.floor(entry.contentRect.height));
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  // ── 初始化 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    const infoRes = await request.get<RootInfo>('/api/terminal-files/root-info');
    if (infoRes.code !== 0 || !infoRes.data) return;
    setRootInfo(infoRes.data);
    const { home, isWindows, drives } = infoRes.data;
    const rootPath = isWindows ? ((/^([A-Za-z]:)/.exec(home)?.[1] ?? drives[0] ?? 'C:') + '\\') : '/';
    void navigateTo(rootPath);
  }

  // ── 导航 ─────────────────────────────────────────────────────────────────

  const navigateTo = useCallback(async (p: string) => {
    setLoading(true);
    setSelectedPaths(new Set());
    setKeyword('');
    const res = await request.get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(p)}`);
    setLoading(false);
    if (res.code === 0 && res.data) {
      setCurrentPath(res.data.path);
      setEntries(res.data.entries);
    }
  }, []);

  const refresh = useCallback(() => void navigateTo(currentPath), [navigateTo, currentPath]);

  // ── 过滤 + 侧栏 ───────────────────────────────────────────────────────────

  const filteredEntries = keyword
    ? entries.filter((e) => e.name.toLowerCase().includes(keyword.toLowerCase()))
    : entries;

  const sidebarDirs = entries.filter((e) => e.type === 'dir');

  // ── 选择 ─────────────────────────────────────────────────────────────────

  const toggleSelect = (p: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const clearSelect = () => setSelectedPaths(new Set());

  // ── 文件操作 ──────────────────────────────────────────────────────────────

  const handleDelete = async (paths: string[]) => {
    for (const p of paths) {
      await request.delete(`/api/terminal-files/entry?path=${encodeURIComponent(p)}`);
    }
    Toast.success(`已删除 ${paths.length} 项`);
    clearSelect();
    refresh();
  };

  const handleDownload = (entry: FsEntry) => {
    const token = localStorage.getItem(TOKEN_KEY) ?? '';
    const base = appConfig.apiBaseUrl || '';
    const a = document.createElement('a');
    a.href = `${base}/api/terminal-files/download?path=${encodeURIComponent(entry.path)}`;
    a.setAttribute('download', entry.name);
    // Use Authorization header via fetch instead of direct anchor for protected endpoints
    fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = entry.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      })
      .catch(() => Toast.error('下载失败'));
  };

  const handleFolderPickerConfirm = async (destDir: string) => {
    if (!folderPicker) return;
    const { mode, entries: pickedEntries } = folderPicker;
    const sep = destDir.includes('\\') ? '\\' : '/';
    const endpoint = mode === 'move' ? '/api/terminal-files/move' : '/api/terminal-files/copy';
    let success = 0;
    for (const e of pickedEntries) {
      const destName = e.path.split(/[\\/]/).pop() ?? e.name;
      const dest = `${destDir.replace(/[/\\]+$/, '')}${sep}${destName}`;
      const res = await request.post(endpoint, { from: e.path, to: dest });
      if (res.code === 0) success++;
    }
    const verb = mode === 'move' ? '移动' : '复制';
    Toast.success(`已${verb} ${success}/${pickedEntries.length} 项`);
    setFolderPicker(null);
    refresh();
  };

  const cleanupPreviewBlobs = () => {
    previewBlobUrlsRef.current.forEach((u) => { if (u) URL.revokeObjectURL(u); });
    previewBlobUrlsRef.current = [];
  };

  const handlePreview = useCallback(async (entry: FsEntry) => {
    if (entry.type === 'dir') return;
    const ext = (entry.name.split('.').pop() ?? '').toLowerCase();
    if (NON_SVG_IMAGE_EXTS.has(ext)) {
      const imageEntries = filteredEntries.filter(
        (e) => e.type !== 'dir' && NON_SVG_IMAGE_EXTS.has((e.name.split('.').pop() ?? '').toLowerCase()),
      );
      const clickedIndex = Math.max(0, imageEntries.findIndex((e) => e.path === entry.path));
      previewSessionRef.current += 1;
      const mySession = previewSessionRef.current;
      const token = localStorage.getItem(TOKEN_KEY) ?? '';
      const base = appConfig.apiBaseUrl || '';
      try {
        cleanupPreviewBlobs();
        const initialUrls = imageEntries.map(() => '');
        previewBlobUrlsRef.current = [...initialUrls];
        // 优先加载点击项
        const clickedResp = await fetch(
          `${base}/api/terminal-files/download?path=${encodeURIComponent(imageEntries[clickedIndex].path)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (previewSessionRef.current !== mySession) return;
        const clickedBlob = await clickedResp.blob();
        if (previewSessionRef.current !== mySession) return;
        const clickedUrl = URL.createObjectURL(clickedBlob);
        initialUrls[clickedIndex] = clickedUrl;
        previewBlobUrlsRef.current[clickedIndex] = clickedUrl;
        setPreviewSrcList([...initialUrls]);
        setPreviewCurrentIndex(clickedIndex);
        setPreviewVisible(true);
        // 后台加载其余图片
        imageEntries.forEach(async (imgEntry, i) => {
          if (i === clickedIndex) return;
          try {
            const resp = await fetch(
              `${base}/api/terminal-files/download?path=${encodeURIComponent(imgEntry.path)}`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (previewSessionRef.current !== mySession) return;
            const blob = await resp.blob();
            if (previewSessionRef.current !== mySession) return;
            const url = URL.createObjectURL(blob);
            previewBlobUrlsRef.current[i] = url;
            setPreviewSrcList((prev) => { const u = [...prev]; u[i] = url; return u; });
          } catch { /* ignore */ }
        });
      } catch (err) {
        Toast.error(err instanceof Error ? err.message : '图片加载失败');
      }
    } else {
      const mimeType = getFileMimeType(entry.name);
      if (mimeType) {
        setPreview({ url: `/api/terminal-files/download?path=${encodeURIComponent(entry.path)}`, name: entry.name, mimeType });
      } else {
        Toast.warning('该文件不支持预览，请下载后查看');
      }
    }
  }, [filteredEntries]);

  const handlePaste = async () => {
    if (!clipboard || !currentPath) return;
    const { paths, op } = clipboard;
    const sep = currentPath.includes('\\') ? '\\' : '/';
    for (const p of paths) {
      const destName = p.split(/[\\/]/).pop() ?? p;
      const dest = `${currentPath.replace(/[/\\]+$/, '')}${sep}${destName}`;
      const endpoint = op === 'copy' ? '/api/terminal-files/copy' : '/api/terminal-files/move';
      await request.post(endpoint, { from: p, to: dest });
    }
    Toast.success(`已${op === 'copy' ? '复制' : '移动'} ${paths.length} 项`);
    if (clipboard.op === 'cut') setClipboard(null);
    refresh();
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    const val = dialog.value.trim();
    if (!val) { Toast.warning('请输入名称'); return; }
    const sep = currentPath.includes('\\') ? '\\' : '/';

    if (dialog.mode === 'rename') {
      const dest = `${dialog.entry.path.replace(/[/\\]+[^/\\]+$/, '')}${sep}${val}`;
      const res = await request.post('/api/terminal-files/rename', { from: dialog.entry.path, to: dest });
      if (res.code === 0) { Toast.success('已重命名'); setDialog(null); refresh(); }
    } else if (dialog.mode === 'newFile' || dialog.mode === 'newDir') {
      const type = dialog.mode === 'newDir' ? 'dir' : 'file';
      const newPath = `${currentPath.replace(/[/\\]+$/, '')}${sep}${val}`;
      const res = await request.post('/api/terminal-files/create', { path: newPath, type });
      if (res.code === 0) { Toast.success('已创建'); setDialog(null); refresh(); }
    } else if (dialog.mode === 'move') {
      const res = await request.post('/api/terminal-files/move', { from: dialog.entry.path, to: val });
      if (res.code === 0) { Toast.success('已移动'); setDialog(null); refresh(); }
    } else if (dialog.mode === 'copy') {
      const res = await request.post('/api/terminal-files/copy', { from: dialog.entry.path, to: val });
      if (res.code === 0) { Toast.success('已复制'); setDialog(null); refresh(); }
    } else if (dialog.mode === 'compress') {
      const paths = dialog.selEntries.map((e) => e.path);
      const dest = `${currentPath.replace(/[/\\]+$/, '')}${sep}${val}`;
      const res = await request.post('/api/terminal-files/compress', { paths, destPath: dest });
      if (res.code === 0) { Toast.success('压缩成功'); setDialog(null); refresh(); }
    } else if (dialog.mode === 'chmod') {
      const mode = Number.parseInt(val, 8);
      if (Number.isNaN(mode)) { Toast.error('请输入有效的八进制权限值，如 755'); return; }
      const res = await request.post('/api/terminal-files/chmod', { path: dialog.entry.path, mode });
      if (res.code === 0) { Toast.success('权限已修改'); setDialog(null); refresh(); }
    }
  };

  // ── 上传 ─────────────────────────────────────────────────────────────────

  function updateUploadPct(prev: { name: string; progress: number }[], idx: number, pct: number) {
    return prev.map((u, i) => (i === idx ? { ...u, progress: pct } : u));
  }

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const dir = ctxUploadDirRef.current || currentPath;
    const token = localStorage.getItem(TOKEN_KEY) ?? '';
    const base = appConfig.apiBaseUrl || '';
    setUploading(files.map((f) => ({ name: f.name, progress: 0 })));

    Promise.allSettled(
      files.map((f, i) =>
        uploadOneXhrFM(f, dir, base, token, (pct) => {
          setUploading((prev) => updateUploadPct(prev, i, pct));
        }),
      ),
    ).then((results) => {
      const success = results.filter((r) => r.status === 'fulfilled').length;
      Toast.success(`已上传 ${success}/${files.length} 个文件`);
      setUploading([]);
      refresh();
    });
    e.target.value = '';
  };

  // ── 上下文菜单 ────────────────────────────────────────────────────────────

  const isArchive = (name: string) => /\.(zip|tgz|tbz2?|txz|gz|tar|tar\.gz|tar\.bz2|tar\.xz)$/i.test(name);

  const handleExtract = async (entry: FsEntry) => {
    Toast.info({ content: '正在解压…', duration: 1 });
    const res = await request.post('/api/terminal-files/extract', { path: entry.path });
    if (res.code === 0) { Toast.success('解压成功'); refresh(); }
  };

  const fetchChecksum = async (entry: FsEntry, algo: 'md5' | 'sha1' | 'sha256') => {
    setChecksum({ entry, algo, hash: '', size: entry.size, loading: true });
    const res = await request.get<{ algo: string; hash: string; size: number }>(
      `/api/terminal-files/checksum?path=${encodeURIComponent(entry.path)}&algo=${algo}`,
    );
    setChecksum({ entry, algo, hash: res.code === 0 && res.data ? res.data.hash : '计算失败', size: res.data?.size ?? entry.size, loading: false });
  };

  const runSearch = async () => {
    const kw = searchKw.trim();
    if (!kw) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const res = await request.get<FsEntry[]>(`/api/terminal-files/search?dir=${encodeURIComponent(currentPath)}&keyword=${encodeURIComponent(kw)}`);
      setSearchResults(res.code === 0 && res.data ? res.data : []);
    } finally {
      setSearching(false);
    }
  };

  const openCtxMenu = (e: React.MouseEvent, entry: FsEntry) => {
    e.preventDefault();
    setCtxEntry({ entry, x: e.clientX, y: e.clientY });
  };

  const closeCtxMenu = () => setCtxEntry(null);

  const buildCtxMenuItems = (ce: typeof ctxEntry) => {
    if (!ce) return [];
    const { entry } = ce;
    const items: { label: string; fn: () => void; danger?: boolean }[] = [
      {
        label: entry.type === 'dir' ? '打开' : '下载',
        fn: () => {
          if (entry.type === 'dir') void navigateTo(entry.path);
          else handleDownload(entry);
          closeCtxMenu();
        },
      },
      ...(entry.type !== 'dir' ? [{ label: '预览', fn: () => { void handlePreview(entry); closeCtxMenu(); } }] : []),
      { label: '重命名', fn: () => { setDialog({ mode: 'rename', entry, value: entry.name }); closeCtxMenu(); } },
      { label: '复制到…', fn: () => { setFolderPicker({ mode: 'copy', entries: [entry] }); closeCtxMenu(); } },
      { label: '移动到…', fn: () => { setFolderPicker({ mode: 'move', entries: [entry] }); closeCtxMenu(); } },
      { label: '压缩为 ZIP', fn: () => { setDialog({ mode: 'compress', selEntries: [entry], value: `${entry.name}.zip` }); closeCtxMenu(); } },
      ...(entry.type !== 'dir' && isArchive(entry.name) ? [{ label: '解压到此处', fn: () => { void handleExtract(entry); closeCtxMenu(); } }] : []),
      ...(entry.type !== 'dir' ? [{ label: '校验和', fn: () => { void fetchChecksum(entry, 'sha256'); closeCtxMenu(); } }] : []),
      { label: '修改权限', fn: () => { setDialog({ mode: 'chmod', entry, value: permStringToOctal(entry.permissions) }); closeCtxMenu(); } },
      ...(entry.type === 'dir' ? [{ label: '上传到此目录', fn: () => { ctxUploadDirRef.current = entry.path; ctxUploadInputRef.current?.click(); closeCtxMenu(); } }] : []),
      { label: '删除', fn: () => { Modal.confirm({ title: '确定删除此项吗？', okType: 'danger', onOk: () => handleDelete([entry.path]) }); closeCtxMenu(); }, danger: true },
    ];
    return items;
  };

  // ── 表格列 ────────────────────────────────────────────────────────────────

  const columns: ColumnProps<FsEntry>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (v: string, r: FsEntry) => {
        const iconId = r.type === 'dir' ? getFolderIcon(v, false) : getFileIcon(v);
        return (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: r.type === 'dir' ? 'pointer' : 'default' }}
            onClick={() => { if (r.type === 'dir') void navigateTo(r.path); }}
            role={r.type === 'dir' ? 'button' : undefined}
            tabIndex={r.type === 'dir' ? 0 : undefined}
            onKeyDown={r.type === 'dir' ? (e) => { if (e.key === 'Enter') void navigateTo(r.path); } : undefined}
          >
            <Icon icon={iconId} width={16} height={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{v}</span>
          </div>
        );
      },
    },
    { title: '大小', dataIndex: 'size', width: 100, render: (v: number, r: FsEntry) => r.type === 'dir' ? '—' : formatSize(v) },
    { title: '修改时间', dataIndex: 'mtime', width: 180 },
    { title: '权限', dataIndex: 'permissions', width: 110, render: (v?: string) => v ? <Tag size="small" color="grey">{v}</Tag> : '—' },
    { title: 'UID', dataIndex: 'uid', width: 70, render: (v?: number) => v ?? '—' },
    { title: 'GID', dataIndex: 'gid', width: 70, render: (v?: number) => v ?? '—' },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 170,
      render: (_: unknown, r: FsEntry) => (
        <Space>
          {r.type === 'dir' ? (
            <Button size="small" theme="borderless" onClick={() => void navigateTo(r.path)}>打开</Button>
          ) : (
            <>
              <Button size="small" theme="borderless" onClick={() => void handlePreview(r)}>预览</Button>
              <Button size="small" theme="borderless" onClick={() => handleDownload(r)}>下载</Button>
            </>
          )}
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => setDialog({ mode: 'rename', entry: r, value: r.name })}>重命名</Dropdown.Item>
                <Dropdown.Item onClick={() => setFolderPicker({ mode: 'copy', entries: [r] })}>复制到…</Dropdown.Item>
                <Dropdown.Item onClick={() => setFolderPicker({ mode: 'move', entries: [r] })}>移动到…</Dropdown.Item>
                <Dropdown.Item onClick={() => setDialog({ mode: 'compress', selEntries: [r], value: `${r.name}.zip` })}>压缩为 ZIP</Dropdown.Item>
                {r.type !== 'dir' && isArchive(r.name) && (
                  <Dropdown.Item onClick={() => void handleExtract(r)}>解压到此处</Dropdown.Item>
                )}
                {r.type !== 'dir' && (
                  <Dropdown.Item onClick={() => void fetchChecksum(r, 'sha256')}>校验和</Dropdown.Item>
                )}
                <Dropdown.Item onClick={() => setDialog({ mode: 'chmod', entry: r, value: permStringToOctal(r.permissions) })}>修改权限</Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item
                  type="danger"
                  onClick={() => Modal.confirm({ title: '确定删除此项吗？', okType: 'danger', onOk: () => handleDelete([r.path]) })}
                >
                  删除
                </Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <Button size="small" theme="borderless" icon={<MoreHorizontal size={13} />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  // ── 渲染内容区 ────────────────────────────────────────────────────────────
  // Table 虚拟滚动：ConfigurableTable 有工具栏（约36px）+ 表头（约37px）= 73px
  const VIRTUAL_ITEM_HEIGHT = 40;
  const TABLE_OVERHEAD = 73;
  const tableScrollY = contentHeight > TABLE_OVERHEAD + VIRTUAL_ITEM_HEIGHT * 2
    ? contentHeight - TABLE_OVERHEAD
    : undefined;
  const renderContent = () => {
    if (loading) return <div className="fm-content__loading"><Spin size="large" /></div>;
    if (filteredEntries.length === 0) {
      return (
        <div className="fm-content__empty">
          <FolderOpen size={48} strokeWidth={1.2} style={{ opacity: 0.3 }} />
          <Typography.Text type="tertiary">目录为空</Typography.Text>
        </div>
      );
    }
    if (viewMode === 'grid') {
      return (
        <VirtualGrid
          entries={filteredEntries}
          selectedPaths={selectedPaths}
          onSelect={(path) => toggleSelect(path)}
          onOpen={(e) => { if (e.type === 'dir') void navigateTo(e.path); else void handlePreview(e); }}
          onContextMenu={(ev, e) => openCtxMenu(ev, e)}
        />
      );
    }
    return (
      <ConfigurableTable
        bordered
        rowKey="path"
        dataSource={filteredEntries}
        columns={columns}
        loading={false}
        pagination={false}
        size="small"
        onRefresh={refresh}
        refreshLoading={loading}
        scroll={tableScrollY ? { y: tableScrollY } : undefined}
        virtualized={tableScrollY ? { itemSize: VIRTUAL_ITEM_HEIGHT } : undefined}
        rowSelection={{
          selectedRowKeys: [...selectedPaths],
          onChange: (keys) => setSelectedPaths(new Set(keys as string[])),
        }}
        onRow={(r) => ({
          onContextMenu: r ? (e: React.MouseEvent) => openCtxMenu(e, r) : undefined,
        })}
      />
    );
  };

  // ── 面包屑 ────────────────────────────────────────────────────────────────

  const breadcrumbs = currentPath ? buildBreadcrumbs(currentPath) : [];
  const ctxMenuItems = buildCtxMenuItems(ctxEntry);

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <MasterDetailLayout
      defaultSize={220}
      minSize={160}
      maxSize={380}
      persistKey="file-manager"
      collapsible
      master={
        <>
          <MasterDetailLayout.Header
            extra={
              rootInfo?.home && (
                <Tooltip content="主目录">
                  <Button
                    size="small"
                    theme="borderless"
                    type="tertiary"
                    icon={<Home size={13} />}
                    onClick={() => void navigateTo(rootInfo.home)}
                  />
                </Tooltip>
              )
            }
          >
            <Typography.Text strong style={{ fontSize: 13 }}>目录导航</Typography.Text>
          </MasterDetailLayout.Header>
          {rootInfo?.isWindows && rootInfo.drives.length > 1 && (
            <div className="fm-sidebar__drives">
              {rootInfo.drives.map((d) => {
                const isActive = currentPath.toUpperCase().startsWith(d.toUpperCase());
                return (
                  <Button
                    key={d}
                    size="small"
                    theme={isActive ? 'solid' : 'borderless'}
                    type={isActive ? 'primary' : 'tertiary'}
                    style={{ minWidth: 36 }}
                    onClick={() => void navigateTo(d + '\\')}
                  >
                    {d}
                  </Button>
                );
              })}
            </div>
          )}
          <div className="fm-sidebar__dirs">
            {sidebarDirs.map((d) => (
              <button
                key={d.path}
                type="button"
                className={`fm-sidebar__dir-item${d.path === currentPath ? ' fm-sidebar__dir-item--active' : ''}`}
                onClick={() => void navigateTo(d.path)}
              >
                <Icon icon={getFolderIcon(d.name, false)} width={14} height={14} style={{ flexShrink: 0 }} />
                <span>{d.name}</span>
              </button>
            ))}
          </div>
        </>
      }
      detail={
        <>
          <MasterDetailLayout.Header
            extra={
              <Space spacing={6} style={{ flexShrink: 0 }}>
                <Input
                  prefix={<Search size={13} />}
                  placeholder="过滤文件名"
                  value={keyword}
                  onChange={setKeyword}
                  showClear
                  size="small"
                  style={{ width: 160 }}
                />
                <Input
                  prefix={<Search size={13} />}
                  placeholder="深度搜索(回车)"
                  value={searchKw}
                  onChange={setSearchKw}
                  onEnterPress={() => void runSearch()}
                  showClear
                  size="small"
                  style={{ width: 150 }}
                />
                <Tooltip content="刷新">
                  <Button size="small" theme="borderless" type="tertiary" icon={<RotateCcw size={13} />} loading={loading} onClick={refresh} />
                </Tooltip>
                <Tooltip content="新建文件夹">
                  <Button size="small" theme="borderless" type="tertiary" icon={<FolderPlus size={13} />} onClick={() => setDialog({ mode: 'newDir', value: '' })} />
                </Tooltip>
                <Tooltip content="新建文件">
                  <Button size="small" theme="borderless" type="tertiary" icon={<FilePlus size={13} />} onClick={() => setDialog({ mode: 'newFile', value: '' })} />
                </Tooltip>
                <Tooltip content="上传文件">
                  <Button size="small" theme="borderless" type="tertiary" icon={<UploadIcon size={13} />} onClick={() => { ctxUploadDirRef.current = currentPath; ctxUploadInputRef.current?.click(); }} />
                </Tooltip>
                {clipboard && (
                  <Tooltip content={`粘贴（${clipboard.op === 'copy' ? '复制' : '移动'} ${clipboard.paths.length} 项）`}>
                    <Button size="small" type="primary" icon={clipboard.op === 'copy' ? <Copy size={13} /> : <Scissors size={13} />} onClick={() => void handlePaste()}>
                      粘贴
                    </Button>
                  </Tooltip>
                )}
                {selectedPaths.size > 0 && (
                  <>
                    <Button size="small" theme="borderless" type="tertiary" icon={<Copy size={13} />} onClick={() => setClipboard({ paths: [...selectedPaths], op: 'copy' })}>复制</Button>
                    <Button size="small" theme="borderless" type="tertiary" icon={<Scissors size={13} />} onClick={() => setClipboard({ paths: [...selectedPaths], op: 'cut' })}>剪切</Button>
                    <Button size="small" theme="borderless" type="tertiary" icon={<Archive size={13} />} onClick={() => {
                      const sel = filteredEntries.filter((e) => selectedPaths.has(e.path));
                      setDialog({ mode: 'compress', selEntries: sel, value: 'archive.zip' });
                    }}>压缩</Button>
                    <Popconfirm title={`确定删除选中的 ${selectedPaths.size} 项吗？`} okType="danger" onConfirm={() => void handleDelete([...selectedPaths])}>
                      <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />}>删除</Button>
                    </Popconfirm>
                  </>
                )}
                <Button
                  size="small"
                  theme={viewMode === 'list' ? 'solid' : 'borderless'}
                  type={viewMode === 'list' ? 'primary' : 'tertiary'}
                  icon={<ListIcon size={13} />}
                  style={{ borderRadius: '4px 0 0 4px' }}
                  onClick={() => setViewMode('list')}
                />
                <Button
                  size="small"
                  theme={viewMode === 'grid' ? 'solid' : 'borderless'}
                  type={viewMode === 'grid' ? 'primary' : 'tertiary'}
                  icon={<LayoutGrid size={13} />}
                  style={{ borderRadius: '0 4px 4px 0' }}
                  onClick={() => setViewMode('grid')}
                />
              </Space>
            }
          >
            <Breadcrumb className="fm-toolbar__breadcrumb">
              {breadcrumbs.map((seg, i) => (
                <Breadcrumb.Item
                  key={seg.path}
                  onClick={i < breadcrumbs.length - 1 ? () => void navigateTo(seg.path) : undefined}
                  style={{ cursor: i < breadcrumbs.length - 1 ? 'pointer' : 'default', color: i < breadcrumbs.length - 1 ? 'var(--semi-color-primary)' : undefined }}
                >
                  {seg.label}
                </Breadcrumb.Item>
              ))}
            </Breadcrumb>
          </MasterDetailLayout.Header>

          <MasterDetailLayout.Body scroll="hidden" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="fm-content" ref={contentRef}>
              {renderContent()}
              {uploading.length > 0 && (
                <div className="fm-upload-progress">
                  <Typography.Text size="small" strong>
                    上传中（{uploading.filter((u) => u.progress >= 100).length}/{uploading.length}）
                  </Typography.Text>
                  {uploading.map((u) => (
                    <div key={u.name} style={{ marginTop: 4 }}>
                      <Typography.Text size="small" ellipsis style={{ display: 'block' }}>{u.name}</Typography.Text>
                      <div className="fm-upload-bar">
                        <div className="fm-upload-bar__fill" style={{ width: `${u.progress}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </MasterDetailLayout.Body>

          <input ref={ctxUploadInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleUploadChange} />

          {ctxEntry && (
            <>
              <button
                type="button"
                aria-label="关闭菜单"
                style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'transparent', border: 'none', padding: 0, cursor: 'default' }}
                onClick={closeCtxMenu}
                onContextMenu={(e) => { e.preventDefault(); closeCtxMenu(); }}
              />
              <div style={{ position: 'fixed', left: ctxEntry.x, top: ctxEntry.y, zIndex: 1001, minWidth: 150, background: 'var(--semi-color-bg-3)', border: '1px solid var(--semi-color-border)', borderRadius: 6, boxShadow: 'var(--semi-shadow-elevated)', padding: '4px 0' }}>
                {ctxMenuItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.fn}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 14px', background: 'none', border: 'none', cursor: 'pointer', color: item.danger ? 'var(--semi-color-danger)' : 'var(--semi-color-text-0)', font: 'inherit', fontSize: 13 }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <Modal
            title={dialogTitle(dialog?.mode)}
            visible={!!dialog}
            onCancel={() => setDialog(null)}
            onOk={() => void confirmDialog()}
            closeOnEsc
            width={480}
          >
            {dialog?.mode === 'chmod' ? (
              <ChmodEditor
                value={dialog.value}
                onChange={(v) => setDialog((d) => d ? { ...d, value: v } : d)}
              />
            ) : (
              <Input
                autoFocus
                value={dialog?.value ?? ''}
                onChange={(v) => setDialog((d) => d ? { ...d, value: v } : d)}
                onEnterPress={() => void confirmDialog()}
                placeholder={dialog?.mode === 'move' || dialog?.mode === 'copy' ? '输入目标完整路径' : '请输入名称'}
              />
            )}
            {dialog?.mode === 'compress' && (
              <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 8 }}>
                将压缩到当前目录下，输入 ZIP 文件名（含 .zip 扩展名）
              </Typography.Text>
            )}
          </Modal>

          {/* ── 图片画廊预览 ── */}
          <ImagePreview
            src={previewSrcList}
            visible={previewVisible}
            currentIndex={previewCurrentIndex}
            onChange={setPreviewCurrentIndex}
            onVisibleChange={(v) => {
              if (!v) {
                previewSessionRef.current += 1;
                setPreviewVisible(false);
                cleanupPreviewBlobs();
                setPreviewSrcList([]);
              }
            }}
            infinite
          />

          {/* ── 通用文件预览 (PDF/音视频/Excel/Word/Markdown/ZIP/代码等) ── */}
          <FilePreviewModal
            fileUrl={preview?.url ?? ''}
            fileName={preview?.name}
            mimeType={preview?.mimeType}
            visible={!!preview}
            onClose={() => setPreview(null)}
            onFallback={() => { Toast.warning('该文件不支持在线预览，请下载后查看'); setPreview(null); }}
          />

          {/* ── 文件夹选择器（移动/复制） ── */}
          <FolderPickerModal
            visible={!!folderPicker}
            title={folderPicker?.mode === 'move' ? '移动到' : '复制到'}
            initialPath={currentPath}
            drives={rootInfo?.drives ?? []}
            onConfirm={(destDir) => void handleFolderPickerConfirm(destDir)}
            onCancel={() => setFolderPicker(null)}
          />

          {/* ── 文件校验和 ── */}
          <Modal
            title="文件校验和"
            visible={!!checksum}
            onCancel={() => setChecksum(null)}
            footer={null}
            closeOnEsc
            width={560}
          >
            {checksum && (
              <div>
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
                  {checksum.entry.name} · {formatSize(checksum.size)}
                </Typography.Text>
                <Space spacing={4} style={{ marginBottom: 12 }}>
                  {(['md5', 'sha1', 'sha256'] as const).map((a) => (
                    <Button key={a} size="small" theme={checksum.algo === a ? 'solid' : 'light'} type={checksum.algo === a ? 'primary' : 'tertiary'}
                      onClick={() => void fetchChecksum(checksum.entry, a)}>{a.toUpperCase()}</Button>
                  ))}
                </Space>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Input readOnly value={checksum.loading ? '计算中…' : checksum.hash} style={{ fontFamily: 'monospace', fontSize: 12 }} />
                  <Button size="small" disabled={checksum.loading || !checksum.hash} onClick={() => { void navigator.clipboard?.writeText(checksum.hash); Toast.success('已复制'); }}>复制</Button>
                </div>
              </div>
            )}
          </Modal>

          {/* ── 深度搜索结果 ── */}
          <Modal
            title={`搜索结果${searchResults ? `（${searchResults.length}${searchResults.length >= 200 ? '+' : ''}）` : ''}`}
            visible={searchResults !== null}
            onCancel={() => setSearchResults(null)}
            footer={null}
            closeOnEsc
            width={620}
          >
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
              在 {currentPath || '/'} 下递归搜索「{searchKw}」{searching ? ' · 搜索中…' : ''}
            </Typography.Text>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {(searchResults ?? []).length === 0 && !searching && (
                <Typography.Text type="tertiary">未找到匹配项</Typography.Text>
              )}
              {(searchResults ?? []).map((r) => (
                <div key={r.path} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px', borderBottom: '1px solid var(--semi-color-fill-1)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{r.type === 'dir' ? '📁' : '📄'} {r.name}</div>
                    <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 420, display: 'block' }}>{r.path}</Typography.Text>
                  </div>
                  <Button size="small" theme="borderless" onClick={() => {
                    const parent = r.path.replace(/[/\\][^/\\]*$/, '') || r.path;
                    void navigateTo(r.type === 'dir' ? r.path : parent);
                    setSearchResults(null);
                  }}>前往</Button>
                </div>
              ))}
            </div>
          </Modal>
        </>
      }
    />
  );
}
