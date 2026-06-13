import Dockerode from 'dockerode';

let _docker: Dockerode | null = null;

function getDocker(): Dockerode {
  if (!_docker) {
    _docker = new Dockerode();
  }
  return _docker;
}

export interface ContainerInfo {
  id: string;
  shortId: string;
  names: string[];
  image: string;
  imageId: string;
  command: string;
  created: number;
  state: string;
  status: string;
  ports: Array<{ privatePort: number; publicPort: number | undefined; type: string }>;
  /** Docker Compose project label */
  composeProject: string | null;
  /** Docker Compose service label */
  composeService: string | null;
}

export async function listContainers(): Promise<ContainerInfo[]> {
  const docker = getDocker();
  const containers = await docker.listContainers({ all: true });
  return containers.map((c) => ({
    id: c.Id,
    shortId: c.Id.slice(0, 12),
    names: c.Names.map((n) => n.replace(/^\//, '')),
    image: c.Image,
    imageId: c.ImageID.replace('sha256:', '').slice(0, 12),
    command: c.Command,
    created: c.Created,
    state: c.State,
    status: c.Status,
    ports: (c.Ports ?? []).map((p) => ({
      privatePort: p.PrivatePort,
      publicPort: p.PublicPort,
      type: p.Type,
    })),
    composeProject: c.Labels?.['com.docker.compose.project'] ?? null,
    composeService: c.Labels?.['com.docker.compose.service'] ?? null,
  }));
}

export async function inspectContainer(id: string) {
  const container = getDocker().getContainer(id);
  return container.inspect();
}

export async function startContainer(id: string): Promise<void> {
  const container = getDocker().getContainer(id);
  await container.start();
}

export async function stopContainer(id: string): Promise<void> {
  const container = getDocker().getContainer(id);
  await container.stop({ t: 10 });
}

export async function restartContainer(id: string): Promise<void> {
  const container = getDocker().getContainer(id);
  await container.restart({ t: 10 });
}

export async function getContainerLogs(id: string, tail = 200): Promise<string> {
  const container = getDocker().getContainer(id);
  const stream = await container.logs({ stdout: true, stderr: true, tail, timestamps: false });
  // dockerode 返回 Buffer，去除 Docker 多路复用头（每条消息前 8 字节是头）
  return demuxDockerStream(stream as unknown as Buffer);
}

/** 去除 Docker 多路复用流的 8 字节头（stdin=0, stdout=1, stderr=2） */
function demuxDockerStream(buf: Buffer): string {
  let offset = 0;
  const chunks: string[] = [];
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    const text = buf.subarray(offset + 8, offset + 8 + size).toString('utf8');
    chunks.push(text);
    offset += 8 + size;
  }
  return chunks.join('');
}

export async function getContainerStats(id: string): Promise<{ cpuPercent: number; memUsage: number; memLimit: number }> {
  const container = getDocker().getContainer(id);
  const stats = await container.stats({ stream: false }) as {
    cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number; online_cpus?: number };
    precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
    memory_stats: { usage: number; limit: number };
  };
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const numCpus = stats.cpu_stats.online_cpus ?? 1;
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;
  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memUsage: stats.memory_stats.usage,
    memLimit: stats.memory_stats.limit,
  };
}

// ─── Images ──────────────────────────────────────────────────────────────────

export interface ImageInfo {
  id: string;
  shortId: string;
  repoTags: string[];
  size: number;
  created: number;
  containers: number;
}

export async function listImages(): Promise<ImageInfo[]> {
  const docker = getDocker();
  const images = await docker.listImages({ all: false });
  return images.map((img) => ({
    id: img.Id,
    shortId: img.Id.replace('sha256:', '').slice(0, 12),
    repoTags: img.RepoTags?.filter((t) => t !== '<none>:<none>') ?? [],
    size: img.Size,
    created: img.Created,
    containers: img.Containers ?? 0,
  }));
}

export async function removeImage(id: string): Promise<void> {
  await getDocker().getImage(id).remove({ force: false });
}

export async function pullImage(repoTag: string): Promise<void> {
  const docker = getDocker();
  await new Promise<void>((resolve, reject) => {
    docker.pull(repoTag, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) { reject(err); return; }
      docker.modem.followProgress(stream, (err2: Error | null) => {
        if (err2) reject(err2); else resolve();
      });
    });
  });
}

// ─── Networks ─────────────────────────────────────────────────────────────────

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  ipam: { driver: string; subnet?: string; gateway?: string };
  internal: boolean;
  created: string;
  containers: number;
}

export async function listNetworks(): Promise<NetworkInfo[]> {
  const docker = getDocker();
  const nets = await docker.listNetworks();
  return nets.map((n) => {
    const ipamConfig = n.IPAM?.Config?.[0] ?? {};
    return {
      id: n.Id,
      name: n.Name,
      driver: n.Driver,
      scope: n.Scope,
      ipam: {
        driver: n.IPAM?.Driver ?? 'default',
        subnet: ipamConfig.Subnet,
        gateway: ipamConfig.Gateway,
      },
      internal: n.Internal,
      created: n.Created,
      containers: Object.keys(n.Containers ?? {}).length,
    };
  });
}

export async function removeNetwork(id: string): Promise<void> {
  await getDocker().getNetwork(id).remove();
}

export async function createNetwork(name: string, driver: string, internal: boolean): Promise<void> {
  await getDocker().createNetwork({ Name: name, Driver: driver, Internal: internal });
}

// ─── Volumes ──────────────────────────────────────────────────────────────────

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  created: string;
  labels: Record<string, string>;
}

export async function listVolumes(): Promise<VolumeInfo[]> {
  const docker = getDocker();
  const result = await docker.listVolumes();
  return (result.Volumes ?? []).map((v) => ({
    name: v.Name,
    driver: v.Driver,
    mountpoint: v.Mountpoint,
    scope: v.Scope,
    created: (v as unknown as { CreatedAt?: string }).CreatedAt ?? '',
    labels: (v.Labels ?? {}) as Record<string, string>,
  }));
}

export async function removeVolume(name: string): Promise<void> {
  await getDocker().getVolume(name).remove();
}

export async function createVolume(name: string, driver: string): Promise<void> {
  await getDocker().createVolume({ Name: name, Driver: driver });
}

// ─── Container File Browsing ──────────────────────────────────────────────────

import { PassThrough } from 'node:stream';

export interface ContainerFileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink';
  size: number;
}

/** 在容器内执行命令并返回 stdout+stderr 文本 */
export async function execInContainer(containerId: string, cmd: string[]): Promise<string> {
  const docker = getDocker();
  const container = docker.getContainer(containerId);
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ Detach: false });
  return new Promise<string>((resolve, reject) => {
    let output = '';
    const pt = new PassThrough();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (container.modem as unknown as { demuxStream: (...a: unknown[]) => void }).demuxStream(stream, pt, pt);
    pt.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    pt.on('end', () => resolve(output));
    pt.on('error', reject);
  });
}

/** 解析 ls -la 输出为文件条目列表 */
function parseLsLa(output: string, basePath: string): ContainerFileEntry[] {
  const entries: ContainerFileEntry[] = [];
  for (const line of output.trim().split('\n')) {
    if (!line || line.startsWith('total') || line.includes('cannot access') || line.includes('No such file')) continue;
    // ls -la 字段：perms links owner group size month day time/year name...
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const perms = parts[0];
    const size = Number.parseInt(parts[4], 10);
    const name = parts.slice(8).join(' ').trim();
    if (!name || name === '.' || name === '..') continue;
    // 处理软链接：name -> target 只取链接名
    const actualName = name.includes(' -> ') ? name.split(' -> ')[0].trim() : name;
    if (!actualName) continue;
    let type: ContainerFileEntry['type'];
    if (perms.startsWith('d')) { type = 'dir'; }
    else if (perms.startsWith('l')) { type = 'symlink'; }
    else { type = 'file'; }
    const fullPath = basePath === '/' ? `/${actualName}` : `${basePath.replace(/\/$/, '')}/${actualName}`;
    entries.push({ name: actualName, path: fullPath, type, size: Number.isNaN(size) ? 0 : size });
  }
  return entries;
}

/** 列出容器内指定目录的文件 */
export async function listContainerFiles(containerId: string, path = '/'): Promise<ContainerFileEntry[]> {
  const normPath = path || '/';
  try {
    const output = await execInContainer(containerId, ['ls', '-la', '--', normPath]);
    return parseLsLa(output, normPath);
  } catch {
    return [];
  }
}

/** 读取容器内文件内容 */
export async function readContainerFile(containerId: string, filePath: string): Promise<string> {
  return execInContainer(containerId, ['cat', '--', filePath]);
}
