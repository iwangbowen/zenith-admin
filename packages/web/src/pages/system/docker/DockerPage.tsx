
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Button,
  Tag,
  Toast,
  SideSheet,
  Typography,
  Tooltip,
  Dropdown,
  Progress,
  Modal,
  Empty,
  Form,
  Input,
  Tabs,
  TabPane,
  Select,
  Switch,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import {
  FileText,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Activity,
  Search,
  Info,
  Plus,
  Download,
  Trash2,
} from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { formatDateTime } from '@/utils/date';
import AppModal from '@/components/AppModal';
import {
  useDockerAvailable,
  useDockerContainerAction,
  useDockerContainers,
  useDockerCreateNetwork,
  useDockerCreateVolume,
  useDockerFetchStats,
  useDockerImages,
  useDockerInspect,
  useDockerNetworks,
  useDockerPrune,
  useDockerPullImage,
  useDockerRemoveImage,
  useDockerRemoveNetwork,
  useDockerRemoveVolume,
  useDockerVolumes,
  type ContainerInfo,
  type ImageInfo,
  type NetworkInfo,
  type PortBinding,
  type PruneResultData,
  type StatsInfo,
  type VolumeInfo,
} from '@/hooks/queries/docker';

// ─── Prune（清理）辅助 ──────────────────────────────────────────────────────────
function runPrune(url: string, title: string, content: string, prune: (url: string) => Promise<PruneResultData>): void {
  Modal.confirm({
    title,
    content,
    okText: '确定清理',
    cancelText: '取消',
    onOk: async () => {
      const d = await prune(url);
      const parts: string[] = [];
      if (d.containersDeleted) parts.push(`容器 ${d.containersDeleted}`);
      if (d.imagesDeleted) parts.push(`镜像 ${d.imagesDeleted}`);
      if (d.networksDeleted) parts.push(`网络 ${d.networksDeleted}`);
      if (d.volumesDeleted) parts.push(`卷 ${d.volumesDeleted}`);
      const space = d.spaceReclaimed ? `，释放 ${(d.spaceReclaimed / 1024 / 1024).toFixed(1)} MB` : '';
      Toast.success(`${title}完成：${parts.length ? parts.join('、') : '无可清理项'}${space}`);
    },
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImageRow {
  id: string; name: string; isGroup: boolean; repoTags: string[];
  size: number; created: number; containers: number; shortId: string;
  versionCount?: number; children?: ImageRow[];
}

const EMPTY_CONTAINERS: ContainerInfo[] = [];
const EMPTY_IMAGES: ImageInfo[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATE_COLOR: Record<string, 'green' | 'grey' | 'orange' | 'blue' | 'red'> = {
  running: 'green', exited: 'grey', paused: 'orange', created: 'blue', dead: 'red',
};

function formatPorts(ports: PortBinding[]): string {
  const b = ports.filter((p) => p.publicPort).map((p) => `${p.publicPort}→${p.privatePort}/${p.type}`).join(', ');
  return b || '—';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function groupByCompose(containers: ContainerInfo[]): (ContainerInfo & { children?: ContainerInfo[] })[] {
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
  const result: (ContainerInfo & { children?: ContainerInfo[] })[] = [];
  for (const [project, members] of Object.entries(groups)) {
    const runningCount = members.filter((m) => m.state === 'running').length;
    let parentState: string;
    if (runningCount === members.length) parentState = 'running';
    else if (runningCount > 0) parentState = 'paused';
    else parentState = 'exited';
    result.push({
      id: `__compose__${project}`, shortId: '', names: [`📦 ${project}`],
      image: `${members.length} 个服务`, imageId: '', command: '',
      created: Math.max(...members.map((m) => m.created)),
      state: parentState, status: `${runningCount}/${members.length} 运行中`,
      ports: members.flatMap((m) => m.ports),
      composeProject: project, composeService: null, children: members,
    });
  }
  return [...result, ...standalone];
}

// ─── Containers Tab ───────────────────────────────────────────────────────────

function ContainersTab() {
  const [keyword, setKeyword] = useState('');
  const [logsContainer, setLogsContainer] = useState<ContainerInfo | null>(null);
  const [logs, setLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [statsContainer, setStatsContainer] = useState<ContainerInfo | null>(null);
  const [stats, setStats] = useState<StatsInfo | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<ContainerInfo | null>(null);
  const [inspectData, setInspectData] = useState('');
  const [inspectLoading, setInspectLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [logsFollowing, setLogsFollowing] = useState(true);
  const logsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsPreRef = useRef<HTMLPreElement>(null);

  const containersQuery = useDockerContainers();
  const containers = containersQuery.data ?? EMPTY_CONTAINERS;
  const actionMutation = useDockerContainerAction();
  const pruneMutation = useDockerPrune();
  const statsMutation = useDockerFetchStats();
  const inspectMutation = useDockerInspect();

  // 新增 Compose 分组时自动展开，已有分组保持状态
  useEffect(() => {
    const groupIds = [...new Set(containers
      .filter(c => c.composeProject)
      .map(c => `__compose__${c.composeProject}`))];
    setExpandedKeys(prev => {
      const newIds = groupIds.filter(id => !prev.includes(id));
      return newIds.length > 0 ? [...prev, ...newIds] : prev;
    });
  }, [containers]);

  // 追踪模式下自动滚到底部
  useEffect(() => {
    if (logsFollowing && logsPreRef.current) {
      logsPreRef.current.scrollTop = logsPreRef.current.scrollHeight;
    }
  }, [logs, logsFollowing]);

  // 卸载时清理轮询定时器
  useEffect(() => () => { if (logsIntervalRef.current) clearInterval(logsIntervalRef.current); }, []);

  const handleAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    await actionMutation.mutateAsync({ id, action });
    const msgMap = { start: '已启动', stop: '已停止', restart: '已重启' } as const;
    Toast.success({ content: msgMap[action], duration: 2 });
  };

  const openLogs = async (c: ContainerInfo) => {
    if (logsIntervalRef.current) { clearInterval(logsIntervalRef.current); logsIntervalRef.current = null; }
    setLogsContainer(c); setLogsLoading(true); setLogs(''); setLogsFollowing(true);
    const fetchOnce = async () => {
      const res = await request.get<{ logs: string }>(`/api/docker/${c.id}/logs?tail=500`);
      if (res.code === 0 && res.data) { setLogs(res.data.logs); setLogsLoading(false); }
    };
    await fetchOnce();
    logsIntervalRef.current = setInterval(() => void fetchOnce(), 2000);
  };

  const closeLogs = () => {
    if (logsIntervalRef.current) { clearInterval(logsIntervalRef.current); logsIntervalRef.current = null; }
    setLogsContainer(null); setLogs('');
  };

  const toggleLogsFollow = () => {
    setLogsFollowing(prev => {
      const next = !prev;
      if (!next) {
        if (logsIntervalRef.current) { clearInterval(logsIntervalRef.current); logsIntervalRef.current = null; }
      } else if (logsContainer) {
        const fetchOnce = async () => {
          const res = await request.get<{ logs: string }>(`/api/docker/${logsContainer.id}/logs?tail=500`);
          if (res.code === 0 && res.data) setLogs(res.data.logs);
        };
        void fetchOnce();
        logsIntervalRef.current = setInterval(() => void fetchOnce(), 2000);
      }
      return next;
    });
  };

  const openStats = async (c: ContainerInfo) => {
    setStatsContainer(c); setStatsLoading(true); setStats(null);
    try {
      const res = await statsMutation.mutateAsync(c.id);
      setStats(res);
    } finally {
      setStatsLoading(false);
    }
  };

  const openInspect = async (c: ContainerInfo) => {
    setInspectTarget(c); setInspectLoading(true); setInspectData('');
    try {
      const res = await inspectMutation.mutateAsync(c.id);
      setInspectData(JSON.stringify(res, null, 2));
    } finally {
      setInspectLoading(false);
    }
  };

  const isGroup = (r: ContainerInfo) => r.id.startsWith('__compose__');

  const allGroupIds = useMemo(
    () => [...new Set(containers.filter(c => c.composeProject).map(c => `__compose__${c.composeProject}`))],
    [containers]);
  const allExpanded = allGroupIds.length > 0 && allGroupIds.every(id => expandedKeys.includes(id));
  const toggleExpandAll = () => setExpandedKeys(allExpanded ? [] : allGroupIds);

  const filtered = keyword
    ? groupByCompose(containers.filter((c) =>
        c.names.join(',').toLowerCase().includes(keyword.toLowerCase()) ||
        c.image.toLowerCase().includes(keyword.toLowerCase()) ||
        (c.composeProject ?? '').toLowerCase().includes(keyword.toLowerCase()),
      ))
    : groupByCompose(containers);

  const columns: ColumnProps<ContainerInfo>[] = [
    {
      title: '容器名 / 服务',
      render: (_: unknown, r: ContainerInfo) => {
        const name = r.names[0] ?? r.shortId;
        if (isGroup(r)) return <Typography.Text strong>{name}</Typography.Text>;
        return (
          <div>
            <Typography.Text size="small">{name}</Typography.Text>
            {r.composeService && <Tag size="small" color="purple" style={{ marginLeft: 6 }}>{r.composeService}</Tag>}
          </div>
        );
      },
    },
    {
      title: '镜像', dataIndex: 'image', width: 220,
      render: (v: string, r: ContainerInfo) => {
        if (isGroup(r)) return <Typography.Text type="tertiary" size="small">{v}</Typography.Text>;
        return <Tooltip content={v}><Tag size="small" color="blue">{v.length > 30 ? `${v.slice(0, 30)}…` : v}</Tag></Tooltip>;
      },
    },
    {
      title: '状态', dataIndex: 'state', width: 140,
      render: (v: string, r: ContainerInfo) => (
        <Tooltip content={r.status}>
          <Tag size="small" color={STATE_COLOR[v] ?? 'grey'}>{r.status}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '端口映射', width: 200,
      render: (_: unknown, r: ContainerInfo) => {
        if (isGroup(r)) return null;
        return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{formatPorts(r.ports)}</span>;
      },
    },
    {
      title: '创建时间', dataIndex: 'created', width: 180,
      render: (v: number, r: ContainerInfo) => {
        if (isGroup(r)) return null;
        return formatDateTime(new Date(v * 1000));
      },
    },
    createOperationColumn<ContainerInfo>({
      width: 180,
      desktopInlineKeys: ['toggle', 'logs'],
      actions: (record) => {
        if (isGroup(record)) return [];
        const isRunning = record.state === 'running';
        const busy = actionMutation.isPending && actionMutation.variables?.id === record.id;
        return [
          {
            key: 'toggle',
            label: isRunning ? '停止' : '启动',
            danger: isRunning,
            loading: busy,
            onClick: () => {
              if (!isRunning) {
                void handleAction(record.id, 'start');
                return;
              }
              Modal.confirm({
                title: `确定停止 ${record.names[0] ?? record.shortId}？`,
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => { void handleAction(record.id, 'stop'); },
              });
            },
          },
          {
            key: 'logs',
            label: '日志',
            onClick: () => { void openLogs(record); },
          },
          {
            key: 'restart',
            label: '重启',
            onClick: () => { void handleAction(record.id, 'restart'); },
          },
          {
            key: 'stats',
            label: '资源占用',
            onClick: () => { void openStats(record); },
          },
          {
            key: 'inspect',
            label: '检查详情',
            onClick: () => { void openInspect(record); },
          },
        ];
      },
    }),
  ];

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索容器名 / 镜像 / Compose 项目" showClear value={keyword} onChange={setKeyword} style={{ width: 280 }} />
            <Button type="primary" icon={<RefreshCw size={14} />} onClick={() => void containersQuery.refetch()}>刷新</Button>
          </>
        )}
        actions={(
          <>
            {allGroupIds.length > 0 && (
              <Button type="primary" icon={allExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={toggleExpandAll}>
                {allExpanded ? '全部折叠' : '全部展开'}
              </Button>
            )}
            <Dropdown trigger="click" clickToHide position="bottomRight" render={(
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => runPrune('/api/docker/prune/containers', '清理停止容器', '将删除所有已停止的容器，确定继续？', pruneMutation.mutateAsync)}>清理已停止容器</Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item type="danger" onClick={() => runPrune('/api/docker/prune/system', '系统清理', '将清理：已停止容器 + 悬空镜像 + 未使用网络（不含数据卷），确定继续？', pruneMutation.mutateAsync)}>系统清理</Dropdown.Item>
              </Dropdown.Menu>
            )}>
              <Button icon={<Trash2 size={14} />}>清理</Button>
            </Dropdown>
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索容器名 / 镜像 / Compose 项目" showClear value={keyword} onChange={setKeyword} style={{ width: 280 }} />
            <Button type="primary" icon={<RefreshCw size={14} />} onClick={() => void containersQuery.refetch()}>刷新</Button>
          </>
        )}
        mobileActions={(
          <>
            {allGroupIds.length > 0 && (
              <Button type="primary" icon={allExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={toggleExpandAll}>
                {allExpanded ? '全部折叠' : '全部展开'}
              </Button>
            )}
            <Button icon={<Trash2 size={14} />} onClick={() => runPrune('/api/docker/prune/containers', '清理停止容器', '将删除所有已停止的容器，确定继续？', pruneMutation.mutateAsync)}>清理已停止容器</Button>
            <Button type="danger" icon={<Trash2 size={14} />} onClick={() => runPrune('/api/docker/prune/system', '系统清理', '将清理：已停止容器 + 悬空镜像 + 未使用网络（不含数据卷），确定继续？', pruneMutation.mutateAsync)}>系统清理</Button>
          </>
        )}
        actionTitle="容器操作"
      />
      <ConfigurableTable bordered rowKey="id" dataSource={filtered} columns={columns} loading={containersQuery.isFetching}
        onRefresh={() => void containersQuery.refetch()} refreshLoading={containersQuery.isFetching}
        empty="未检测到 Docker 容器" pagination={false}
        expandedRowKeys={expandedKeys}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onExpand={(expanded: boolean | undefined, record: any) =>
          setExpandedKeys(prev => {
            const id = record?.id as string | undefined;
            if (!id) return prev;
            return expanded ? [...prev, id] : prev.filter(k => k !== id);
          })
        }
      />

      <SideSheet
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span><FileText size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />容器日志：{logsContainer?.names[0] ?? ''}</span>
            <Button size="small" type={logsFollowing ? 'primary' : 'tertiary'} onClick={toggleLogsFollow} style={{ marginRight: 32 }}>
              {logsFollowing ? '⏸ 暂停追踪' : '▶ 继续追踪'}
            </Button>
          </div>
        }
        visible={!!logsContainer} onCancel={closeLogs} width={680} placement="right"
      >
        {logsLoading
          ? <div style={{ textAlign: 'center', padding: 40 }}><Typography.Text type="tertiary">加载中...</Typography.Text></div>
          : <pre ref={logsPreRef} style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 6, height: 'calc(100vh - 120px)', overflow: 'auto', margin: 0 }}>{logs || '（暂无日志）'}</pre>
        }
      </SideSheet>

      <Modal title={<span><Activity size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />资源占用：{statsContainer?.names[0] ?? ''}</span>}
        visible={!!statsContainer} onCancel={() => { setStatsContainer(null); setStats(null); }} footer={null} width={440}>
        {statsLoading && <div style={{ textAlign: 'center', padding: 32 }}><Typography.Text type="tertiary">正在获取...</Typography.Text></div>}
        {!statsLoading && stats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '8px 0' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <Typography.Text strong>CPU 使用率</Typography.Text>
                <Typography.Text>{stats.cpuPercent.toFixed(2)}%</Typography.Text>
              </div>
              <Progress percent={Math.min(stats.cpuPercent, 100)} showInfo={false} stroke={stats.cpuPercent > 80 ? 'var(--semi-color-danger)' : undefined} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <Typography.Text strong>内存使用</Typography.Text>
                <Typography.Text>
                  {formatBytes(stats.memUsage)} / {formatBytes(stats.memLimit)}
                  <Typography.Text type="tertiary" size="small" style={{ marginLeft: 6 }}>
                    ({stats.memLimit > 0 ? ((stats.memUsage / stats.memLimit) * 100).toFixed(1) : 0}%)
                  </Typography.Text>
                </Typography.Text>
              </div>
              <Progress percent={stats.memLimit > 0 ? (stats.memUsage / stats.memLimit) * 100 : 0} showInfo={false}
                stroke={stats.memLimit > 0 && stats.memUsage / stats.memLimit > 0.8 ? 'var(--semi-color-danger)' : undefined} />
            </div>
          </div>
        )}
        {!statsLoading && !stats && <Typography.Text type="tertiary">获取失败</Typography.Text>}
      </Modal>

      <Modal title={<span><Info size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />检查详情：{inspectTarget?.names[0] ?? ''}</span>}
        visible={!!inspectTarget} onCancel={() => { setInspectTarget(null); setInspectData(''); }} footer={null} width={780} style={{ top: 40 }} bodyStyle={{ padding: 0 }}>
        {inspectLoading
          ? <div style={{ textAlign: 'center', padding: 40 }}><Typography.Text type="tertiary">加载中...</Typography.Text></div>
          : <pre style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--semi-color-fill-0)', padding: 16, margin: 0, maxHeight: 'calc(100vh - 200px)', overflow: 'auto', borderRadius: '0 0 6px 6px' }}>{inspectData || '（暂无数据）'}</pre>
        }
      </Modal>
    </>
  );
}

// ─── Images Tab ───────────────────────────────────────────────────────────────

function buildImageTree(images: ImageInfo[], keyword: string): ImageRow[] {
  const groups: Record<string, ImageRow[]> = {};
  for (const img of images) {
    const validTags = img.repoTags.filter((t) => t !== '<none>:<none>');
    let repoName = '<untagged>';
    if (validTags.length > 0) {
      const first = validTags[0];
      const colon = first.lastIndexOf(':');
      repoName = colon !== -1 ? first.slice(0, colon) : first;
    }
    if (!groups[repoName]) groups[repoName] = [];
    groups[repoName].push({
      id: img.id,
      name: validTags.length > 0 ? validTags.join(', ') : '<none>',
      isGroup: false, repoTags: img.repoTags,
      size: img.size, created: img.created, containers: img.containers, shortId: img.shortId,
    });
  }
  const kw = keyword.toLowerCase();
  const rows: ImageRow[] = [];
  for (const [repo, children] of Object.entries(groups)) {
    const matched = kw
      ? children.filter(
          (c) => repo.toLowerCase().includes(kw) ||
            c.repoTags.some((t) => t.toLowerCase().includes(kw)) ||
            c.shortId.includes(kw),
        )
      : children;
    if (matched.length === 0) continue;
    rows.push({
      id: `__img__${repo}`,
      name: repo, isGroup: true, repoTags: [],
      size: matched.reduce((s, c) => s + c.size, 0),
      created: Math.max(...matched.map((c) => c.created)),
      containers: matched.reduce((s, c) => s + c.containers, 0),
      shortId: '', versionCount: matched.length,
      children: matched,
    });
  }
  return rows.sort((a, b) => {
    if (a.name === '<untagged>') return 1;
    if (b.name === '<untagged>') return -1;
    return a.name.localeCompare(b.name);
  });
}

function ImagesTab() {
  const [keyword, setKeyword] = useState('');
  const [pullVisible, setPullVisible] = useState(false);
  const [pullTag, setPullTag] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const imagesQuery = useDockerImages();
  const images = imagesQuery.data ?? EMPTY_IMAGES;
  const removeImageMutation = useDockerRemoveImage();
  const pullImageMutation = useDockerPullImage();
  const pruneMutation = useDockerPrune();

  // Auto-expand all groups when images load
  useEffect(() => {
    const groupIds = [...new Set(images.map((img) => {
      const validTags = img.repoTags.filter((t) => t !== '<none>:<none>');
      if (validTags.length === 0) return '__img__<untagged>';
      const first = validTags[0];
      const colon = first.lastIndexOf(':');
      return `__img__${colon !== -1 ? first.slice(0, colon) : first}`;
    }))];
    setExpandedKeys((prev) => {
      const newIds = groupIds.filter((id) => !prev.includes(id));
      return newIds.length > 0 ? [...prev, ...newIds] : prev;
    });
  }, [images]);

  const handleRemove = async (id: string) => {
    await removeImageMutation.mutateAsync(id);
    Toast.success({ content: '已删除', duration: 2 });
  };

  const handlePull = async () => {
    if (!pullTag.trim()) return;
    await pullImageMutation.mutateAsync(pullTag.trim());
    Toast.success({ content: `镜像 ${pullTag} 拉取成功`, duration: 3 });
    setPullVisible(false); setPullTag('');
  };

  const treeData = useMemo(() => buildImageTree(images, keyword), [images, keyword]);

  const allGroupIds = useMemo(() => treeData.map((r) => r.id), [treeData]);
  const allExpanded = allGroupIds.length > 0 && allGroupIds.every((id) => expandedKeys.includes(id));
  const toggleExpandAll = () => setExpandedKeys(allExpanded ? [] : allGroupIds);

  const columns: ColumnProps<ImageRow>[] = [
    {
      title: '仓库 / 标签',
      render: (_: unknown, r: ImageRow) => {
        if (r.isGroup) {
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Typography.Text strong>{r.name}</Typography.Text>
              <Tag size="small" color="purple">{r.versionCount} 个版本</Tag>
            </span>
          );
        }
        const validTags = r.repoTags.filter((t) => t !== '<none>:<none>');
        if (validTags.length === 0) return <Tag size="small" color="grey">&lt;none&gt;</Tag>;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {validTags.map((t) => {
              const colon = t.lastIndexOf(':');
              const tag = colon !== -1 ? t.slice(colon) : t;
              return <Tag key={t} size="small" color="blue">{tag}</Tag>;
            })}
          </div>
        );
      },
    },
    {
      title: '镜像 ID', width: 140,
      render: (_: unknown, r: ImageRow) => {
        if (r.isGroup) return null;
        return <code style={{ fontSize: 12 }}>{r.shortId}</code>;
      },
    },
    {
      title: '大小', dataIndex: 'size', width: 110,
      sorter: (a?: ImageRow, b?: ImageRow) => (a?.size ?? 0) - (b?.size ?? 0),
      render: (v: number, r: ImageRow) => (
        r.isGroup
          ? <Typography.Text type="tertiary" size="small">{formatBytes(v)}</Typography.Text>
          : formatBytes(v)
      ),
    },
    {
      title: '容器数', dataIndex: 'containers', width: 90,
      render: (v: number) => <Tag size="small" color={v > 0 ? 'green' : 'grey'}>{v}</Tag>,
    },
    {
      title: '创建时间', dataIndex: 'created', width: 180,
      render: (v: number, r: ImageRow) => (
        r.isGroup
          ? <Typography.Text type="tertiary" size="small">{formatDateTime(new Date(v * 1000))}</Typography.Text>
          : formatDateTime(new Date(v * 1000))
      ),
    },
    createOperationColumn<ImageRow>({
      width: 100,
      actions: (record) => [
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: record.isGroup,
          onClick: () => {
            Modal.confirm({
              title: '确定删除此镜像？运行中的容器使用的镜像无法删除。',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleRemove(record.id); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索镜像名 / 标签 / ID" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
            <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void imagesQuery.refetch()}>刷新</Button>
            <Button type="primary" icon={<Download size={14} />} onClick={() => setPullVisible(true)}>拉取镜像</Button>
          </>
        )}
        actions={(
          <>
            {allGroupIds.length > 0 && (
              <Button type="tertiary"
                icon={allExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                onClick={toggleExpandAll}
              >
                {allExpanded ? '全部折叠' : '全部展开'}
              </Button>
            )}
            <Dropdown trigger="click" clickToHide position="bottomRight" render={(
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => runPrune('/api/docker/prune/images', '清理悬空镜像', '将删除所有悬空（dangling）镜像，确定继续？', pruneMutation.mutateAsync)}>清理悬空镜像</Dropdown.Item>
                <Dropdown.Item type="danger" onClick={() => runPrune('/api/docker/prune/images?all=true', '清理所有未用镜像', '将删除所有未被容器使用的镜像，确定继续？', pruneMutation.mutateAsync)}>清理所有未用镜像</Dropdown.Item>
              </Dropdown.Menu>
            )}>
              <Button icon={<Trash2 size={14} />}>清理</Button>
            </Dropdown>
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索镜像名 / 标签 / ID" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
            <Button type="primary" icon={<Download size={14} />} onClick={() => setPullVisible(true)}>拉取镜像</Button>
          </>
        )}
        mobileActions={(
          <>
            <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void imagesQuery.refetch()}>刷新</Button>
            {allGroupIds.length > 0 && (
              <Button type="tertiary"
                icon={allExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                onClick={toggleExpandAll}
              >
                {allExpanded ? '全部折叠' : '全部展开'}
              </Button>
            )}
            <Button icon={<Trash2 size={14} />} onClick={() => runPrune('/api/docker/prune/images', '清理悬空镜像', '将删除所有悬空（dangling）镜像，确定继续？', pruneMutation.mutateAsync)}>清理悬空镜像</Button>
            <Button type="danger" icon={<Trash2 size={14} />} onClick={() => runPrune('/api/docker/prune/images?all=true', '清理所有未用镜像', '将删除所有未被容器使用的镜像，确定继续？', pruneMutation.mutateAsync)}>清理所有未用镜像</Button>
          </>
        )}
        actionTitle="镜像操作"
      />
      <ConfigurableTable bordered rowKey="id" dataSource={treeData} columns={columns} loading={imagesQuery.isFetching}
        onRefresh={() => void imagesQuery.refetch()} refreshLoading={imagesQuery.isFetching}
        empty="未检测到 Docker 镜像" pagination={false}
        expandedRowKeys={expandedKeys}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onExpand={(expanded: boolean | undefined, record: any) =>
          setExpandedKeys((prev) => {
            const id = record?.id as string | undefined;
            if (!id) return prev;
            return expanded ? [...prev, id] : prev.filter((k) => k !== id);
          })
        }
      />

      <AppModal title="拉取镜像" visible={pullVisible} onCancel={() => { setPullVisible(false); setPullTag(''); }}
        onOk={() => void handlePull()} okText="开始拉取" okButtonProps={{ loading: pullImageMutation.isPending }} width={440}>
        <Form labelPosition="left" labelWidth={90}>
          <Form.Slot label="镜像标签">
            <Input placeholder="nginx:latest" value={pullTag} onChange={(v) => setPullTag(v)} style={{ width: '100%' }} />
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
              格式：&lt;镜像名&gt;:&lt;标签&gt;，留空标签默认 latest
            </Typography.Text>
          </Form.Slot>
        </Form>
      </AppModal>
    </>
  );
}

// ─── Networks Tab ─────────────────────────────────────────────────────────────

function NetworksTab() {
  const [keyword, setKeyword] = useState('');
  const [createVisible, setCreateVisible] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', driver: 'bridge', internal: false });

  const networksQuery = useDockerNetworks();
  const networks = networksQuery.data ?? [];
  const createNetworkMutation = useDockerCreateNetwork();
  const removeNetworkMutation = useDockerRemoveNetwork();
  const pruneMutation = useDockerPrune();

  const handleRemove = async (id: string) => {
    await removeNetworkMutation.mutateAsync(id);
    Toast.success({ content: '已删除', duration: 2 });
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    await createNetworkMutation.mutateAsync(createForm);
    Toast.success({ content: `网络 ${createForm.name} 创建成功`, duration: 2 });
    setCreateVisible(false); setCreateForm({ name: '', driver: 'bridge', internal: false });
  };

  const SYSTEM_NETWORKS = new Set(['bridge', 'host', 'none']);

  const filtered = keyword
    ? networks.filter((n) => n.name.toLowerCase().includes(keyword.toLowerCase()) || n.driver.includes(keyword))
    : networks;

  const columns: ColumnProps<NetworkInfo>[] = [
    { title: '网络名', dataIndex: 'name', render: (v: string) => <Typography.Text strong size="small">{v}</Typography.Text> },
    { title: '驱动', dataIndex: 'driver', width: 100, render: (v: string) => <Tag size="small" color="blue">{v}</Tag> },
    { title: '范围', dataIndex: 'scope', width: 90, render: (v: string) => <Tag size="small">{v}</Tag> },
    {
      title: 'IP 配置', width: 200,
      render: (_: unknown, r: NetworkInfo) => (
        r.ipam.subnet
          ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.ipam.subnet}{r.ipam.gateway ? ` → ${r.ipam.gateway}` : ''}</span>
          : <Typography.Text type="tertiary" size="small">—</Typography.Text>
      ),
    },
    { title: '容器数', dataIndex: 'containers', width: 90, render: (v: number) => <Tag size="small" color={v > 0 ? 'green' : 'grey'}>{v}</Tag> },
    { title: '内部网络', dataIndex: 'internal', width: 100, render: (v: boolean) => v ? <Tag size="small" color="orange">内部</Tag> : null },
    { title: '创建时间', dataIndex: 'created', width: 180, render: (v: string) => (v ? formatDateTime(new Date(v)) : '—') },
    createOperationColumn<NetworkInfo>({
      width: 90,
      emptyContent: (record) => SYSTEM_NETWORKS.has(record.name)
        ? <Typography.Text type="tertiary" size="small">系统网络</Typography.Text>
        : undefined,
      actions: (record) => [
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: SYSTEM_NETWORKS.has(record.name),
          onClick: () => {
            Modal.confirm({
              title: `确定删除网络 ${record.name}？`,
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleRemove(record.id); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索网络名 / 驱动" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
            <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void networksQuery.refetch()}>刷新</Button>
            <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>创建网络</Button>
          </>
        )}
        actions={<Button icon={<Trash2 size={14} />} onClick={() => runPrune('/api/docker/prune/networks', '清理未用网络', '将删除所有未被容器使用的网络，确定继续？', pruneMutation.mutateAsync)}>清理</Button>}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索网络名 / 驱动" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
            <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>创建网络</Button>
          </>
        )}
        mobileActions={(
          <>
            <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void networksQuery.refetch()}>刷新</Button>
            <Button icon={<Trash2 size={14} />} onClick={() => runPrune('/api/docker/prune/networks', '清理未用网络', '将删除所有未被容器使用的网络，确定继续？', pruneMutation.mutateAsync)}>清理</Button>
          </>
        )}
        actionTitle="网络操作"
      />
      <ConfigurableTable bordered rowKey="id" dataSource={filtered} columns={columns} loading={networksQuery.isFetching}
        onRefresh={() => void networksQuery.refetch()} refreshLoading={networksQuery.isFetching}
        empty="未检测到 Docker 网络" pagination={false} />

      <AppModal title="创建网络" visible={createVisible} onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()} okText="创建" okButtonProps={{ loading: createNetworkMutation.isPending }} width={440}>
        <Form labelPosition="left" labelWidth={90}>
          <Form.Slot label="网络名称">
            <Input placeholder="my-network" value={createForm.name}
              onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))} style={{ width: '100%' }} />
          </Form.Slot>
          <Form.Slot label="驱动">
            <Select value={createForm.driver} onChange={(v) => setCreateForm((f) => ({ ...f, driver: v as string }))} style={{ width: '100%' }}>
              <Select.Option value="bridge">bridge（默认）</Select.Option>
              <Select.Option value="overlay">overlay（Swarm）</Select.Option>
              <Select.Option value="host">host</Select.Option>
              <Select.Option value="macvlan">macvlan</Select.Option>
            </Select>
          </Form.Slot>
          <Form.Slot label="内部网络">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch checked={createForm.internal} onChange={(v) => setCreateForm((f) => ({ ...f, internal: v }))} />
              <Typography.Text>无外网访问</Typography.Text>
            </div>
          </Form.Slot>
        </Form>
      </AppModal>
    </>
  );
}

// ─── Volumes Tab ──────────────────────────────────────────────────────────────

function VolumesTab() {
  const [keyword, setKeyword] = useState('');
  const [createVisible, setCreateVisible] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', driver: 'local' });
  const volumesQuery = useDockerVolumes();
  const volumes = volumesQuery.data ?? [];
  const createVolumeMutation = useDockerCreateVolume();
  const removeVolumeMutation = useDockerRemoveVolume();
  const pruneMutation = useDockerPrune();

  const handleRemove = async (name: string) => {
    await removeVolumeMutation.mutateAsync(name);
    Toast.success({ content: '已删除', duration: 2 });
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    await createVolumeMutation.mutateAsync(createForm);
    Toast.success({ content: `存储卷 ${createForm.name} 创建成功`, duration: 2 });
    setCreateVisible(false); setCreateForm({ name: '', driver: 'local' });
  };

  const filtered = keyword
    ? volumes.filter((v) => v.name.toLowerCase().includes(keyword.toLowerCase()) || v.driver.includes(keyword))
    : volumes;

  const columns: ColumnProps<VolumeInfo>[] = [
    { title: '卷名', dataIndex: 'name', render: (v: string) => <Typography.Text strong size="small">{v}</Typography.Text> },
    { title: '驱动', dataIndex: 'driver', width: 100, render: (v: string) => <Tag size="small" color="blue">{v}</Tag> },
    { title: '范围', dataIndex: 'scope', width: 90, render: (v: string) => <Tag size="small">{v}</Tag> },
    {
      title: '挂载点', dataIndex: 'mountpoint',
      render: (v: string) => <Tooltip content={v}><code style={{ fontSize: 11 }}>{v.length > 50 ? `...${v.slice(-48)}` : v}</code></Tooltip>,
    },
    { title: '创建时间', dataIndex: 'created', width: 180, render: (v: string) => (v ? formatDateTime(new Date(v)) : '—') },
    createOperationColumn<VolumeInfo>({
      width: 90,
      actions: (record) => [
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: `确定删除存储卷 ${record.name}？此操作不可恢复。`,
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleRemove(record.name); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索卷名 / 驱动" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
            <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void volumesQuery.refetch()}>刷新</Button>
            <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>创建存储卷</Button>
          </>
        )}
        actions={<Button type="danger" icon={<Trash2 size={14} />} onClick={() => runPrune('/api/docker/prune/volumes', '清理未用存储卷', '将删除所有未被容器使用的存储卷（数据不可恢复），确定继续？', pruneMutation.mutateAsync)}>清理</Button>}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索卷名 / 驱动" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
            <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>创建存储卷</Button>
          </>
        )}
        mobileActions={(
          <>
            <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void volumesQuery.refetch()}>刷新</Button>
            <Button type="danger" icon={<Trash2 size={14} />} onClick={() => runPrune('/api/docker/prune/volumes', '清理未用存储卷', '将删除所有未被容器使用的存储卷（数据不可恢复），确定继续？', pruneMutation.mutateAsync)}>清理</Button>
          </>
        )}
        actionTitle="存储卷操作"
      />
      <ConfigurableTable bordered rowKey="name" dataSource={filtered} columns={columns} loading={volumesQuery.isFetching}
        onRefresh={() => void volumesQuery.refetch()} refreshLoading={volumesQuery.isFetching}
        empty="未检测到 Docker 存储卷" pagination={false} />

      <AppModal title="创建存储卷" visible={createVisible} onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()} okText="创建" okButtonProps={{ loading: createVolumeMutation.isPending }} width={400}>
        <Form labelPosition="left" labelWidth={90}>
          <Form.Slot label="卷名称">
            <Input placeholder="my-volume" value={createForm.name}
              onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))} style={{ width: '100%' }} />
          </Form.Slot>
          <Form.Slot label="驱动">
            <Input placeholder="local" value={createForm.driver}
              onChange={(v) => setCreateForm((f) => ({ ...f, driver: v }))} style={{ width: '100%' }} />
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
              默认 local
            </Typography.Text>
          </Form.Slot>
        </Form>
      </AppModal>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DockerPage() {
  const dockerAvailableQuery = useDockerAvailable();
  const dockerAvailable = dockerAvailableQuery.isError ? false : null;

  if (dockerAvailable === false) {
    return (
      <div className="page-container">
        <Empty
          title="Docker 不可用"
          description="无法连接到 Docker 守护进程，请确认 Docker 已安装并正在运行。"
          style={{ padding: '80px 0' }}
        />
      </div>
    );
  }

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line">
        <TabPane tab="容器" itemKey="containers"><ContainersTab /></TabPane>
        <TabPane tab="镜像" itemKey="images"><ImagesTab /></TabPane>
        <TabPane tab="网络" itemKey="networks"><NetworksTab /></TabPane>
        <TabPane tab="存储卷" itemKey="volumes"><VolumesTab /></TabPane>
      </Tabs>
    </div>
  );
}
