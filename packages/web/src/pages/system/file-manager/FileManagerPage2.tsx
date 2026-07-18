/**
 * 服务器文件管理器 — 干净版（所有 lint 问题已修复）
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Button, Input, Space, Tooltip, Modal, Toast,
  Typography, Tag, Spin, Breadcrumb, Popconfirm, ImagePreview, Checkbox, SideSheet,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Icon } from '@iconify/react';
import {
  Search, RotateCcw, LayoutGrid, List as ListIcon,
  FolderPlus, FilePlus, Upload as UploadIcon,
  Trash2, Copy, Scissors, Archive, Home,
  FolderOpen,
  Eye, EyeOff, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { request } from '@/utils/request';
import { formatBytes as formatSize } from '@/utils/format';
import { toQueryString, unwrap } from '@/lib/query';
import { TOKEN_KEY } from '@zenith/shared';
import { config as appConfig } from '@/config';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import FilePreviewModal from '@/components/FilePreviewModal';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import AppModal from '@/components/AppModal';
import { getFileIcon, getFolderIcon } from '@/utils/fileIcons';
import {
  useDeleteTerminalEntries,
  useTerminalFileList,
  useTerminalFileOperation,
  useTerminalPickerList,
  useTerminalRootInfo,
  useUploadTerminalFile,
} from '@/hooks/queries/file-manager';
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

type ViewMode = 'list' | 'grid';
type ClipOp = 'copy' | 'cut';

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
    <button
      type="button"
      className={`fm-grid-card${selected ? ' fm-grid-card--selected' : ''}`}
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
      <div className="fm-grid-card__meta">{isDir ? '—' : formatSize(entry.size)}</div>
    </button>
  );
}

// ── 权限编辑器 ─────────────────────────────────────────────────────────────────

function modeToOctal(mode: number) { return mode.toString(8).padStart(3, '0'); }
function octalToMode(v: string) { const n = Number.parseInt(v, 8); return Number.isNaN(n) ? 0 : n; }

/** 上传进度更新（纯函数，提取到组件外避免每次渲染重建） */
function updateUploadPct(prev: { name: string; progress: number }[], idx: number, pct: number) {
  return prev.map((u, i) => (i === idx ? { ...u, progress: pct } : u));
}

/** 深度搜索结果弹窗标题（避免内联嵌套三元 / 嵌套模板字符串） */
function searchResultTitle(results: FsEntry[] | null): string {
  if (!results) return '搜索结果';
  const suffix = results.length >= 200 ? '+' : '';
  return `搜索结果（${results.length}${suffix}）`;
}
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
  const [initialized, setInitialized] = useState(false);
  const pickerQuery = useTerminalPickerList(pickerPath, visible && initialized);

  useEffect(() => {
    if (visible && !initialized) {
      setPickerPath(initialPath || '/');
      setInitialized(true);
    }
    if (!visible) setInitialized(false);
  }, [visible, initialPath, initialized]);

  useEffect(() => {
    if (pickerQuery.data?.path && pickerQuery.data.path !== pickerPath) {
      setPickerPath(pickerQuery.data.path);
    }
  }, [pickerPath, pickerQuery.data]);

  const loadPickerDir = (path: string) => setPickerPath(path);
  const pickerParent = pickerQuery.data?.parent ?? null;
  const pickerFolders = pickerQuery.data?.entries.filter((e) => e.type === 'dir').map((e) => ({ name: e.name, path: e.path })) ?? [];
  const pickerLoading = pickerQuery.isFetching;
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
      <div style={{ height: 280, overflowY: 'auto', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>
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
  const [currentPath, setCurrentPath] = useState('');
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
  // ── 导航历史 ─────────────────────────────────────────────────────────────────
  const historyRef = useRef<{ paths: string[]; index: number }>({ paths: [], index: -1 });
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  // ── 隐藏文件 & 属性面板 ────────────────────────────────────────────────────
  const [showHidden, setShowHidden] = useState(false);
  const [propsEntry, setPropsEntry] = useState<FsEntry | null>(null);
  const [propsChecksum, setPropsChecksum] = useState<{ algo: 'md5' | 'sha1' | 'sha256'; hash: string; loading: boolean } | null>(null);
  const rootInfoQuery = useTerminalRootInfo();
  const rootInfo = rootInfoQuery.data ?? null;
  const listQuery = useTerminalFileList(currentPath, currentPath !== '');
  const entries = listQuery.data?.entries ?? [];
  const loading = rootInfoQuery.isFetching || listQuery.isFetching;
  const fileOperationMutation = useTerminalFileOperation();
  const deleteEntriesMutation = useDeleteTerminalEntries();
  const uploadTerminalFileMutation = useUploadTerminalFile();
  const checksumMutation = useMutation({
    mutationFn: ({ path, algo }: { path: string; algo: 'md5' | 'sha1' | 'sha256' }) =>
      request.get<{ algo: string; hash: string; size: number }>(`/api/terminal-files/checksum${toQueryString({ path, algo })}`).then(unwrap),
  });
  // mutateAsync 引用稳定，可安全作为 useCallback 依赖
  const { mutateAsync: checksumMutateAsync } = checksumMutation;
  const searchMutation = useMutation({
    mutationFn: ({ dir, keyword }: { dir: string; keyword: string }) =>
      request.get<FsEntry[]>(`/api/terminal-files/search${toQueryString({ dir, keyword })}`).then(unwrap),
  });
  const searching = searchMutation.isPending;

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ob = new ResizeObserver((entries) => {
      for (const entry of entries) setContentHeight(Math.floor(entry.contentRect.height));
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  // 切换属性面板时清空校验和
  useEffect(() => { setPropsChecksum(null); }, [propsEntry]);

  useEffect(() => {
    if (!rootInfo || currentPath) return;
    const { home, isWindows, drives } = rootInfo;
    const rootPath = isWindows ? ((/^([A-Za-z]:)/.exec(home)?.[1] ?? drives[0] ?? 'C:') + '\\') : '/';
    void navigateTo(rootPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootInfo, currentPath]);

  useEffect(() => {
    if (listQuery.data?.path && listQuery.data.path !== currentPath) {
      setCurrentPath(listQuery.data.path);
    }
  }, [listQuery.data, currentPath]);

  // ── 导航 ─────────────────────────────────────────────────────────────────

  const navigateTo = useCallback(async (p: string, pushHistory = true) => {
    setSelectedPaths(new Set());
    setKeyword('');
    setCurrentPath(p);
    if (pushHistory) {
      const h = historyRef.current;
      const newStack = [...h.paths.slice(0, h.index + 1), p];
      historyRef.current = { paths: newStack, index: newStack.length - 1 };
      setCanBack(newStack.length > 1);
      setCanForward(false);
    }
  }, []);

  const refresh = useCallback(() => void listQuery.refetch(), [listQuery]);

  const goBack = useCallback(async () => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    const newIndex = h.index - 1;
    historyRef.current = { ...h, index: newIndex };
    setCanBack(newIndex > 0);
    setCanForward(true);
    await navigateTo(h.paths[newIndex], false);
  }, [navigateTo]);

  const goForward = useCallback(async () => {
    const h = historyRef.current;
    if (h.index >= h.paths.length - 1) return;
    const newIndex = h.index + 1;
    historyRef.current = { ...h, index: newIndex };
    setCanBack(true);
    setCanForward(newIndex < h.paths.length - 1);
    await navigateTo(h.paths[newIndex], false);
  }, [navigateTo]);

  const fetchPropsChecksum = useCallback(async (entry: FsEntry, algo: 'md5' | 'sha1' | 'sha256') => {
    setPropsChecksum({ algo, hash: '', loading: true });
    try {
      const res = await checksumMutateAsync({ path: entry.path, algo });
      setPropsChecksum({ algo, hash: res.hash, loading: false });
    } catch {
      setPropsChecksum({ algo, hash: '计算失败', loading: false });
    }
  }, [checksumMutateAsync]);

  // ── 过滤 + 侧栏 ───────────────────────────────────────────────────────────

  const filteredEntries = entries
    .filter((e) => showHidden || !e.name.startsWith('.'))
    .filter((e) => !keyword || e.name.toLowerCase().includes(keyword.toLowerCase()));

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
    await deleteEntriesMutation.mutateAsync(paths);
    Toast.success(`已删除 ${paths.length} 项`);
    clearSelect();
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
      await fileOperationMutation.mutateAsync({ endpoint, values: { from: e.path, to: dest } });
      success++;
    }
    const verb = mode === 'move' ? '移动' : '复制';
    Toast.success(`已${verb} ${success}/${pickedEntries.length} 项`);
    setFolderPicker(null);
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
      await fileOperationMutation.mutateAsync({ endpoint, values: { from: p, to: dest } });
    }
    Toast.success(`已${op === 'copy' ? '复制' : '移动'} ${paths.length} 项`);
    if (clipboard.op === 'cut') setClipboard(null);
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    const val = dialog.value.trim();
    if (!val) { Toast.warning('请输入名称'); return; }
    const sep = currentPath.includes('\\') ? '\\' : '/';

    if (dialog.mode === 'rename') {
      const dest = `${dialog.entry.path.replace(/[/\\]+[^/\\]+$/, '')}${sep}${val}`;
      await fileOperationMutation.mutateAsync({ endpoint: '/api/terminal-files/rename', values: { from: dialog.entry.path, to: dest } });
      Toast.success('已重命名'); setDialog(null);
    } else if (dialog.mode === 'newFile' || dialog.mode === 'newDir') {
      const type = dialog.mode === 'newDir' ? 'dir' : 'file';
      const newPath = `${currentPath.replace(/[/\\]+$/, '')}${sep}${val}`;
      await fileOperationMutation.mutateAsync({ endpoint: '/api/terminal-files/create', values: { path: newPath, type } });
      Toast.success('已创建'); setDialog(null);
    } else if (dialog.mode === 'move') {
      await fileOperationMutation.mutateAsync({ endpoint: '/api/terminal-files/move', values: { from: dialog.entry.path, to: val } });
      Toast.success('已移动'); setDialog(null);
    } else if (dialog.mode === 'copy') {
      await fileOperationMutation.mutateAsync({ endpoint: '/api/terminal-files/copy', values: { from: dialog.entry.path, to: val } });
      Toast.success('已复制'); setDialog(null);
    } else if (dialog.mode === 'compress') {
      const paths = dialog.selEntries.map((e) => e.path);
      const dest = `${currentPath.replace(/[/\\]+$/, '')}${sep}${val}`;
      await fileOperationMutation.mutateAsync({ endpoint: '/api/terminal-files/compress', values: { paths, destPath: dest } });
      Toast.success('压缩成功'); setDialog(null);
    } else if (dialog.mode === 'chmod') {
      const mode = Number.parseInt(val, 8);
      if (Number.isNaN(mode)) { Toast.error('请输入有效的八进制权限值，如 755'); return; }
      await fileOperationMutation.mutateAsync({ endpoint: '/api/terminal-files/chmod', values: { path: dialog.entry.path, mode } });
      Toast.success('权限已修改'); setDialog(null);
    }
  };

  // ── 上传 ─────────────────────────────────────────────────────────────────

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const dir = ctxUploadDirRef.current || currentPath;
    setUploading(files.map((f) => ({ name: f.name, progress: 0 })));

    const makeProgressHandler = (i: number) => (pct: number) => setUploading((prev) => updateUploadPct(prev, i, pct));
    Promise.allSettled(
      files.map((f, i) => {
        const formData = new FormData();
        formData.append('path', dir);
        formData.append('file', f);
        return uploadTerminalFileMutation.mutateAsync({ formData, onProgress: makeProgressHandler(i) });
      }),
    ).then((results) => {
      const success = results.filter((r) => r.status === 'fulfilled').length;
      Toast.success(`已上传 ${success}/${files.length} 个文件`);
      setUploading([]);
    });
    e.target.value = '';
  };

  // ── 上下文菜单 ────────────────────────────────────────────────────────────

  const isArchive = (name: string) => /\.(zip|tgz|tbz2?|txz|gz|tar|tar\.gz|tar\.bz2|tar\.xz)$/i.test(name);

  const handleExtract = async (entry: FsEntry) => {
    Toast.info({ content: '正在解压…', duration: 1 });
    await fileOperationMutation.mutateAsync({ endpoint: '/api/terminal-files/extract', values: { path: entry.path } });
    Toast.success('解压成功');
  };

  const fetchChecksum = async (entry: FsEntry, algo: 'md5' | 'sha1' | 'sha256') => {
    setChecksum({ entry, algo, hash: '', size: entry.size, loading: true });
    try {
      const res = await checksumMutation.mutateAsync({ path: entry.path, algo });
      setChecksum({ entry, algo, hash: res.hash, size: res.size, loading: false });
    } catch {
      setChecksum({ entry, algo, hash: '计算失败', size: entry.size, loading: false });
    }
  };

  const runSearch = async () => {
    const kw = searchKw.trim();
    if (!kw) { setSearchResults(null); return; }
    const res = await searchMutation.mutateAsync({ dir: currentPath, keyword: kw });
    setSearchResults(res ?? []);
  };

  const openCtxMenu = (e: React.MouseEvent, entry: FsEntry) => {
    e.preventDefault();
    setCtxEntry({ entry, x: e.clientX, y: e.clientY });
  };

  const closeCtxMenu = () => setCtxEntry(null);

  const buildCtxMenuItems = (ce: typeof ctxEntry) => {
    if (!ce) return [];
    const { entry } = ce;
    const isDir = entry.type === 'dir';
    const isFile = !isDir;
    const items: { label: string; fn: () => void; danger?: boolean }[] = [
      {
        label: isDir ? '打开' : '下载',
        fn: () => {
          if (isDir) void navigateTo(entry.path);
          else handleDownload(entry);
          closeCtxMenu();
        },
      },
      ...(isFile ? [{ label: '预览', fn: () => { void handlePreview(entry); closeCtxMenu(); } }] : []),
      { label: '重命名', fn: () => { setDialog({ mode: 'rename', entry, value: entry.name }); closeCtxMenu(); } },
      { label: '复制到…', fn: () => { setFolderPicker({ mode: 'copy', entries: [entry] }); closeCtxMenu(); } },
      { label: '移动到…', fn: () => { setFolderPicker({ mode: 'move', entries: [entry] }); closeCtxMenu(); } },
      { label: '压缩为 ZIP', fn: () => { setDialog({ mode: 'compress', selEntries: [entry], value: `${entry.name}.zip` }); closeCtxMenu(); } },
      ...(isFile && isArchive(entry.name) ? [{ label: '解压到此处', fn: () => { void handleExtract(entry); closeCtxMenu(); } }] : []),
      ...(isFile ? [{ label: '校验和', fn: () => { void fetchChecksum(entry, 'sha256'); closeCtxMenu(); } }] : []),
      { label: '修改权限', fn: () => { setDialog({ mode: 'chmod', entry, value: permStringToOctal(entry.permissions) }); closeCtxMenu(); } },
      ...(isDir ? [{ label: '上传到此目录', fn: () => { ctxUploadDirRef.current = entry.path; ctxUploadInputRef.current?.click(); closeCtxMenu(); } }] : []),
      { label: '属性', fn: () => { setPropsEntry(entry); closeCtxMenu(); } },
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
        const inner = (
          <>
            <Icon icon={iconId} width={16} height={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{v}</span>
          </>
        );
        if (r.type === 'dir') {
          return (
            <button
              type="button"
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', width: '100%', overflow: 'hidden' }}
              onClick={() => void navigateTo(r.path)}
            >
              {inner}
            </button>
          );
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {inner}
          </div>
        );
      },
    },
    { title: '大小', dataIndex: 'size', width: 100, render: (v: number, r: FsEntry) => r.type === 'dir' ? '—' : formatSize(v) },
    { title: '修改时间', dataIndex: 'mtime', width: 180 },
    { title: '权限', dataIndex: 'permissions', width: 110, render: (v?: string) => v ? <Tag size="small" color="grey">{v}</Tag> : '—' },
    { title: 'UID', dataIndex: 'uid', width: 70, render: (v?: number) => v ?? '—' },
    { title: 'GID', dataIndex: 'gid', width: 70, render: (v?: number) => v ?? '—' },
    createOperationColumn<FsEntry>({
      width: 170,
      desktopInlineKeys: ['open', 'preview', 'download'],
      actions: (record) => [
        ...(record.type === 'dir'
          ? [{
              key: 'open',
              label: '打开',
              onClick: () => { void navigateTo(record.path); },
            }]
          : [
              {
                key: 'preview',
                label: '预览',
                onClick: () => { void handlePreview(record); },
              },
              {
                key: 'download',
                label: '下载',
                onClick: () => handleDownload(record),
              },
            ]),
        {
          key: 'rename',
          label: '重命名',
          onClick: () => setDialog({ mode: 'rename', entry: record, value: record.name }),
        },
        {
          key: 'copy',
          label: '复制到...',
          onClick: () => setFolderPicker({ mode: 'copy', entries: [record] }),
        },
        {
          key: 'move',
          label: '移动到...',
          onClick: () => setFolderPicker({ mode: 'move', entries: [record] }),
        },
        {
          key: 'compress',
          label: '压缩为 ZIP',
          onClick: () => setDialog({ mode: 'compress', selEntries: [record], value: `${record.name}.zip` }),
        },
        {
          key: 'extract',
          label: '解压到此处',
          hidden: record.type === 'dir' || !isArchive(record.name),
          onClick: () => { void handleExtract(record); },
        },
        {
          key: 'checksum',
          label: '校验和',
          hidden: record.type === 'dir',
          onClick: () => { void fetchChecksum(record, 'sha256'); },
        },
        {
          key: 'chmod',
          label: '修改权限',
          onClick: () => setDialog({ mode: 'chmod', entry: record, value: permStringToOctal(record.permissions) }),
        },
        {
          key: 'props',
          label: '属性',
          onClick: () => setPropsEntry(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          dividerBefore: true,
          onClick: () => {
            Modal.confirm({
              title: '确定删除此项吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete([record.path]),
            });
          },
        },
      ],
    }),
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
                <Tooltip content={showHidden ? '隐藏点文件' : '显示隐藏文件'}>
                  <Button
                    size="small"
                    theme={showHidden ? 'solid' : 'borderless'}
                    type={showHidden ? 'primary' : 'tertiary'}
                    icon={showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
                    onClick={() => setShowHidden((v) => !v)}
                  />
                </Tooltip>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <Tooltip content="后退">
                <Button size="small" theme="borderless" type="tertiary" icon={<ChevronLeft size={14} />} disabled={!canBack} onClick={() => void goBack()} />
              </Tooltip>
              <Tooltip content="前进">
                <Button size="small" theme="borderless" type="tertiary" icon={<ChevronRight size={14} />} disabled={!canForward} onClick={() => void goForward()} />
              </Tooltip>
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
            </div>
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
              <div style={{ position: 'fixed', left: ctxEntry.x, top: ctxEntry.y, zIndex: 1001, minWidth: 150, background: 'var(--semi-color-bg-3)', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', boxShadow: 'var(--semi-shadow-elevated)', padding: '4px 0' }}>
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

          <AppModal
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
          </AppModal>

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
            title={searchResultTitle(searchResults)}
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
                    <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon icon={r.type === 'dir' ? getFolderIcon(r.name, false) : getFileIcon(r.name)} width={14} height={14} style={{ flexShrink: 0 }} />
                      {r.name}
                    </div>
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
          {/* ── 文件属性详情面板 ── */}
          <SideSheet
            title={
              propsEntry ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon
                    icon={propsEntry.type === 'dir' ? getFolderIcon(propsEntry.name, false) : getFileIcon(propsEntry.name)}
                    width={18}
                    height={18}
                  />
                  <Typography.Text strong ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>
                    {propsEntry.name}
                  </Typography.Text>
                </div>
              ) : '属性'
            }
            visible={!!propsEntry}
            onCancel={() => setPropsEntry(null)}
            width={320}
            closeOnEsc
            mask={false}
          >
            {propsEntry && (() => {
              const isDir = propsEntry.type === 'dir';
              const ext = !isDir && propsEntry.name.includes('.') ? propsEntry.name.split('.').pop()?.toUpperCase() : undefined;
              const octal = propsEntry.permissions ? permStringToOctal(propsEntry.permissions) : undefined;
              const rows: { label: string; value: React.ReactNode }[] = [
                {
                  label: '类型',
                  value: isDir
                    ? <Tag size="small" color="blue">文件夹</Tag>
                    : <Tag size="small" color="green">{ext ? `${ext} 文件` : '文件'}</Tag>,
                },
                {
                  label: '路径',
                  value: (
                    <Typography.Text
                      size="small"
                      copyable
                      style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}
                    >
                      {propsEntry.path}
                    </Typography.Text>
                  ),
                },
                ...(!isDir ? [{ label: '大小', value: `${formatSize(propsEntry.size)}  (${propsEntry.size.toLocaleString()} 字节)` }] : []),
                { label: '修改时间', value: propsEntry.mtime },
                ...(propsEntry.permissions
                  ? [{
                    label: '权限',
                    value: (
                      <Tag size="small" color="grey" style={{ fontFamily: 'monospace' }}>
                        {propsEntry.permissions}{octal ? ` (${octal})` : ''}
                      </Tag>
                    ),
                  }]
                  : []),
                ...(propsEntry.uid !== undefined
                  ? [{ label: 'UID / GID', value: `${propsEntry.uid} / ${propsEntry.gid ?? '—'}` }]
                  : []),
              ];
              return (
                <div>
                  {rows.map((r) => (
                    <div
                      key={r.label}
                      style={{ display: 'flex', alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid var(--semi-color-fill-1)' }}
                    >
                      <Typography.Text
                        type="tertiary"
                        size="small"
                        style={{ width: 72, flexShrink: 0, paddingTop: 1 }}
                      >
                        {r.label}
                      </Typography.Text>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {typeof r.value === 'string'
                          ? <Typography.Text size="small">{r.value}</Typography.Text>
                          : r.value}
                      </div>
                    </div>
                  ))}
                  {!isDir && (
                    <div style={{ paddingTop: 14 }}>
                      <Typography.Text
                        type="tertiary"
                        size="small"
                        style={{ display: 'block', marginBottom: 8 }}
                      >
                        校验和
                      </Typography.Text>
                      <Space spacing={4} style={{ marginBottom: 8 }}>
                        {(['md5', 'sha1', 'sha256'] as const).map((algo) => (
                          <Button
                            key={algo}
                            size="small"
                            theme={propsChecksum?.algo === algo ? 'solid' : 'light'}
                            type={propsChecksum?.algo === algo ? 'primary' : 'tertiary'}
                            onClick={() => void fetchPropsChecksum(propsEntry, algo)}
                          >
                            {algo.toUpperCase()}
                          </Button>
                        ))}
                      </Space>
                      {propsChecksum && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Input
                            readOnly
                            value={propsChecksum.loading ? '计算中…' : propsChecksum.hash}
                            style={{ fontFamily: 'monospace', fontSize: 11 }}
                            size="small"
                          />
                          <Button
                            size="small"
                            disabled={propsChecksum.loading || !propsChecksum.hash}
                            onClick={() => {
                              void navigator.clipboard?.writeText(propsChecksum.hash);
                              Toast.success('已复制');
                            }}
                          >
                            复制
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </SideSheet>
        </>
      }
    />
  );
}
