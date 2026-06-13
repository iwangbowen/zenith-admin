
import { useState, useCallback, useEffect } from 'react';
import {
  Button,
  Tag,
  Toast,
  Popconfirm,
  SideSheet,
  Typography,
  Tooltip,
  Dropdown,
  Progress,
  Modal,
  Empty,
  Input,
  Tabs,
  TabPane,
  Select,
  Switch,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import {
  RotateCcw,
  FileText,
  RefreshCw,
  ChevronDown,
  Activity,
  Search,
  Info,
  Plus,
  Trash2,
  Download,
} from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime } from '@/utils/date';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortBinding { privatePort: number; publicPort?: number; type: string }
interface ContainerInfo {
  id: string; shortId: string; names: string[]; image: string; imageId: string;
  command: string; created: number; state: string; status: string;
  ports: PortBinding[]; composeProject: string | null; composeService: string | null;
}
interface StatsInfo { cpuPercent: number; memUsage: number; memLimit: number }
interface ImageInfo { id: string; shortId: string; repoTags: string[]; size: number; created: number; containers: number }
interface NetworkInfo {
  id: string; name: string; driver: string; scope: string;
  ipam: { driver: string; subnet?: string; gateway?: string };
  internal: boolean; created: string; containers: number;
}
interface VolumeInfo { name: string; driver: string; mountpoint: string; scope: string; created: string; labels: Record<string, string> }

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
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [logsContainer, setLogsContainer] = useState<ContainerInfo | null>(null);
  const [logs, setLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [statsContainer, setStatsContainer] = useState<ContainerInfo | null>(null);
  const [stats, setStats] = useState<StatsInfo | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<ContainerInfo | null>(null);
  const [inspectData, setInspectData] = useState('');
  const [inspectLoading, setInspectLoading] = useState(false);

  const fetchContainers = useCallback(async () => {
    setLoading(true);
    const res = await request.get<ContainerInfo[]>('/api/docker');
    setLoading(false);
    if (res.code === 0 && res.data) setContainers(res.data);
  }, []);

  useEffect(() => { void fetchContainers(); }, [fetchContainers]);

  const handleAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActionLoading((p) => ({ ...p, [id]: true }));
    const res = await request.post(`/api/docker/${id}/${action}`, {});
    setActionLoading((p) => ({ ...p, [id]: false }));
    if (res.code === 0) {
      const msgMap = { start: '已启动', stop: '已停止', restart: '已重启' } as const;
      Toast.success({ content: msgMap[action], duration: 2 });
      void fetchContainers();
    }
  };

  const openLogs = async (c: ContainerInfo) => {
    setLogsContainer(c); setLogsLoading(true); setLogs('');
    const res = await request.get<{ logs: string }>(`/api/docker/${c.id}/logs?tail=500`);
    setLogsLoading(false);
    if (res.code === 0 && res.data) setLogs(res.data.logs);
  };

  const openStats = async (c: ContainerInfo) => {
    setStatsContainer(c); setStatsLoading(true); setStats(null);
    const res = await request.get<StatsInfo>(`/api/docker/${c.id}/stats`);
    setStatsLoading(false);
    if (res.code === 0 && res.data) setStats(res.data);
  };

  const openInspect = async (c: ContainerInfo) => {
    setInspectTarget(c); setInspectLoading(true); setInspectData('');
    const res = await request.get<Record<string, unknown>>(`/api/docker/${c.id}/inspect`);
    setInspectLoading(false);
    if (res.code === 0 && res.data) setInspectData(JSON.stringify(res.data, null, 2));
  };

  const isGroup = (r: ContainerInfo) => r.id.startsWith('__compose__');

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
    {
      title: '操作', width: 180, fixed: 'right' as const,
      render: (_: unknown, r: ContainerInfo) => {
        if (isGroup(r)) return null;
        const isRunning = r.state === 'running';
        const busy = !!actionLoading[r.id];
        return (
          <div style={{ display: 'flex', gap: 4 }}>
            {isRunning ? (
              <Popconfirm title={`确定停止 ${r.names[0] ?? r.shortId}？`} okType="danger" onConfirm={() => void handleAction(r.id, 'stop')}>
                <Button size="small" theme="borderless" type="danger" loading={busy}>停止</Button>
              </Popconfirm>
            ) : (
              <Button size="small" theme="borderless" loading={busy} onClick={() => void handleAction(r.id, 'start')}>启动</Button>
            )}
            <Button size="small" theme="borderless" onClick={() => void openLogs(r)}>日志</Button>
            <Dropdown trigger="click" position="bottomRight" render={
              <Dropdown.Menu>
                <Dropdown.Item icon={<RotateCcw size={13} />} onClick={() => void handleAction(r.id, 'restart')}>重启</Dropdown.Item>
                <Dropdown.Item icon={<Activity size={13} />} onClick={() => void openStats(r)}>资源占用</Dropdown.Item>
                <Dropdown.Item icon={<Info size={13} />} onClick={() => void openInspect(r)}>检查详情</Dropdown.Item>
              </Dropdown.Menu>
            }>
              <Button size="small" theme="borderless" icon={<ChevronDown size={13} />} />
            </Dropdown>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索容器名 / 镜像 / Compose 项目" showClear value={keyword} onChange={setKeyword} style={{ width: 280 }} />
        <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void fetchContainers()}>刷新</Button>
      </SearchToolbar>
      <ConfigurableTable bordered rowKey="id" dataSource={filtered} columns={columns} loading={loading}
        onRefresh={() => void fetchContainers()} refreshLoading={loading}
        empty="未检测到 Docker 容器" pagination={{ pageSize: 30, showSizeChanger: true }} expandAllGroupRows />

      <SideSheet
        title={<span><FileText size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />容器日志：{logsContainer?.names[0] ?? ''}</span>}
        visible={!!logsContainer} onCancel={() => { setLogsContainer(null); setLogs(''); }} width={680} placement="right"
      >
        {logsLoading
          ? <div style={{ textAlign: 'center', padding: 40 }}><Typography.Text type="tertiary">加载中...</Typography.Text></div>
          : <pre style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 6, maxHeight: 'calc(100vh - 120px)', overflow: 'auto', margin: 0 }}>{logs || '（暂无日志）'}</pre>
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

function ImagesTab() {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [pullVisible, setPullVisible] = useState(false);
  const [pullTag, setPullTag] = useState('');
  const [pulling, setPulling] = useState(false);

  const fetchImages = useCallback(async () => {
    setLoading(true);
    const res = await request.get<ImageInfo[]>('/api/docker/images');
    setLoading(false);
    if (res.code === 0 && res.data) setImages(res.data);
  }, []);

  useEffect(() => { void fetchImages(); }, [fetchImages]);

  const handleRemove = async (id: string) => {
    const res = await request.delete(`/api/docker/images/${id}`);
    if (res.code === 0) { Toast.success({ content: '已删除', duration: 2 }); void fetchImages(); }
  };

  const handlePull = async () => {
    if (!pullTag.trim()) return;
    setPulling(true);
    const res = await request.post('/api/docker/images/pull', { repoTag: pullTag.trim() });
    setPulling(false);
    if (res.code === 0) {
      Toast.success({ content: `镜像 ${pullTag} 拉取成功`, duration: 3 });
      setPullVisible(false); setPullTag('');
      void fetchImages();
    }
  };

  const filtered = keyword
    ? images.filter((i) => i.repoTags.join(',').toLowerCase().includes(keyword.toLowerCase()) || i.shortId.includes(keyword))
    : images;

  const columns: ColumnProps<ImageInfo>[] = [
    {
      title: '镜像标签',
      render: (_: unknown, r: ImageInfo) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {r.repoTags.length > 0
            ? r.repoTags.map((t) => <Tag key={t} size="small" color="blue">{t}</Tag>)
            : <Tag size="small" color="grey">&lt;none&gt;</Tag>
          }
        </div>
      ),
    },
    { title: '镜像 ID', dataIndex: 'shortId', width: 140, render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code> },
    { title: '大小', dataIndex: 'size', width: 110, sorter: (a, b) => (a?.size ?? 0) - (b?.size ?? 0), render: (v: number) => formatBytes(v) },
    { title: '容器数', dataIndex: 'containers', width: 90, render: (v: number) => <Tag size="small" color={v > 0 ? 'green' : 'grey'}>{v}</Tag> },
    { title: '创建时间', dataIndex: 'created', width: 180, render: (v: number) => formatDateTime(new Date(v * 1000)) },
    {
      title: '操作', width: 100, fixed: 'right' as const,
      render: (_: unknown, r: ImageInfo) => (
        <Popconfirm title="确定删除此镜像？运行中的容器使用的镜像无法删除。" okType="danger" onConfirm={() => void handleRemove(r.id)}>
          <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索镜像标签 / ID" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
        <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void fetchImages()}>刷新</Button>
        <Button type="primary" icon={<Download size={14} />} onClick={() => setPullVisible(true)}>拉取镜像</Button>
      </SearchToolbar>
      <ConfigurableTable bordered rowKey="id" dataSource={filtered} columns={columns} loading={loading}
        onRefresh={() => void fetchImages()} refreshLoading={loading}
        empty="未检测到 Docker 镜像" pagination={{ pageSize: 30, showSizeChanger: true }} />

      <Modal title="拉取镜像" visible={pullVisible} onCancel={() => { setPullVisible(false); setPullTag(''); }}
        onOk={() => void handlePull()} okText="开始拉取" okButtonProps={{ loading: pulling }} width={440}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Typography.Text>镜像标签（如 nginx:latest）</Typography.Text>
          <Input placeholder="nginx:latest" value={pullTag} onChange={(v) => setPullTag(v)} style={{ width: '100%' }} />
          <Typography.Text type="tertiary" size="small">格式：&lt;镜像名&gt;:&lt;标签&gt;，留空标签默认 latest</Typography.Text>
        </div>
      </Modal>
    </>
  );
}

// ─── Networks Tab ─────────────────────────────────────────────────────────────

function NetworksTab() {
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [createVisible, setCreateVisible] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', driver: 'bridge', internal: false });
  const [creating, setCreating] = useState(false);

  const fetchNetworks = useCallback(async () => {
    setLoading(true);
    const res = await request.get<NetworkInfo[]>('/api/docker/networks');
    setLoading(false);
    if (res.code === 0 && res.data) setNetworks(res.data);
  }, []);

  useEffect(() => { void fetchNetworks(); }, [fetchNetworks]);

  const handleRemove = async (id: string) => {
    const res = await request.delete(`/api/docker/networks/${id}`);
    if (res.code === 0) { Toast.success({ content: '已删除', duration: 2 }); void fetchNetworks(); }
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    const res = await request.post('/api/docker/networks', createForm);
    setCreating(false);
    if (res.code === 0) {
      Toast.success({ content: `网络 ${createForm.name} 创建成功`, duration: 2 });
      setCreateVisible(false); setCreateForm({ name: '', driver: 'bridge', internal: false });
      void fetchNetworks();
    }
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
    {
      title: '操作', width: 90, fixed: 'right' as const,
      render: (_: unknown, r: NetworkInfo) => {
        if (SYSTEM_NETWORKS.has(r.name)) return <Typography.Text type="tertiary" size="small">系统网络</Typography.Text>;
        return (
          <Popconfirm title={`确定删除网络 ${r.name}？`} okType="danger" onConfirm={() => void handleRemove(r.id)}>
            <Button size="small" theme="borderless" type="danger">删除</Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <>
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索网络名 / 驱动" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
        <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void fetchNetworks()}>刷新</Button>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>创建网络</Button>
      </SearchToolbar>
      <ConfigurableTable bordered rowKey="id" dataSource={filtered} columns={columns} loading={loading}
        onRefresh={() => void fetchNetworks()} refreshLoading={loading}
        empty="未检测到 Docker 网络" pagination={{ pageSize: 30, showSizeChanger: true }} />

      <Modal title="创建网络" visible={createVisible} onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()} okText="创建" okButtonProps={{ loading: creating }} width={440}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <Typography.Text style={{ display: 'block', marginBottom: 4 }}>网络名称</Typography.Text>
            <Input placeholder="my-network" value={createForm.name}
              onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))} style={{ width: '100%' }} />
          </div>
          <div>
            <Typography.Text style={{ display: 'block', marginBottom: 4 }}>驱动</Typography.Text>
            <Select value={createForm.driver} onChange={(v) => setCreateForm((f) => ({ ...f, driver: v as string }))} style={{ width: '100%' }}>
              <Select.Option value="bridge">bridge（默认）</Select.Option>
              <Select.Option value="overlay">overlay（Swarm）</Select.Option>
              <Select.Option value="host">host</Select.Option>
              <Select.Option value="macvlan">macvlan</Select.Option>
            </Select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={createForm.internal} onChange={(v) => setCreateForm((f) => ({ ...f, internal: v }))} />
            <Typography.Text>内部网络（无外网访问）</Typography.Text>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Volumes Tab ──────────────────────────────────────────────────────────────

function VolumesTab() {
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [createVisible, setCreateVisible] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', driver: 'local' });
  const [creating, setCreating] = useState(false);

  const fetchVolumes = useCallback(async () => {
    setLoading(true);
    const res = await request.get<VolumeInfo[]>('/api/docker/volumes');
    setLoading(false);
    if (res.code === 0 && res.data) setVolumes(res.data);
  }, []);

  useEffect(() => { void fetchVolumes(); }, [fetchVolumes]);

  const handleRemove = async (name: string) => {
    const res = await request.delete(`/api/docker/volumes/${name}`);
    if (res.code === 0) { Toast.success({ content: '已删除', duration: 2 }); void fetchVolumes(); }
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    const res = await request.post('/api/docker/volumes', createForm);
    setCreating(false);
    if (res.code === 0) {
      Toast.success({ content: `存储卷 ${createForm.name} 创建成功`, duration: 2 });
      setCreateVisible(false); setCreateForm({ name: '', driver: 'local' });
      void fetchVolumes();
    }
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
    {
      title: '操作', width: 90, fixed: 'right' as const,
      render: (_: unknown, r: VolumeInfo) => (
        <Popconfirm title={`确定删除存储卷 ${r.name}？此操作不可恢复。`} okType="danger" onConfirm={() => void handleRemove(r.name)}>
          <Button size="small" theme="borderless" type="danger">删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索卷名 / 驱动" showClear value={keyword} onChange={setKeyword} style={{ width: 260 }} />
        <Button type="tertiary" icon={<RefreshCw size={14} />} onClick={() => void fetchVolumes()}>刷新</Button>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>创建存储卷</Button>
      </SearchToolbar>
      <ConfigurableTable bordered rowKey="name" dataSource={filtered} columns={columns} loading={loading}
        onRefresh={() => void fetchVolumes()} refreshLoading={loading}
        empty="未检测到 Docker 存储卷" pagination={{ pageSize: 30, showSizeChanger: true }} />

      <Modal title="创建存储卷" visible={createVisible} onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()} okText="创建" okButtonProps={{ loading: creating }} width={400}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <Typography.Text style={{ display: 'block', marginBottom: 4 }}>卷名称</Typography.Text>
            <Input placeholder="my-volume" value={createForm.name}
              onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))} style={{ width: '100%' }} />
          </div>
          <div>
            <Typography.Text style={{ display: 'block', marginBottom: 4 }}>驱动（默认 local）</Typography.Text>
            <Input placeholder="local" value={createForm.driver}
              onChange={(v) => setCreateForm((f) => ({ ...f, driver: v }))} style={{ width: '100%' }} />
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DockerPage() {
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void request.get<unknown[]>('/api/docker', { silent: true }).then((res) => {
      setDockerAvailable(res.code === 0);
    });
  }, []);

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
    <div className="page-container">
      <Tabs type="line" style={{ marginBottom: 0 }}>
        <TabPane tab="容器" itemKey="containers"><ContainersTab /></TabPane>
        <TabPane tab="镜像" itemKey="images"><ImagesTab /></TabPane>
        <TabPane tab="网络" itemKey="networks"><NetworksTab /></TabPane>
        <TabPane tab="存储卷" itemKey="volumes"><VolumesTab /></TabPane>
      </Tabs>
    </div>
  );
}
