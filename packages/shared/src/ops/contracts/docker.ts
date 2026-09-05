import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { DOCKER_FILE_ENTRY_TYPES } from '../constants';
import { dockerCreateNetworkSchema, dockerCreateVolumeSchema, dockerPullImageSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const dockerPortBindingSchema = z.object({
  privatePort: z.number(),
  publicPort: z.number().optional(),
  type: z.string(),
}).meta({ id: 'DockerPortBinding' });

export type DockerPortBinding = z.infer<typeof dockerPortBindingSchema>;

export const dockerContainerSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  names: z.array(z.string()),
  image: z.string(),
  imageId: z.string(),
  command: z.string(),
  created: z.number().meta({ description: '创建时间（Unix 秒）' }),
  state: z.string(),
  status: z.string(),
  ports: z.array(dockerPortBindingSchema),
  composeProject: z.string().nullable().meta({ description: 'Docker Compose project label' }),
  composeService: z.string().nullable().meta({ description: 'Docker Compose service label' }),
}).meta({ id: 'DockerContainer' });

export type DockerContainer = z.infer<typeof dockerContainerSchema>;

export const dockerContainerStatsSchema = z.object({
  cpuPercent: z.number(),
  memUsage: z.number(),
  memLimit: z.number(),
}).meta({ id: 'DockerContainerStats' });

export type DockerContainerStats = z.infer<typeof dockerContainerStatsSchema>;

export const dockerImageSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  repoTags: z.array(z.string()),
  size: z.number(),
  created: z.number().meta({ description: '创建时间（Unix 秒）' }),
  containers: z.number(),
}).meta({ id: 'DockerImage' });

export type DockerImage = z.infer<typeof dockerImageSchema>;

export const dockerNetworkSchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  ipam: z.object({ driver: z.string(), subnet: z.string().optional(), gateway: z.string().optional() }),
  internal: z.boolean(),
  created: z.string(),
  containers: z.number(),
}).meta({ id: 'DockerNetwork' });

export type DockerNetwork = z.infer<typeof dockerNetworkSchema>;

export const dockerVolumeSchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  scope: z.string(),
  created: z.string(),
  labels: z.record(z.string(), z.string()),
}).meta({ id: 'DockerVolume' });

export type DockerVolume = z.infer<typeof dockerVolumeSchema>;

export const dockerFileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(DOCKER_FILE_ENTRY_TYPES),
  size: z.number(),
}).meta({ id: 'DockerFileEntry' });

export type DockerFileEntry = z.infer<typeof dockerFileEntrySchema>;

export const dockerPruneResultSchema = z.object({
  containersDeleted: z.number().optional(),
  imagesDeleted: z.number().optional(),
  networksDeleted: z.number().optional(),
  volumesDeleted: z.number().optional(),
  spaceReclaimed: z.number().optional(),
}).meta({ id: 'DockerPruneResult' });

export type DockerPruneResult = z.infer<typeof dockerPruneResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const dockerContainerIdParam = z.object({
  id: z.string().min(1).meta({ description: '容器 ID 或名称' }),
});

export const dockerImageIdParam = z.object({
  id: z.string().min(1).meta({ description: '镜像 ID' }),
});

export const dockerNetworkIdParam = z.object({
  id: z.string().min(1).meta({ description: '网络 ID' }),
});

export const dockerVolumeNameParam = z.object({
  name: z.string().min(1).meta({ description: '存储卷名称' }),
});

export const dockerContainerLogsQuery = z.object({
  tail: z.coerce.number().int().min(10).max(5000).default(200).meta({ description: '返回末尾行数' }),
});

export const dockerContainerFilesQuery = z.object({
  path: z.string().optional().meta({ description: '容器内目录，缺省为根目录' }),
});

export const dockerContainerFileContentQuery = z.object({
  path: z.string().meta({ description: '容器内文件路径' }),
});

export const dockerPruneImagesQuery = z.object({
  all: z.enum(['true', 'false']).optional().meta({ description: 'true 清理全部未使用镜像；缺省仅清理悬空镜像' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const dockerContract = defineContract('/api/docker', {
  containers: op.get('/', { response: z.array(dockerContainerSchema), summary: '容器列表' }),
  start: op.post('/{id}/start', { params: dockerContainerIdParam, summary: '启动容器' }),
  stop: op.post('/{id}/stop', { params: dockerContainerIdParam, summary: '停止容器' }),
  restart: op.post('/{id}/restart', { params: dockerContainerIdParam, summary: '重启容器' }),
  logs: op.get('/{id}/logs', { params: dockerContainerIdParam, query: dockerContainerLogsQuery, response: z.object({ logs: z.string() }), summary: '获取容器日志' }),
  stats: op.get('/{id}/stats', { params: dockerContainerIdParam, response: dockerContainerStatsSchema, summary: '获取容器资源占用' }),
  inspect: op.get('/{id}/inspect', { params: dockerContainerIdParam, response: z.record(z.string(), z.unknown()).meta({ description: 'docker inspect 原始结构' }), summary: '容器详情（docker inspect）' }),
  images: op.get('/images', { response: z.array(dockerImageSchema), summary: '镜像列表' }),
  removeImage: op.delete('/images/{id}', { params: dockerImageIdParam, summary: '删除镜像' }),
  pullImage: op.post('/images/pull', { body: dockerPullImageSchema, summary: '拉取镜像' }),
  networks: op.get('/networks', { response: z.array(dockerNetworkSchema), summary: '网络列表' }),
  removeNetwork: op.delete('/networks/{id}', { params: dockerNetworkIdParam, summary: '删除网络' }),
  createNetwork: op.post('/networks', { body: dockerCreateNetworkSchema, summary: '创建网络' }),
  volumes: op.get('/volumes', { response: z.array(dockerVolumeSchema), summary: '存储卷列表' }),
  removeVolume: op.delete('/volumes/{name}', { params: dockerVolumeNameParam, summary: '删除存储卷' }),
  createVolume: op.post('/volumes', { body: dockerCreateVolumeSchema, summary: '创建存储卷' }),
  containerFiles: op.get('/{id}/files', { params: dockerContainerIdParam, query: dockerContainerFilesQuery, response: z.array(dockerFileEntrySchema), summary: '列出容器内目录' }),
  containerFileContent: op.get('/{id}/files/content', { params: dockerContainerIdParam, query: dockerContainerFileContentQuery, response: z.object({ content: z.string() }), summary: '读取容器内文件' }),
  pruneContainers: op.post('/prune/containers', { response: dockerPruneResultSchema, summary: '清理已停止容器' }),
  pruneImages: op.post('/prune/images', { query: dockerPruneImagesQuery, response: dockerPruneResultSchema, summary: '清理镜像（悬空 / 全部未用）' }),
  pruneNetworks: op.post('/prune/networks', { response: dockerPruneResultSchema, summary: '清理未使用网络' }),
  pruneVolumes: op.post('/prune/volumes', { response: dockerPruneResultSchema, summary: '清理未使用存储卷' }),
  pruneSystem: op.post('/prune/system', { response: dockerPruneResultSchema, summary: '系统清理（容器 + 悬空镜像 + 网络）' }),
}, { tags: ['Docker'] });
