/**
 * SftpExplorer — SSH 远程文件浏览器（SFTP）
 *
 * 复用 SSH 配置连接远程主机，懒加载远程文件树，支持：
 *  - 浏览 / 刷新 / 回到 home
 *  - 新建文件、新建文件夹、重命名、删除
 *  - 上传、下载
 *  - 点击文件 → onOpenFile(`sftp://<profileId><path>`) 在编辑器中打开（可写）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Tree, Button, Typography, Toast, Tooltip, Spin, Dropdown, Modal, Input } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Icon } from '@iconify/react';
import {
  RefreshCw, Home, FilePlus, FolderPlus, Upload as UploadIcon, Folder, File as FileIcon,
} from 'lucide-react';
import { request } from '@/utils/request';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import { getFileIcon } from './fileIcons';
import type { SshProfile } from './SshProfilesManager';
import AppModal from '@/components/AppModal';

interface SftpEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
  permissions?: string;
}

interface SftpListing {
  path: string;
  parent: string | null;
  entries: SftpEntry[];
}

interface SftpNode extends TreeNodeData {
  fileType: 'dir' | 'file';
  fullPath: string;
}

interface SftpExplorerProps {
  readonly profile: SshProfile;
  readonly onOpenFile: (sftpUrl: string) => void;
}

function entryToNode(e: SftpEntry): SftpNode {
  return {
    key: e.path,
    value: e.path,
    label: e.name,
    isLeaf: e.type === 'file',
    children: e.type === 'dir' ? undefined : [],
    fileType: e.type,
    fullPath: e.path,
  };
}

function setChildren(nodes: SftpNode[], key: string, children: SftpNode[]): SftpNode[] {
  return nodes.map((n) => {
    if (n.key === key) return { ...n, children };
    if (n.children) return { ...n, children: setChildren(n.children as SftpNode[], key, children) };
    return n;
  });
}

function joinPosix(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function parentPosix(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : '/';
}

type DialogState =
  | { mode: 'createFile' | 'createDir'; baseDir: string; value: string }
  | { mode: 'rename'; baseDir: string; oldPath: string; value: string }
  | { mode: 'chmod'; targetPath: string; value: string };

export default function SftpExplorer({ profile, onOpenFile }: SftpExplorerProps) {
  const [treeData, setTreeData] = useState<SftpNode[]>([]);
  const [rootPath, setRootPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadDirRef = useRef('/');

  const api = `/api/ssh-sftp/${profile.id}`;

  const listDir = useCallback(async (dir: string): Promise<SftpEntry[] | null> => {
    const res = await request.get<SftpListing>(`${api}/list?path=${encodeURIComponent(dir)}`, { silent: true });
    if (res.code === 0 && res.data) return res.data.entries;
    return null;
  }, [api]);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    const homeRes = await request.get<{ home: string }>(`${api}/home`, { silent: true });
    if (homeRes.code !== 0 || !homeRes.data) {
      setLoading(false);
      setError(homeRes.message || '无法连接远程主机');
      return;
    }
    const home = homeRes.data.home || '/';
    const res = await request.get<SftpListing>(`${api}/list?path=${encodeURIComponent(home)}`, { silent: true });
    setLoading(false);
    if (res.code === 0 && res.data) {
      setRootPath(res.data.path);
      setTreeData(res.data.entries.map(entryToNode));
      setExpandedKeys([]);
    } else {
      setError(res.message || '加载远程目录失败');
    }
  }, [api]);

  useEffect(() => { void loadRoot(); }, [loadRoot]);

  const loadData = useCallback((node?: TreeNodeData): Promise<void> => {
    const n = node as SftpNode | undefined;
    if (!n || n.fileType === 'file') return Promise.resolve();
    const dir = n.fullPath;
    return listDir(dir).then((entries) => {
      setTreeData((prev) => setChildren(prev, dir, (entries ?? []).map(entryToNode)));
    });
  }, [listDir]);

  /** 重新加载指定目录（CRUD 后刷新） */
  const reloadDir = useCallback(async (dir: string) => {
    const entries = await listDir(dir);
    if (!entries) return;
    if (dir === rootPath) {
      setTreeData(entries.map(entryToNode));
    } else {
      setTreeData((prev) => setChildren(prev, dir, entries.map(entryToNode)));
      setExpandedKeys((prev) => (prev.includes(dir) ? prev : [...prev, dir]));
    }
  }, [listDir, rootPath]);

  const handleSelect = useCallback((key: string, node: TreeNodeData) => {
    const n = node as SftpNode;
    if (n.fileType === 'file') onOpenFile(`sftp://${profile.id}${n.fullPath}`);
  }, [onOpenFile, profile.id]);

  // ── CRUD ──
  const submitDialog = useCallback(async () => {
    if (!dialog) return;
    const name = dialog.value.trim();
    if (!name && dialog.mode !== 'rename') { Toast.warning('请输入名称'); return; }
    if (dialog.mode === 'rename') {
      const to = joinPosix(dialog.baseDir, name);
      const res = await request.post(`${api}/rename`, { from: dialog.oldPath, to });
      if (res.code === 0) { Toast.success('已重命名'); setDialog(null); void reloadDir(dialog.baseDir); }
    } else if (dialog.mode === 'chmod') {
      const mode = Number.parseInt(name, 8);
      if (Number.isNaN(mode)) { Toast.error('请输入有效的八进制权限值，如 755'); return; }
      const res = await request.post(`${api}/chmod`, { path: dialog.targetPath, mode });
      if (res.code === 0) { Toast.success('权限已修改'); setDialog(null); void reloadDir(parentPosix(dialog.targetPath)); }
    } else {
      const target = joinPosix(dialog.baseDir, name);
      const type = dialog.mode === 'createDir' ? 'dir' : 'file';
      const res = await request.post(`${api}/create`, { path: target, type });
      if (res.code === 0) { Toast.success('已创建'); setDialog(null); void reloadDir(dialog.baseDir); }
    }
  }, [dialog, api, reloadDir]);

  const handleDelete = useCallback(async (node: SftpNode) => {
    const res = await request.delete(`${api}/entry?path=${encodeURIComponent(node.fullPath)}`);
    if (res.code === 0) { Toast.success('已删除'); void reloadDir(parentPosix(node.fullPath)); }
  }, [api, reloadDir]);

  const handleDownload = useCallback(async (node: SftpNode) => {
    const token = localStorage.getItem(TOKEN_KEY) ?? '';
    const base = config.apiBaseUrl || '';
    const url = `${base}${api}/download?path=${encodeURIComponent(node.fullPath)}`;
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = node.label as string;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch {
      Toast.error('下载失败');
    }
  }, [api]);

  const triggerUpload = useCallback((dir: string) => {
    uploadDirRef.current = dir;
    uploadInputRef.current?.click();
  }, []);

  const handleUploadFiles = useCallback(async (files: FileList) => {
    const token = localStorage.getItem(TOKEN_KEY) ?? '';
    const base = config.apiBaseUrl || '';
    const dir = uploadDirRef.current;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('path', dir);
      fd.append('file', file);
      try {
        const res = await fetch(`${base}${api}/upload`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        Toast.success(`已上传 ${file.name}`);
      } catch {
        Toast.error(`上传失败：${file.name}`);
      }
    }
    void reloadDir(dir);
  }, [api, reloadDir]);

  const renderContextMenu = useCallback((node: SftpNode) => {
    const isDir = node.fileType === 'dir';
    const baseDir = isDir ? node.fullPath : parentPosix(node.fullPath);
    return (
      <Dropdown.Menu>
        {!isDir && <Dropdown.Item onClick={() => onOpenFile(`sftp://${profile.id}${node.fullPath}`)}>打开</Dropdown.Item>}
        {!isDir && <Dropdown.Item onClick={() => void handleDownload(node)}>下载</Dropdown.Item>}
        {isDir && <Dropdown.Item onClick={() => setDialog({ mode: 'createFile', baseDir, value: '' })}>新建文件</Dropdown.Item>}
        {isDir && <Dropdown.Item onClick={() => setDialog({ mode: 'createDir', baseDir, value: '' })}>新建文件夹</Dropdown.Item>}
        {isDir && <Dropdown.Item onClick={() => triggerUpload(baseDir)}>上传到此处</Dropdown.Item>}
        <Dropdown.Item onClick={() => setDialog({ mode: 'rename', baseDir: parentPosix(node.fullPath), oldPath: node.fullPath, value: node.label as string })}>重命名</Dropdown.Item>
        <Dropdown.Item onClick={() => setDialog({ mode: 'chmod', targetPath: node.fullPath, value: '755' })}>修改权限</Dropdown.Item>
        <Dropdown.Item type="danger" onClick={() => void handleDelete(node)}>删除</Dropdown.Item>
      </Dropdown.Menu>
    );
  }, [onOpenFile, profile.id, handleDownload, triggerUpload, handleDelete]);

  const renderLabel = useCallback((label: React.ReactNode, node: SftpNode) => {
    const iconId = node.fileType === 'file' ? getFileIcon(node.label as string) : '';
    return (
      <Dropdown trigger="contextMenu" position="bottomLeft" render={renderContextMenu(node)}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, width: '100%', minWidth: 0 }}>
          {node.fileType === 'dir'
            ? <Folder size={14} style={{ color: 'var(--semi-color-warning)', flexShrink: 0 }} />
            : (iconId ? <Icon icon={iconId} width={14} height={14} style={{ flexShrink: 0 }} /> : <FileIcon size={14} style={{ color: 'var(--semi-color-text-3)', flexShrink: 0 }} />)}
          <Typography.Text size="small" ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>{label}</Typography.Text>
        </span>
      </Dropdown>
    );
  }, [renderContextMenu]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid var(--semi-color-border)', flexShrink: 0, gap: 4 }}>
        <Typography.Text size="small" strong type="secondary" ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>
          🌐 {profile.name}
        </Typography.Text>
        <Tooltip content="回到 home"><Button size="small" theme="borderless" type="tertiary" icon={<Home size={13} />} onClick={() => void loadRoot()} /></Tooltip>
        <Tooltip content="新建文件"><Button size="small" theme="borderless" type="tertiary" icon={<FilePlus size={13} />} onClick={() => setDialog({ mode: 'createFile', baseDir: rootPath, value: '' })} /></Tooltip>
        <Tooltip content="新建文件夹"><Button size="small" theme="borderless" type="tertiary" icon={<FolderPlus size={13} />} onClick={() => setDialog({ mode: 'createDir', baseDir: rootPath, value: '' })} /></Tooltip>
        <Tooltip content="上传到当前目录"><Button size="small" theme="borderless" type="tertiary" icon={<UploadIcon size={13} />} onClick={() => triggerUpload(rootPath)} /></Tooltip>
        <Tooltip content="刷新"><Button size="small" theme="borderless" type="tertiary" icon={<RefreshCw size={13} />} loading={loading} onClick={() => void loadRoot()} /></Tooltip>
      </div>

      {/* 树 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
        {loading && treeData.length === 0
          ? <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spin size="small" /></div>
          : error
            ? <div style={{ padding: '24px 16px', textAlign: 'center' }}><Typography.Text type="danger" size="small">{error}</Typography.Text></div>
            : (
              <Tree
                treeData={treeData as TreeNodeData[]}
                loadData={loadData}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys as string[])}
                onSelect={(key, _selected, node) => handleSelect(key as string, node)}
                renderLabel={(label, node) => renderLabel(label, node as SftpNode)}
                style={{ fontSize: 12 }}
                motion={false}
              />
            )
        }
        {!loading && !error && treeData.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <Typography.Text type="tertiary" size="small">空目录</Typography.Text>
          </div>
        )}
      </div>

      {/* 隐藏上传 input */}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.length) void handleUploadFiles(e.target.files); e.target.value = ''; }}
      />

      {/* 新建 / 重命名对话框 */}
      <AppModal
        title={dialog?.mode === 'rename' ? '重命名' : dialog?.mode === 'chmod' ? '修改权限（八进制）' : dialog?.mode === 'createDir' ? '新建文件夹' : '新建文件'}
        visible={!!dialog}
        onCancel={() => setDialog(null)}
        onOk={() => void submitDialog()}
        closeOnEsc
        width={420}
      >
        <Input
          value={dialog?.value ?? ''}
          autoFocus
          placeholder={dialog?.mode === 'chmod' ? '如 755 / 644' : '请输入名称'}
          onChange={(v) => setDialog((d) => (d ? { ...d, value: v } : d))}
          onEnterPress={() => void submitDialog()}
        />
      </AppModal>
    </div>
  );
}
