import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Tree, Button, Upload, Toast, Typography, Tooltip, Dropdown, Modal, Input, Collapse } from '@douyinfe/semi-ui';
import { Icon } from '@iconify/react';
import {
  Upload as UploadIcon,
  RotateCcw,
  MoreHorizontal,
  Star,
  FolderPlus,
  FilePlus,
  Trash2,
  Pencil,
  Download,
  SquareTerminal,
  X,
} from 'lucide-react';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { request } from '@/utils/request';
import { useTerminalPreferences } from './useTerminalPreferences';
import { getFileIcon, getFolderIcon } from './fileIcons';

interface FileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
}

interface DirListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

/** Semi Tree 节点（附带 fileType 自定义字段） */
interface FileNode {
  label: string;
  value: string;
  key: string;
  isLeaf: boolean;
  fileType: 'dir' | 'file';
  children?: FileNode[];
}

function entryToNode(e: FileEntry): FileNode {
  return {
    label: e.name,
    value: e.path,
    key: e.path,
    isLeaf: e.type === 'file',
    fileType: e.type,
  };
}

/** 递归为指定 key 的节点设置子节点 */
function setChildren(nodes: FileNode[], key: string, children: FileNode[]): FileNode[] {
  return nodes.map((n) => {
    if (n.key === key) return { ...n, children };
    if (n.children) return { ...n, children: setChildren(n.children, key, children) };
    return n;
  });
}

function parentOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : p;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir.replace(/[/\\]+$/, '')}${sep}${name}`;
}

type DialogState =
  | { mode: 'createFile' | 'createDir'; baseDir: string; value: string }
  | { mode: 'rename'; baseDir: string; oldPath: string; value: string };

function dialogTitleOf(mode: DialogState['mode'] | undefined): string {
  if (mode === 'rename') return '重命名';
  if (mode === 'createDir') return '新建文件夹';
  return '新建文件';
}

interface FileExplorerProps {
  readonly active: boolean;
  readonly onOpenFile: (path: string) => void;
  readonly onOpenTerminalAt: (path: string) => void;
}

export default function FileExplorer({ active, onOpenFile, onOpenTerminalAt }: FileExplorerProps) {
  const { terminal, setTerminalPref } = useTerminalPreferences();
  const favorites = terminal.favorites;

  const [treeData, setTreeData] = useState<FileNode[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [selectedDir, setSelectedDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const loadedRef = useRef(false);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    const res = await request.get<DirListing>('/api/terminal-files/list');
    setLoading(false);
    if (res.code === 0 && res.data) {
      setRootPath(res.data.path);
      setSelectedDir(res.data.path);
      setTreeData(res.data.entries.map(entryToNode));
    }
  }, []);

  // 侧边栏首次显示时加载根目录
  useEffect(() => {
    if (active && !loadedRef.current) {
      loadedRef.current = true;
      void loadRoot();
    }
  }, [active, loadRoot]);

  // 懒加载子目录
  const loadData = useCallback((node?: TreeNodeData) => {
    if (!node || node.isLeaf || (node as unknown as FileNode).fileType === 'file') return Promise.resolve();
    const dir = String(node.value);
    const key = String(node.key);
    return request
      .get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(dir)}`)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setTreeData((prev) => setChildren(prev, key, res.data.entries.map(entryToNode)));
        }
      });
  }, []);

  // 刷新指定目录（根目录走 loadRoot）
  const refreshDir = useCallback(
    (dirPath: string) => {
      if (!dirPath || dirPath === rootPath) {
        void loadRoot();
        return;
      }
      void request
        .get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(dirPath)}`)
        .then((res) => {
          if (res.code === 0 && res.data) {
            setTreeData((prev) => setChildren(prev, dirPath, res.data.entries.map(entryToNode)));
          }
        });
    },
    [rootPath, loadRoot],
  );

  const ensureLoaded = useCallback(async (dir: string) => {
    const res = await request.get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(dir)}`, { silent: true });
    if (res.code === 0 && res.data) {
      const entries = res.data.entries.map(entryToNode);
      setTreeData((prev) => setChildren(prev, dir, entries));
    }
  }, []);

  // 在文件树中逐级展开并定位到指定目录
  const locateInTree = useCallback(
    async (target: string) => {
      const root = rootPath;
      const inRoot = !!root && (target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`));
      if (!inRoot) {
        Toast.warning('该目录不在当前文件树范围内');
        return;
      }
      const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
      const relParts = target.slice(root.length).split(/[/\\]/).filter(Boolean);
      const levelPaths: string[] = [];
      let cur = root;
      for (const seg of relParts) {
        cur = `${cur.replace(/[/\\]+$/, '')}${sep}${seg}`;
        levelPaths.push(cur);
      }
      const ancestors = levelPaths.slice(0, -1);
      for (const dir of ancestors) {
        await ensureLoaded(dir);
      }
      setExpandedKeys((prev) => Array.from(new Set([...prev, ...ancestors])));
      setSelectedKey(target);
    },
    [rootPath, ensureLoaded],
  );

  const isFavorite = (path: string) => favorites.some((f) => f.path === path);

  const toggleFavorite = (path: string, name: string) => {
    const next = isFavorite(path) ? favorites.filter((f) => f.path !== path) : [...favorites, { path, name }];
    setTerminalPref({ favorites: next });
  };

  const downloadFile = (path: string) => {
    const fileName = path.split(/[\\/]/).pop() ?? 'download';
    request.download(`/api/terminal-files/download?path=${encodeURIComponent(path)}`, fileName).catch(() => undefined);
  };

  const confirmDelete = (node: FileNode) => {
    Modal.confirm({
      title: `删除${node.fileType === 'dir' ? '目录' : '文件'}`,
      content: `确定删除「${node.label}」吗？${node.fileType === 'dir' ? '目录及其全部内容将被永久删除，' : ''}此操作不可恢复。`,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        const res = await request.delete(`/api/terminal-files/entry?path=${encodeURIComponent(node.value)}`);
        if (res.code === 0) {
          Toast.success('已删除');
          if (isFavorite(node.value)) toggleFavorite(node.value, node.label);
          refreshDir(parentOf(node.value));
        }
      },
    });
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    const name = dialog.value.trim();
    if (!name) {
      Toast.warning('请输入名称');
      return;
    }
    const target = joinPath(dialog.baseDir, name);
    if (dialog.mode === 'rename') {
      const res = await request.post('/api/terminal-files/rename', { from: dialog.oldPath, to: target });
      if (res.code === 0) {
        Toast.success('已重命名');
        setDialog(null);
        refreshDir(dialog.baseDir);
      }
    } else {
      const type = dialog.mode === 'createDir' ? 'dir' : 'file';
      const res = await request.post<FileEntry>('/api/terminal-files/create', { path: target, type });
      if (res.code === 0) {
        Toast.success('已创建');
        setDialog(null);
        refreshDir(dialog.baseDir);
        if (type === 'file' && res.data) onOpenFile(res.data.path);
      }
    }
  };

  // 选中：文件 → 打开编辑 tab；目录 → 设为上传目标
  const handleSelect = (_value: string, _selected: boolean, node: TreeNodeData) => {
    const n = node as unknown as FileNode;
    if (n.fileType === 'file') onOpenFile(String(node.value));
    else setSelectedDir(String(node.value));
  };

  const nodeMenu = (node: FileNode) => {
    if (node.fileType === 'file') {
      return (
        <Dropdown.Menu>
          <Dropdown.Item icon={<FilePlus size={14} />} onClick={() => onOpenFile(node.value)}>打开编辑</Dropdown.Item>
          <Dropdown.Item icon={<Download size={14} />} onClick={() => downloadFile(node.value)}>下载</Dropdown.Item>
          <Dropdown.Item icon={<Pencil size={14} />} onClick={() => setDialog({ mode: 'rename', baseDir: parentOf(node.value), oldPath: node.value, value: node.label })}>重命名</Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Item type="danger" icon={<Trash2 size={14} />} onClick={() => confirmDelete(node)}>删除</Dropdown.Item>
        </Dropdown.Menu>
      );
    }
    const fav = isFavorite(node.value);
    return (
      <Dropdown.Menu>
        <Dropdown.Item icon={<SquareTerminal size={14} />} onClick={() => onOpenTerminalAt(node.value)}>在此打开终端</Dropdown.Item>
        <Dropdown.Item icon={<Star size={14} />} onClick={() => toggleFavorite(node.value, node.label)}>{fav ? '取消收藏' : '收藏'}</Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item icon={<FilePlus size={14} />} onClick={() => setDialog({ mode: 'createFile', baseDir: node.value, value: '' })}>新建文件</Dropdown.Item>
        <Dropdown.Item icon={<FolderPlus size={14} />} onClick={() => setDialog({ mode: 'createDir', baseDir: node.value, value: '' })}>新建文件夹</Dropdown.Item>
        <Dropdown.Item icon={<Pencil size={14} />} onClick={() => setDialog({ mode: 'rename', baseDir: parentOf(node.value), oldPath: node.value, value: node.label })}>重命名</Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item type="danger" icon={<Trash2 size={14} />} onClick={() => confirmDelete(node)}>删除</Dropdown.Item>
      </Dropdown.Menu>
    );
  };

  const renderLabel = (label?: ReactNode, item?: TreeNodeData) => {
    const node = item as unknown as FileNode;
    const fav = node.fileType === 'dir' && isFavorite(node.value);
    const isOpen = expandedKeys.includes(node.key);
    const iconId =
      node.fileType === 'dir'
        ? getFolderIcon(node.label, isOpen)
        : getFileIcon(node.label);
    return (
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 4 }}>
        <Icon icon={iconId} width={16} height={16} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
          {fav ? ' ★' : ''}
        </span>
        <Dropdown trigger="click" clickToHide stopPropagation position="bottomRight" render={nodeMenu(node)}>
          <Button
            size="small"
            theme="borderless"
            type="tertiary"
            icon={<MoreHorizontal size={13} />}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </div>
    );
  };

  const dialogTitle = dialogTitleOf(dialog?.mode);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-layout-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--semi-color-border)',
          flexShrink: 0,
        }}
      >
        <Typography.Text strong size="small" style={{ flex: 1 }}>文件</Typography.Text>
        <Upload
          action=""
          showUploadList={false}
          customRequest={({ file, onSuccess, onError }) => {
            const fd = new FormData();
            fd.append('path', selectedDir || rootPath);
            const inst = (file as unknown as { fileInstance: File }).fileInstance;
            fd.append('file', inst);
            request
              .postForm<FileEntry>('/api/terminal-files/upload', fd)
              .then((res) => {
                if (res.code === 0) {
                  Toast.success('上传成功');
                  onSuccess?.(res.data ?? {});
                  refreshDir(selectedDir || rootPath);
                } else {
                  onError?.({ status: 0 });
                }
              })
              .catch(() => onError?.({ status: 0 }));
          }}
        >
          <Tooltip content={`上传到：${selectedDir || rootPath || '主目录'}`}>
            <Button size="small" theme="borderless" type="tertiary" icon={<UploadIcon size={14} />} />
          </Tooltip>
        </Upload>
        <Tooltip content="刷新">
          <Button
            size="small"
            theme="borderless"
            type="tertiary"
            icon={<RotateCcw size={14} />}
            loading={loading}
            onClick={() => void loadRoot()}
          />
        </Tooltip>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 0' }}>
        <Tree
          treeData={treeData}
          loadData={loadData}
          onSelect={handleSelect}
          renderLabel={renderLabel}
          value={selectedKey || undefined}
          onChange={(val) => setSelectedKey(typeof val === 'string' ? val : '')}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpandedKeys(keys.map(String))}
          expandAction="click"
          motion={false}
          emptyContent="暂无文件"
          style={{ width: '100%' }}
        />
      </div>

      {favorites.length > 0 && (
        <Collapse style={{ flexShrink: 0, borderTop: '1px solid var(--semi-color-border)' }}>
          <Collapse.Panel header={`收藏夹 (${favorites.length})`} itemKey="favorites">
            <div style={{ maxHeight: 160, overflow: 'auto' }}>
              {favorites.map((f) => (
                <div
                  key={f.path}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px' }}
                  title={f.path}
                >
                  <button
                    type="button"
                    onClick={() => void locateInTree(f.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flex: 1,
                      minWidth: 0,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: 'inherit',
                      font: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    <Star size={12} style={{ color: 'var(--semi-color-warning)', flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {f.name}
                    </span>
                  </button>
                  <Dropdown
                    trigger="click"
                    clickToHide
                    stopPropagation
                    position="bottomRight"
                    render={
                      <Dropdown.Menu>
                        <Dropdown.Item icon={<SquareTerminal size={14} />} onClick={() => onOpenTerminalAt(f.path)}>在终端打开</Dropdown.Item>
                        <Dropdown.Item type="danger" icon={<X size={14} />} onClick={() => toggleFavorite(f.path, f.name)}>移除收藏</Dropdown.Item>
                      </Dropdown.Menu>
                    }
                  >
                    <Button size="small" theme="borderless" type="tertiary" icon={<MoreHorizontal size={13} />} />
                  </Dropdown>
                </div>
              ))}
            </div>
          </Collapse.Panel>
        </Collapse>
      )}

      <div style={{ padding: '4px 8px', borderTop: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
        <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>
          {selectedDir || rootPath}
        </Typography.Text>
      </div>

      <Modal
        title={dialogTitle}
        visible={!!dialog}
        onCancel={() => setDialog(null)}
        onOk={() => void confirmDialog()}
        closeOnEsc
        width={400}
      >
        <Input
          value={dialog?.value ?? ''}
          onChange={(v) => setDialog((d) => (d ? { ...d, value: v } : d))}
          onEnterPress={() => void confirmDialog()}
          placeholder="请输入名称"
        />
      </Modal>
    </div>
  );
}
