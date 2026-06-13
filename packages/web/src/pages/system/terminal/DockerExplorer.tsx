/**
 * DockerExplorer — 终端页面左侧 Docker 容器文件浏览器
 *
 * 功能：
 *  - 展示 Docker 容器列表（按 Compose 项目分组）
 *  - 懒加载容器内文件树
 *  - 点击文件 → onOpenFile(`docker://<id><path>`)
 *  - 点击「Attach Shell」→ onAttachShell(`docker-exec:<id>`, title)
 */
import { useState, useCallback, useEffect } from 'react';
import { Tree, Typography, Button, Toast, Tooltip, Spin } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { RefreshCw, TerminalSquare, Folder, File, Box } from 'lucide-react';
import { Icon } from '@iconify/react';
import { request } from '@/utils/request';
import { getFileIcon } from './fileIcons';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ContainerInfo {
  id: string;
  names: string[];
  image: string;
  state: string;
  composeProject: string | null;
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink';
}

interface DockerTreeNode extends TreeNodeData {
  nodeType: 'group' | 'container' | 'dir' | 'file';
  containerId?: string;
  filePath?: string;
  containerState?: string;
}

interface DockerExplorerProps {
  readonly active: boolean;
  readonly onOpenFile: (filePath: string) => void;
  readonly onAttachShell: (shellId: string, title: string) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const STATE_ICON: Record<string, string> = {
  running: '🟢',
  exited: '⬛',
  paused: '🟡',
  dead: '🔴',
};

function fileIcon(name: string, type: string): React.ReactNode {
  if (type === 'dir') return <Folder size={14} style={{ color: 'var(--semi-color-warning)', flexShrink: 0 }} />;
  const iconId = getFileIcon(name);
  if (iconId) return <Icon icon={iconId} width={14} height={14} style={{ flexShrink: 0 }} />;
  return <File size={14} style={{ color: 'var(--semi-color-text-3)', flexShrink: 0 }} />;
}

function makeContainerKey(id: string) { return `container:${id}`; }
function makeGroupKey(project: string) { return `group:${project}`; }
function makeDirKey(cid: string, path: string) { return `dir:${cid}:${path}`; }
function makeFileKey(cid: string, path: string) { return `file:${cid}:${path}`; }

function buildContainerNode(c: ContainerInfo): DockerTreeNode {
  const name = c.names[0] ?? c.id.slice(0, 12);
  const stateIcon = STATE_ICON[c.state] ?? '⬛';
  const canExpand = c.state === 'running';
  return {
    key: makeContainerKey(c.id),
    value: makeContainerKey(c.id),
    label: name,
    isLeaf: !canExpand,
    // no children yet — set undefined so loadData is triggered on expand
    children: canExpand ? undefined : [],
    nodeType: 'container',
    containerId: c.id,
    containerState: c.state,
    // custom render data
    _stateIcon: stateIcon,
    _image: c.image,
    _name: name,
  } as DockerTreeNode & { _stateIcon: string; _image: string; _name: string };
}

function buildFileNodes(entries: FileEntry[], containerId: string): DockerTreeNode[] {
  return entries
    .sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    })
    .map((e) => ({
      key: e.type === 'dir' ? makeDirKey(containerId, e.path) : makeFileKey(containerId, e.path),
      value: e.type === 'dir' ? makeDirKey(containerId, e.path) : makeFileKey(containerId, e.path),
      label: e.name,
      isLeaf: e.type !== 'dir',
      children: e.type === 'dir' ? undefined : [],
      nodeType: e.type === 'dir' ? 'dir' : 'file',
      containerId,
      filePath: e.path,
    } as DockerTreeNode));
}

/** 深度更新 treeData 中指定 key 节点的 children */
function patchTreeChildren(nodes: DockerTreeNode[], key: string, children: DockerTreeNode[]): DockerTreeNode[] {
  return nodes.map((n) => {
    if (n.key === key) return { ...n, children };
    if (n.children) return { ...n, children: patchTreeChildren(n.children as DockerTreeNode[], key, children) };
    return n;
  });
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function DockerExplorer({ active, onOpenFile, onAttachShell }: DockerExplorerProps) {
  const [treeData, setTreeData] = useState<DockerTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);

  const fetchContainers = useCallback(async () => {
    setLoading(true);
    const res = await request.get<ContainerInfo[]>('/api/docker', { silent: true });
    setLoading(false);
    if (res.code !== 0 || !res.data) {
      setDockerAvailable(false);
      return;
    }
    setDockerAvailable(true);
    const containers = res.data;

    // 按 Compose 项目分组
    const groups: Record<string, ContainerInfo[]> = {};
    const standalone: ContainerInfo[] = [];
    for (const c of containers) {
      if (c.composeProject) {
        if (!groups[c.composeProject]) groups[c.composeProject] = [];
        groups[c.composeProject].push(c);
      } else {
        standalone.push(c);
      }
    }

    const nodes: DockerTreeNode[] = [];

    for (const [project, members] of Object.entries(groups)) {
      nodes.push({
        key: makeGroupKey(project),
        value: makeGroupKey(project),
        label: project,
        isLeaf: false,
        nodeType: 'group',
        children: members.map(buildContainerNode),
      });
    }

    for (const c of standalone) {
      nodes.push(buildContainerNode(c));
    }

    setTreeData(nodes);
  }, []);

  useEffect(() => {
    if (active) void fetchContainers();
  }, [active, fetchContainers]);

  const loadData = useCallback(async (node: DockerTreeNode): Promise<void> => {
    const key = String(node.key ?? '');

    if (key.startsWith('container:')) {
      const containerId = key.slice('container:'.length);
      if (!containerId) return;
      try {
        const res = await request.get<FileEntry[]>(`/api/docker/${containerId}/files?path=/`, { silent: true });
        const children = res.code === 0 && res.data ? buildFileNodes(res.data, containerId) : [];
        setTreeData((prev) => patchTreeChildren(prev, key, children));
      } catch {
        setTreeData((prev) => patchTreeChildren(prev, key, []));
      }
    } else if (key.startsWith('dir:')) {
      // key: "dir:<containerId>:<filePath>" — path 本身不含冒号
      const withoutPrefix = key.slice('dir:'.length);
      const firstColon = withoutPrefix.indexOf(':');
      if (firstColon < 0) return;
      const containerId = withoutPrefix.slice(0, firstColon);
      const filePath = withoutPrefix.slice(firstColon + 1);
      if (!containerId || !filePath) return;
      try {
        const res = await request.get<FileEntry[]>(
          `/api/docker/${containerId}/files?path=${encodeURIComponent(filePath)}`,
          { silent: true },
        );
        const children = res.code === 0 && res.data ? buildFileNodes(res.data, containerId) : [];
        setTreeData((prev) => patchTreeChildren(prev, key, children));
      } catch {
        setTreeData((prev) => patchTreeChildren(prev, key, []));
      }
    }
  }, []);

  const handleSelect = useCallback((keys: unknown) => {
    const selectedKey = Array.isArray(keys) ? (keys[0] as string | undefined) : (typeof keys === 'string' ? keys : undefined);
    if (!selectedKey) return;
    if (selectedKey.startsWith('file:')) {
      const withoutPrefix = selectedKey.slice('file:'.length);
      const firstColon = withoutPrefix.indexOf(':');
      if (firstColon >= 0) {
        const containerId = withoutPrefix.slice(0, firstColon);
        const filePath = withoutPrefix.slice(firstColon + 1);
        if (containerId && filePath) {
          onOpenFile(`docker://${containerId}${filePath}`);
        }
      }
    }
  }, [onOpenFile]);

  const handleAttach = useCallback((e: React.MouseEvent, containerId: string, name: string) => {
    e.stopPropagation();
    onAttachShell(`docker-exec:${containerId}`, `🐋 ${name}`);
    Toast.success({ content: `已连接到容器 ${name}`, duration: 2 });
  }, [onAttachShell]);

  const renderLabel = useCallback((label: React.ReactNode, data: DockerTreeNode) => {
    if (data.nodeType === 'group') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <Box size={13} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />
          <Typography.Text strong size="small">{label}</Typography.Text>
        </span>
      );
    }

    if (data.nodeType === 'container') {
      const d = data as DockerTreeNode & { _stateIcon?: string; _image?: string; _name?: string };
      const isRunning = data.containerState === 'running';
      return (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, width: '100%', minWidth: 0 }}
          className="docker-tree-container-row"
        >
          <span style={{ flexShrink: 0 }}>{d._stateIcon ?? '⬛'}</span>
          <Typography.Text
            size="small"
            ellipsis={{ showTooltip: true }}
            style={{ flex: 1, minWidth: 0 }}
            type={isRunning ? undefined : 'tertiary'}
          >
            {label}
          </Typography.Text>
          {isRunning && (
            <Tooltip content="Attach Shell" position="right">
              <span
                role="button"
                tabIndex={0}
                className="docker-tree-attach-btn"
                style={{ cursor: 'pointer', opacity: 0, transition: 'opacity 0.15s', flexShrink: 0 }}
                onClick={(e) => handleAttach(e, data.containerId!, d._name ?? (label as string))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAttach(e as unknown as React.MouseEvent, data.containerId!, d._name ?? (label as string)); }}
              >
                <TerminalSquare size={13} style={{ color: 'var(--semi-color-primary)', verticalAlign: 'middle' }} />
              </span>
            </Tooltip>
          )}
        </span>
      );
    }

    if (data.nodeType === 'dir' || data.nodeType === 'file') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, minWidth: 0 }}>
          {fileIcon(label as string, data.nodeType)}
          <Typography.Text size="small" ellipsis={{ showTooltip: true }}>{label}</Typography.Text>
        </span>
      );
    }

    return label;
  }, [handleAttach]);

  if (dockerAvailable === false) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <Typography.Text type="tertiary" size="small">Docker 不可用或未运行</Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 8px', borderBottom: '1px solid var(--semi-color-border)', flexShrink: 0,
      }}>
        <Typography.Text size="small" strong type="secondary">DOCKER 容器</Typography.Text>
        <Button
          size="small" theme="borderless" type="tertiary"
          icon={<RefreshCw size={13} />}
          loading={loading}
          onClick={() => void fetchContainers()}
        />
      </div>

      {/* 树 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
        {loading && treeData.length === 0
          ? <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spin size="small" /></div>
          : (
            <Tree
              treeData={treeData as TreeNodeData[]}
              loadData={(node) => loadData(node as DockerTreeNode)}
              onSelect={(keys) => handleSelect(keys)}
              renderLabel={(label, node) => renderLabel(label, node as DockerTreeNode)}
              style={{ fontSize: 12 }}
              motion={false}
            />
          )
        }
        {!loading && dockerAvailable && treeData.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <Typography.Text type="tertiary" size="small">未找到 Docker 容器</Typography.Text>
          </div>
        )}
      </div>

      {/* 底部 CSS：鼠标悬停显示 Attach 按钮 */}
      <style>{`
        .docker-tree-container-row:hover .docker-tree-attach-btn { opacity: 1 !important; }
      `}</style>
    </div>
  );
}
