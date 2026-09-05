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
import { useQueryClient } from '@tanstack/react-query';
import { Tree, Button, Typography, Toast, Tooltip, Spin, Dropdown, Input } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Icon } from '@iconify/react';
import {
  RefreshCw, Home, FilePlus, FolderPlus, Upload as UploadIcon, Folder, File as FileIcon,
} from 'lucide-react';
import { getFileIcon } from '@/utils/fileIcons';
import { request } from '@/utils/request';
import type { SshProfile } from './SshProfilesManager';
import AppModal from '@/components/AppModal';
import {
  entryToTreeNode,
  setTreeChildren,
  joinPosix,
  parentPosix,
  fsDialogTitle,
  type FsDialogState,
  type FsTreeNode,
} from './fileTree';
import type { SftpFileEntry } from '@zenith/shared/ops';
import {
  fetchSftpDir,
  sftpDownloadUrl,
  sftpHomeQueryOptions,
  uploadSftpFile,
  useSftpFileMutation,
} from '@/hooks/queries/terminal-files';

/** SFTP 树节点等价于共享的文件树节点，仅为可读性保留别名 */
type SftpNode = FsTreeNode;

interface SftpExplorerProps {
  readonly profile: SshProfile;
  readonly onOpenFile: (sftpUrl: string) => void;
}

export default function SftpExplorer({ profile, onOpenFile }: SftpExplorerProps) {
  const queryClient = useQueryClient();
  const fileMutation = useSftpFileMutation(profile.id);
  const [treeData, setTreeData] = useState<SftpNode[]>([]);
  const [rootPath, setRootPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [dialog, setDialog] = useState<FsDialogState | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadDirRef = useRef('/');

  const listDir = useCallback(async (dir: string): Promise<SftpFileEntry[] | null> => {
    try {
      const res = await fetchSftpDir(queryClient, profile.id, dir, { silent: true });
      return res.entries;
    } catch {
      return null;
    }
  }, [queryClient, profile.id]);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    let homeData: { home: string };
    try {
      homeData = await queryClient.fetchQuery(sftpHomeQueryOptions(profile.id));
    } catch {
      setLoading(false);
      setError('无法连接远程主机');
      return;
    }
    const home = homeData.home || '/';
    try {
      const res = await fetchSftpDir(queryClient, profile.id, home, { silent: true });
      setRootPath(res.path);
      setTreeData(res.entries.map(entryToTreeNode));
      setExpandedKeys([]);
    } catch {
      setError('加载远程目录失败');
    } finally {
      setLoading(false);
    }
  }, [queryClient, profile.id]);

  useEffect(() => { void loadRoot(); }, [loadRoot]);

  const loadData = useCallback((node?: TreeNodeData): Promise<void> => {
    const n = node as SftpNode | undefined;
    if (!n || n.fileType === 'file') return Promise.resolve();
    const dir = n.fullPath;
    return listDir(dir).then((entries) => {
      setTreeData((prev) => setTreeChildren(prev, dir, (entries ?? []).map(entryToTreeNode)));
    });
  }, [listDir]);

  /** 重新加载指定目录（CRUD 后刷新） */
  const reloadDir = useCallback(async (dir: string) => {
    const entries = await listDir(dir);
    if (!entries) return;
    if (dir === rootPath) {
      setTreeData(entries.map(entryToTreeNode));
    } else {
      setTreeData((prev) => setTreeChildren(prev, dir, entries.map(entryToTreeNode)));
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
      await fileMutation.mutateAsync({ kind: 'rename', from: dialog.oldPath, to });
      Toast.success('已重命名'); setDialog(null); void reloadDir(dialog.baseDir);
    } else if (dialog.mode === 'chmod') {
      const mode = Number.parseInt(name, 8);
      if (Number.isNaN(mode)) { Toast.error('请输入有效的八进制权限值，如 755'); return; }
      await fileMutation.mutateAsync({ kind: 'chmod', path: dialog.targetPath, mode });
      Toast.success('权限已修改'); setDialog(null); void reloadDir(parentPosix(dialog.targetPath));
    } else {
      const target = joinPosix(dialog.baseDir, name);
      const type = dialog.mode === 'createDir' ? 'dir' : 'file';
      await fileMutation.mutateAsync({ kind: 'create', path: target, type });
      Toast.success('已创建'); setDialog(null); void reloadDir(dialog.baseDir);
    }
  }, [dialog, fileMutation, reloadDir]);

  const handleDelete = useCallback(async (node: SftpNode) => {
    await fileMutation.mutateAsync({ kind: 'delete', path: node.fullPath });
    Toast.success('已删除'); void reloadDir(parentPosix(node.fullPath));
  }, [fileMutation, reloadDir]);

  const handleDownload = useCallback(async (node: SftpNode) => {
    // 走统一 request：裸 fetch 会绕过 401 刷新、错误上报与 Demo 模式
    await request.download(sftpDownloadUrl(profile.id, node.fullPath), node.label as string);
  }, [profile.id]);

  const triggerUpload = useCallback((dir: string) => {
    uploadDirRef.current = dir;
    uploadInputRef.current?.click();
  }, []);

  const handleUploadFiles = useCallback(async (files: FileList) => {
    const dir = uploadDirRef.current;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('path', dir);
      fd.append('file', file);
      // 走统一 request：超限（413）等错误由全局提示统一呈现
      const res = await uploadSftpFile(profile.id, fd);
      if (res.code === 0) Toast.success(`已上传 ${file.name}`);
    }
    void reloadDir(dir);
  }, [profile.id, reloadDir]);

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
        title={fsDialogTitle(dialog?.mode)}
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
