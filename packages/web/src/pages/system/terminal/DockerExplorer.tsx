/**
 * DockerExplorer — 终端页面左侧 Docker 容器文件浏览器
 *
 * 功能：
 *  - 展示 Docker 容器列表（按 Compose 项目分组）
 *  - 懒加载容器内文件树
 *  - 点击文件 → onOpenFile(`docker://<id><path>`)
 *  - 容器操作：启动 / 停止 / 重启 / logs / stats / attach shell
 */
import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tree, Typography, Button, Toast, Spin, Dropdown, Modal, Space } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import {
  Activity,
  Box,
  File,
  Folder,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  Square,
  TerminalSquare,
} from 'lucide-react';
import { Icon } from '@iconify/react';
import { request } from '@/utils/request';
import { getFileIcon } from '@/utils/fileIcons';
import { fetchDockerDir, useDockerExplorerAction } from '@/hooks/queries/terminal-files';
import { useDockerContainers, useDockerFetchStats } from '@/hooks/queries/docker';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ContainerInfo {
  id: string;
  shortId?: string;
  names: string[];
  image: string;
  state: string;
  status?: string;
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
  container?: ContainerInfo;
}

interface DockerExplorerProps {
  readonly active: boolean;
  readonly onOpenFile: (filePath: string) => void;
  readonly onAttachShell: (shellId: string, title: string) => void;
}

type DockerShell = 'bash' | 'sh';

interface ContainerStats {
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
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

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatPercent(value: number): string {
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;
}

function containerName(container: ContainerInfo): string {
  return container.names[0] ?? container.shortId ?? container.id.slice(0, 12);
}

function makeContainerKey(id: string) { return `container:${id}`; }
function makeGroupKey(project: string) { return `group:${project}`; }
function makeDirKey(cid: string, path: string) { return `dir:${cid}:${path}`; }
function makeFileKey(cid: string, path: string) { return `file:${cid}:${path}`; }

function buildContainerNode(c: ContainerInfo): DockerTreeNode {
  const name = containerName(c);
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
    container: c,
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
  const queryClient = useQueryClient();
  const [treeData, setTreeData] = useState<DockerTreeNode[]>([]);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const containersQuery = useDockerContainers({ enabled: active, silent: true });
  const actionMutation = useDockerExplorerAction();
  const statsMutation = useDockerFetchStats();
  const [logsModal, setLogsModal] = useState<{
    visible: boolean;
    container: ContainerInfo | null;
    logs: string;
    loading: boolean;
    tail: number;
  }>({ visible: false, container: null, logs: '', loading: false, tail: 200 });
  const [statsModal, setStatsModal] = useState<{
    visible: boolean;
    container: ContainerInfo | null;
    stats: ContainerStats | null;
    loading: boolean;
  }>({ visible: false, container: null, stats: null, loading: false });

  const applyContainers = useCallback((containers: ContainerInfo[]) => {
    setDockerAvailable(true);

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
    if (containersQuery.isError) {
      setDockerAvailable(false);
      return;
    }
    if (containersQuery.data) applyContainers(containersQuery.data);
  }, [applyContainers, containersQuery.data, containersQuery.isError]);

  const runContainerAction = useCallback(async (
    container: ContainerInfo,
    action: 'start' | 'stop' | 'restart',
  ) => {
    const name = containerName(container);
    await actionMutation.mutateAsync({ id: container.id, action });
    const successText: Record<typeof action, string> = {
      start: '启动成功',
      stop: '停止成功',
      restart: '重启成功',
    };
    Toast.success({ content: `${name} ${successText[action]}`, duration: 2 });
  }, [actionMutation]);

  const confirmContainerAction = useCallback((container: ContainerInfo, action: 'stop' | 'restart') => {
    const name = containerName(container);
    Modal.confirm({
      title: action === 'stop' ? '停止容器' : '重启容器',
      content: `确定要${action === 'stop' ? '停止' : '重启'}容器「${name}」吗？`,
      okText: action === 'stop' ? '停止' : '重启',
      cancelText: '取消',
      okButtonProps: { type: action === 'stop' ? 'danger' : 'warning', theme: 'solid' },
      onOk: () => void runContainerAction(container, action),
    });
  }, [runContainerAction]);

  const fetchContainerLogs = useCallback(async (container: ContainerInfo, tail = 200) => {
    setLogsModal({ visible: true, container, logs: '', loading: true, tail });
    const res = await request.get<{ logs: string }>(`/api/docker/${container.id}/logs?tail=${tail}`);
    setLogsModal((prev) => (
      prev.container?.id === container.id
        ? { ...prev, logs: res.code === 0 && res.data ? res.data.logs : '', loading: false, tail }
        : prev
    ));
  }, []);

  const fetchContainerStats = useCallback(async (container: ContainerInfo) => {
    setStatsModal({ visible: true, container, stats: null, loading: true });
    try {
      const res = await statsMutation.mutateAsync(container.id);
      setStatsModal((prev) => (
        prev.container?.id === container.id
          ? { ...prev, stats: res as ContainerStats, loading: false }
          : prev
      ));
    } finally {
      setStatsModal((prev) => (prev.container?.id === container.id ? { ...prev, loading: false } : prev));
    }
  }, [statsMutation]);

  const loadData = useCallback(async (node: DockerTreeNode): Promise<void> => {
    const key = String(node.key ?? '');

    if (key.startsWith('container:')) {
      const containerId = key.slice('container:'.length);
      if (!containerId) return;
      try {
        const res = await fetchDockerDir(queryClient, containerId, '/', { silent: true });
        const children = buildFileNodes(res as FileEntry[], containerId);
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
        const res = await fetchDockerDir(queryClient, containerId, filePath, { silent: true });
        const children = buildFileNodes(res as FileEntry[], containerId);
        setTreeData((prev) => patchTreeChildren(prev, key, children));
      } catch {
        setTreeData((prev) => patchTreeChildren(prev, key, []));
      }
    }
  }, [queryClient]);

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

  const handleAttach = useCallback((containerId: string, name: string, shell: DockerShell) => {
    const shellPath = shell === 'bash' ? '/bin/bash' : '/bin/sh';
    onAttachShell(`docker-exec:${containerId}:${shell}`, `Docker ${name} ${shellPath}`);
    Toast.success({ content: `已连接到容器 ${name}`, duration: 2 });
  }, [onAttachShell]);

  const renderAttachMenu = useCallback((container: ContainerInfo) => {
    const name = containerName(container);
    return (
      <Dropdown.Menu>
        <Dropdown.Item
          icon={<TerminalSquare size={14} />}
          onClick={() => handleAttach(container.id, name, 'bash')}
        >
          Attach /bin/bash
        </Dropdown.Item>
        <Dropdown.Item
          icon={<TerminalSquare size={14} />}
          onClick={() => handleAttach(container.id, name, 'sh')}
        >
          Attach /bin/sh
        </Dropdown.Item>
      </Dropdown.Menu>
    );
  }, [handleAttach]);

  const renderContainerMenu = useCallback((container: ContainerInfo) => {
    const isRunning = container.state === 'running';
    const isStarting = actionMutation.isPending && actionMutation.variables?.id === container.id && actionMutation.variables.action === 'start';
    const isStopping = actionMutation.isPending && actionMutation.variables?.id === container.id && actionMutation.variables.action === 'stop';
    const isRestarting = actionMutation.isPending && actionMutation.variables?.id === container.id && actionMutation.variables.action === 'restart';
    return (
      <Dropdown.Menu>
        <Dropdown.Item
          icon={<ScrollText size={14} />}
          onClick={() => void fetchContainerLogs(container)}
        >
          Logs
        </Dropdown.Item>
        <Dropdown.Item
          icon={<Activity size={14} />}
          disabled={!isRunning}
          onClick={() => void fetchContainerStats(container)}
        >
          Stats
        </Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item
          icon={<Play size={14} />}
          disabled={isRunning || isStarting}
          onClick={() => void runContainerAction(container, 'start')}
        >
          启动
        </Dropdown.Item>
        <Dropdown.Item
          icon={<Square size={14} />}
          type="danger"
          disabled={!isRunning || isStopping}
          onClick={() => confirmContainerAction(container, 'stop')}
        >
          停止
        </Dropdown.Item>
        <Dropdown.Item
          icon={<RotateCw size={14} />}
          disabled={!isRunning || isRestarting}
          onClick={() => confirmContainerAction(container, 'restart')}
        >
          重启
        </Dropdown.Item>
      </Dropdown.Menu>
    );
  }, [actionMutation.isPending, actionMutation.variables, confirmContainerAction, fetchContainerLogs, fetchContainerStats, runContainerAction]);

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
      const container = data.container;
      return (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, width: '100%', minWidth: 0, paddingRight: 10, boxSizing: 'border-box' }}
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
          {container && isRunning && (
            <Dropdown trigger="click" clickToHide stopPropagation position="bottomRight" render={renderAttachMenu(container)}>
              <Button
                className="docker-tree-row-action"
                size="small"
                theme="borderless"
                type="tertiary"
                icon={<TerminalSquare size={13} style={{ color: 'var(--semi-color-primary)' }} />}
                onClick={(e) => e.stopPropagation()}
              />
            </Dropdown>
          )}
          {container && (
            <Dropdown trigger="click" clickToHide stopPropagation position="bottomRight" render={renderContainerMenu(container)}>
              <Button
                className="docker-tree-row-action"
                size="small"
                theme="borderless"
                type="tertiary"
                icon={<MoreHorizontal size={13} />}
                onClick={(e) => e.stopPropagation()}
              />
            </Dropdown>
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
  }, [renderAttachMenu, renderContainerMenu]);

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
          loading={containersQuery.isFetching}
          onClick={() => void containersQuery.refetch()}
        />
      </div>

      {/* 树 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
        {containersQuery.isFetching && treeData.length === 0
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
        {!containersQuery.isFetching && dockerAvailable && treeData.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <Typography.Text type="tertiary" size="small">未找到 Docker 容器</Typography.Text>
          </div>
        )}
      </div>

      {/* 底部 CSS：鼠标悬停显示 Attach 按钮 */}
      <style>{`
        .docker-tree-container-row:hover .docker-tree-row-action { opacity: 1 !important; }
        .docker-tree-row-action {
          width: 24px;
          height: 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
        }
        .docker-tree-row-action:hover,
        .docker-tree-row-action:focus-visible {
          opacity: 1 !important;
          background: var(--semi-color-fill-1);
          outline: none;
        }
        .docker-modal-code {
          margin: 0;
          padding: 12px;
          min-height: 320px;
          max-height: 520px;
          overflow: auto;
          border: 1px solid var(--semi-color-border);
          border-radius: 6px;
          background: var(--semi-color-fill-0);
          color: var(--semi-color-text-0);
          font-family: var(--semi-font-family-monospace), Consolas, monospace;
          font-size: 12px;
          line-height: 1.55;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .docker-stats-row {
          display: grid;
          grid-template-columns: 72px 1fr auto;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
        }
        .docker-stats-meter {
          height: 8px;
          border-radius: 999px;
          background: var(--semi-color-fill-0);
          overflow: hidden;
        }
        .docker-stats-meter__bar {
          height: 100%;
          border-radius: inherit;
          background: var(--semi-color-primary);
        }
      `}</style>

      <Modal
        visible={logsModal.visible}
        title={`Logs - ${logsModal.container ? containerName(logsModal.container) : ''}`}
        onCancel={() => setLogsModal((prev) => ({ ...prev, visible: false }))}
        footer={null}
        width={760}
        closeOnEsc
      >
        <Space style={{ marginBottom: 10 }}>
          <Button
            size="small"
            icon={<RefreshCw size={13} />}
            loading={logsModal.loading}
            disabled={!logsModal.container}
            onClick={() => logsModal.container && void fetchContainerLogs(logsModal.container, logsModal.tail)}
          >
            刷新
          </Button>
          <Button
            size="small"
            type={logsModal.tail === 200 ? 'primary' : 'tertiary'}
            onClick={() => logsModal.container && void fetchContainerLogs(logsModal.container, 200)}
          >
            200
          </Button>
          <Button
            size="small"
            type={logsModal.tail === 1000 ? 'primary' : 'tertiary'}
            onClick={() => logsModal.container && void fetchContainerLogs(logsModal.container, 1000)}
          >
            1000
          </Button>
        </Space>
        {logsModal.loading
          ? <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spin /></div>
          : <pre className="docker-modal-code">{logsModal.logs || '暂无日志'}</pre>}
      </Modal>

      <Modal
        visible={statsModal.visible}
        title={`Stats - ${statsModal.container ? containerName(statsModal.container) : ''}`}
        onCancel={() => setStatsModal((prev) => ({ ...prev, visible: false }))}
        footer={null}
        width={520}
        closeOnEsc
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <Button
            size="small"
            icon={<RefreshCw size={13} />}
            loading={statsModal.loading}
            disabled={!statsModal.container}
            onClick={() => statsModal.container && void fetchContainerStats(statsModal.container)}
          >
            刷新
          </Button>
        </div>
        {statsModal.loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spin /></div>
        ) : statsModal.stats ? (
          <div>
            <div className="docker-stats-row">
              <Typography.Text size="small" type="secondary">CPU</Typography.Text>
              <div className="docker-stats-meter">
                <div className="docker-stats-meter__bar" style={{ width: `${Math.min(statsModal.stats.cpuPercent, 100)}%` }} />
              </div>
              <Typography.Text size="small" strong>{formatPercent(statsModal.stats.cpuPercent)}</Typography.Text>
            </div>
            <div className="docker-stats-row">
              <Typography.Text size="small" type="secondary">内存</Typography.Text>
              <div className="docker-stats-meter">
                <div
                  className="docker-stats-meter__bar"
                  style={{
                    width: `${statsModal.stats.memLimit > 0
                      ? Math.min((statsModal.stats.memUsage / statsModal.stats.memLimit) * 100, 100)
                      : 0}%`,
                  }}
                />
              </div>
              <Typography.Text size="small" strong>
                {formatBytes(statsModal.stats.memUsage)} / {formatBytes(statsModal.stats.memLimit)}
              </Typography.Text>
            </div>
          </div>
        ) : (
          <Typography.Text type="tertiary" size="small">暂无资源占用数据</Typography.Text>
        )}
      </Modal>
    </div>
  );
}
