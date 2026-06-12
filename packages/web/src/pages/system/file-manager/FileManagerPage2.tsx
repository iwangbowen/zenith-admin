/**
 * 服务器文件管理器 — 干净版（所有 lint 问题已修复）
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Button, Input, Space, Tooltip, Dropdown, Modal, Toast,
  Typography, Tag, Spin, Breadcrumb, Popconfirm,
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
      {!isDir && (
        <div className="fm-grid-card__meta">{formatSize(entry.size)}</div>
      )}
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
      { label: '重命名', fn: () => { setDialog({ mode: 'rename', entry, value: entry.name }); closeCtxMenu(); } },
      { label: '复制到…', fn: () => { setDialog({ mode: 'copy', entry, value: entry.path }); closeCtxMenu(); } },
      { label: '移动到…', fn: () => { setDialog({ mode: 'move', entry, value: entry.path }); closeCtxMenu(); } },
      { label: '压缩为 ZIP', fn: () => { setDialog({ mode: 'compress', selEntries: [entry], value: `${entry.name}.zip` }); closeCtxMenu(); } },
      { label: '修改权限', fn: () => { setDialog({ mode: 'chmod', entry, value: '' }); closeCtxMenu(); } },
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
      width: 180,
      render: (_: unknown, r: FsEntry) => (
        <Space>
          {r.type === 'dir' ? (
            <Button size="small" theme="borderless" onClick={() => void navigateTo(r.path)}>打开</Button>
          ) : (
            <Button size="small" theme="borderless" onClick={() => handleDownload(r)}>下载</Button>
          )}
          <Popconfirm title="确定要删除吗？" okType="danger" onConfirm={() => void handleDelete([r.path])}>
            <Button size="small" theme="borderless" type="danger">删除</Button>
          </Popconfirm>
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => setDialog({ mode: 'rename', entry: r, value: r.name })}>重命名</Dropdown.Item>
                <Dropdown.Item onClick={() => setDialog({ mode: 'copy', entry: r, value: r.path })}>复制到…</Dropdown.Item>
                <Dropdown.Item onClick={() => setDialog({ mode: 'move', entry: r, value: r.path })}>移动到…</Dropdown.Item>
                <Dropdown.Item onClick={() => setDialog({ mode: 'compress', selEntries: [r], value: `${r.name}.zip` })}>压缩为 ZIP</Dropdown.Item>
                <Dropdown.Item onClick={() => setDialog({ mode: 'chmod', entry: r, value: '' })}>修改权限</Dropdown.Item>
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
        <div className="fm-grid">
          {filteredEntries.map((e) => (
            <FsGridCard
              key={e.path}
              entry={e}
              selected={selectedPaths.has(e.path)}
              onSelect={() => toggleSelect(e.path)}
              onOpen={() => { if (e.type === 'dir') void navigateTo(e.path); else handleDownload(e); }}
              onContextMenu={(ev) => openCtxMenu(ev, e)}
            />
          ))}
        </div>
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
    <div className="fm-page">
      {/* 左侧目录树 */}
      <div className="fm-sidebar">
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
        {rootInfo?.home && (
          <div className="fm-sidebar__shortcuts">
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              icon={<Home size={13} />}
              onClick={() => void navigateTo(rootInfo.home)}
              style={{ width: '100%', justifyContent: 'flex-start', paddingLeft: 8 }}
            >
              主目录
            </Button>
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
      </div>

      {/* 右侧主内容 */}
      <div className="fm-main">
        <div className="fm-toolbar">
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
        </div>

        <div className="fm-content">
          {renderContent()}
        </div>

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
          <div>
            <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 6 }}>
              输入八进制权限值，如 755（rwxr-xr-x）、644（rw-r--r--）
            </Typography.Text>
            <Input
              value={dialog.value}
              onChange={(v) => setDialog((d) => d ? { ...d, value: v } : d)}
              onEnterPress={() => void confirmDialog()}
              placeholder="755"
              maxLength={4}
            />
          </div>
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
    </div>
  );
}
