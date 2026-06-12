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
  Home,
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

interface RootInfo {
  home: string;
  isWindows: boolean;
  drives: string[];
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
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTargetDir, setDropTargetDir] = useState('');
  const [rootInfo, setRootInfo] = useState<RootInfo | null>(null);
  const loadedRef = useRef(false);
  const dragCounterRef = useRef(0);
  const dropTargetDirRef = useRef('');
  const treeContainerRef = useRef<HTMLElement | null>(null);
  const treeWrapperRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<{ scrollTo: (config: { key: string; align?: 'auto' | 'center' | 'start' | 'end' | 'smart' }) => void } | null>(null);
  const [treeHeight, setTreeHeight] = useState(0);

  // 动态计算 tree wrapper 高度，供虚拟化列表使用
  useEffect(() => {
    const el = treeWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h > 0) setTreeHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    // 第一步：获取根信息（home 目录、是否 Windows、盘符列表）
    const infoRes = await request.get<RootInfo>('/api/terminal-files/root-info');
    if (infoRes.code !== 0 || !infoRes.data) { setLoading(false); return; }
    const info = infoRes.data;
    setRootInfo(info);

    // 确定树根：Unix = "/"，Windows = 主目录所在盘符根（如 C:\\)
    let treeRoot: string;
    if (info.isWindows) {
      const driveMatch = /^([A-Za-z]:)/.exec(info.home);
      treeRoot = driveMatch ? driveMatch[1] + '\\' : (info.drives[0] ?? 'C:') + '\\';
    } else {
      treeRoot = '/';
    }

    const res = await request.get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(treeRoot)}`);
    setLoading(false);
    if (res.code === 0 && res.data) {
      setRootPath(res.data.path);
      setSelectedDir(res.data.path);
      setTreeData(res.data.entries.map(entryToNode));
      setExpandedKeys([]);
      setSelectedKey('');
      // 定位到 home 目录，传入当前根路径避免依赖 state
      void locateInTree(info.home, res.data.path);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 加载指定目录为新根（Windows 切换盘符时使用） */
  const loadDir = useCallback(async (dir: string) => {
    setLoading(true);
    const res = await request.get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(dir)}`);
    setLoading(false);
    if (res.code === 0 && res.data) {
      setRootPath(res.data.path);
      setSelectedDir(res.data.path);
      setTreeData(res.data.entries.map(entryToNode));
      setExpandedKeys([]);
      setSelectedKey('');
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

  // 在文件树中逐级展开并定位到指定目录，支持传入显式根路径（首次加载时 rootPath state 可能尚未更新）
  const locateInTree = useCallback(
    async (target: string, explicitRoot?: string) => {
      const root = explicitRoot ?? rootPath;
      if (!root) {
        Toast.warning('文件树尚未加载，请稍候再试');
        return;
      }
      const inRoot = target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`);
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

      // 逐级加载祖先目录内容，汇总所有结果后一次性更新 treeData（避免分批更新导致嵌套节点找不到的问题）
      if (ancestors.length > 0) {
        const results: { dir: string; entries: FileNode[] }[] = [];
        for (const dir of ancestors) {
          const res = await request.get<DirListing>(
            `/api/terminal-files/list?path=${encodeURIComponent(dir)}`,
            { silent: true },
          );
          if (res.code === 0 && res.data) {
            results.push({ dir, entries: res.data.entries.map(entryToNode) });
          }
        }
        if (results.length > 0) {
          setTreeData((prev) => {
            let tree = prev;
            for (const { dir, entries } of results) {
              tree = setChildren(tree, dir, entries);
            }
            return tree;
          });
        }
      }

      setExpandedKeys((prev) => Array.from(new Set([...prev, ...ancestors])));
      setSelectedKey(target);

      // 等待 React 重新渲染后滚动到选中节点
      setTimeout(() => {
        // 虚拟化树使用组件自身的 scrollTo 方法（比 DOM querySelector 更可靠）
        treeRef.current?.scrollTo({ key: target, align: 'auto' });
      }, 150);
    },
    [rootPath],
  );

  const isFavorite = (path: string) => favorites.some((f) => f.path === path);

  // ---------- 拖拽上传 ----------

  /** 检查 dataTransfer 是否包含 OS 文件（区分与内部节点拖拽） */
  const isFilesDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const handleDragEnter = (e: React.DragEvent<HTMLElement>) => {
    if (!isFilesDrag(e)) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
      dropTargetDirRef.current = '';
      setDropTargetDir('');
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (!isFilesDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // 事件委托：通过当前悬停的 DOM 元素上的 data-node-path 属性确定目标目录
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-node-path]');
    const dir = el?.dataset.nodePath ?? '';
    if (dir !== dropTargetDirRef.current) {
      dropTargetDirRef.current = dir;
      setDropTargetDir(dir);
    }
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLElement>) => {
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const finalTarget = dropTargetDirRef.current;
      dropTargetDirRef.current = '';
      setDropTargetDir('');
      if (!isFilesDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const { files } = e.dataTransfer;
      if (!files.length) return;

      const targetDir = finalTarget || selectedDir || rootPath;
      const uploads = Array.from(files).map((file) => {
        const fd = new FormData();
        fd.append('path', targetDir);
        fd.append('file', file);
        return request.postForm<FileEntry>('/api/terminal-files/upload', fd, { silent: true });
      });
      const results = await Promise.all(uploads);
      const success = results.filter((r) => r.code === 0).length;
      const fail = results.length - success;
      if (success > 0) {
        const failNote = fail > 0 ? `，${fail} 个失败` : '';
        Toast.success(`已上传 ${success} 个文件${failNote}`);
        refreshDir(targetDir);
      } else {
        Toast.error('上传失败');
      }
    },
    [selectedDir, rootPath, refreshDir],
  );

  // -----------------------------------

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
    const isDropTarget = isDragOver && dropTargetDir === node.value;
    return (
      <div
        data-node-path={node.fileType === 'dir' ? node.value : parentOf(node.value)}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          gap: 4,
          ...(isDropTarget ? {
            background: 'var(--semi-color-primary-light-default)',
            borderRadius: 4,
            outline: '2px solid var(--semi-color-primary)',
            outlineOffset: '-1px',
          } : {}),
        }}
      >
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
        {/* 定位到 Home 目录 */}
        {rootInfo?.home && (
          <Tooltip content="定位到主目录">
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              icon={<Home size={14} />}
              onClick={() => void locateInTree(rootInfo.home)}
            />
          </Tooltip>
        )}
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

      {/* Windows 多盘符切换行（仅 Windows 且有多个盘符时显示） */}
      {rootInfo?.isWindows && rootInfo.drives.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 8px', borderBottom: '1px solid var(--semi-color-border)', flexShrink: 0, flexWrap: 'wrap' }}>
          {rootInfo.drives.map((drive) => {
            const isActive = rootPath.toUpperCase().startsWith(drive.toUpperCase());
            return (
              <Button
                key={drive}
                size="small"
                theme={isActive ? 'solid' : 'borderless'}
                type={isActive ? 'primary' : 'tertiary'}
                style={{ minWidth: 36, padding: '0 6px' }}
                onClick={() => void loadDir(drive + '\\')}
              >
                {drive}
              </Button>
            );
          })}
        </div>
      )}

      <section
        ref={treeContainerRef}
        aria-label="文件树（支持从本地拖入文件上传）"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          outline: isDragOver ? '2px dashed var(--semi-color-primary)' : undefined,
          outlineOffset: isDragOver ? '-2px' : undefined,
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={(e) => void handleDrop(e)}
      >
        {isDragOver && (
          <div
            style={{
              flexShrink: 0,
              background: 'var(--semi-color-primary-light-default)',
              borderBottom: '1px solid var(--semi-color-primary)',
              padding: '3px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: 'var(--semi-color-primary)',
              pointerEvents: 'none',
            }}
          >
            <UploadIcon size={13} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              上传到：{dropTargetDir || selectedDir || rootPath || '主目录'}
            </span>
          </div>
        )}
        <div ref={treeWrapperRef} style={{ flex: 1, minHeight: 0 }}>
          {treeHeight > 0 && (
          <Tree
            ref={treeRef as never}
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
            virtualize={{ height: treeHeight, width: '100%', itemSize: 32 }}
            style={{ width: '100%' }}
          />
          )}
        </div>
      </section>

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

      {/* 当前选中目录（用于上传/操作的目标提示） */}
      {selectedDir && selectedDir !== rootPath && (
        <div style={{ padding: '3px 8px', borderTop: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
          <Typography.Text size="small" type="quaternary" ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>
            选中：{selectedDir}
          </Typography.Text>
        </div>
      )}

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
