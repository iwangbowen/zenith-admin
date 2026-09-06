import type { FileStorageConfig, FolderEntry, ManagedFile, StorageBrowseResult, UploadSessionStatus } from '@zenith/shared/platform';
import { fillPath } from '@zenith/shared/core';
import { fileContract, fileStorageConfigContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockFileStorageConfigs, STORAGE_SECRET_FIELDS, type MockFileStorageConfig } from '@/mocks/data/system';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

function mockUuidV7() {
  const timeHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const rand = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${rand().slice(1)}-${((8 + Math.floor(Math.random() * 4)).toString(16) + rand().slice(1))}-${rand()}${rand()}${rand()}`;
}

/** 稳定代理路径由契约派生（与服务端 mapManagedFile 的 url 字段一致） */
const contentUrlOf = (id: string) => fillPath(fileContract.content.fullPath, { id });

/** 种子文件；url 按 id 派生，不手写路径 */
const seedManagedFiles: Omit<ManagedFile, 'url'>[] = [
  {
    id: '018f6f8a-0001-7000-8000-000000000001',
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'demo-avatar.png',
    objectKey: 'uploads/2026/01/demo-avatar.png',
    size: 102400,
    mimeType: 'image/png',
    extension: 'png',
    visibility: 'public',
    directUrl: 'https://avatars.githubusercontent.com/u/583231',
    uploaderName: 'Admin',
    createdAt: '2026-01-10 10:00:00',
    updatedAt: '2026-01-10 10:00:00',
  },
  {
    id: '018f6f8a-0002-7000-8000-000000000002',
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'report-2026.pdf',
    objectKey: 'uploads/2026/01/report-2026.pdf',
    size: 512000,
    mimeType: 'application/pdf',
    extension: 'pdf',
    visibility: 'public',
    uploaderName: 'Admin',
    createdAt: '2026-01-15 14:30:00',
    updatedAt: '2026-01-15 14:30:00',
  },
  {
    id: '018f6f8a-0003-7000-8000-000000000003',
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'intro.mp4',
    objectKey: 'uploads/2026/02/intro.mp4',
    size: 10240000,
    mimeType: 'video/mp4',
    extension: 'mp4',
    visibility: 'public',
    uploaderName: 'Admin',
    createdAt: '2026-02-05 09:00:00',
    updatedAt: '2026-02-05 09:00:00',
  },
  {
    id: '018f6f8a-0004-7000-8000-000000000004',
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'banner.jpg',
    objectKey: 'uploads/2026/02/banner.jpg',
    size: 204800,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    visibility: 'public',
    directUrl: 'https://picsum.photos/800/300',
    uploaderName: 'Admin',
    createdAt: '2026-02-10 11:00:00',
    updatedAt: '2026-02-10 11:00:00',
  },
  {
    id: '018f6f8a-0005-7000-8000-000000000005',
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'data-export.xlsx',
    objectKey: 'uploads/2026/03/data-export.xlsx',
    size: 81920,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
    visibility: 'public',
    uploaderName: 'Admin',
    createdAt: '2026-03-01 08:00:00',
    updatedAt: '2026-03-01 08:00:00',
  },
  {
    id: '018f6f8a-0006-7000-8000-000000000006',
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'logo.png',
    objectKey: 'uploads/logo.png',
    size: 30720,
    mimeType: 'image/png',
    extension: 'png',
    visibility: 'public',
    directUrl: 'https://avatars.githubusercontent.com/u/9919',
    uploaderName: 'Admin',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  },
];

export const mockManagedFiles: ManagedFile[] = seedManagedFiles.map((f) => ({ ...f, url: contentUrlOf(f.id) }));

/** 把浏览器 File 登记为托管文件（demo 模式的 url 用占位图站，仅供渲染） */
function registerUploadedFile(file: File): ManagedFile {
  const uploaded: ManagedFile = {
    id: mockUuidV7(),
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: file.name,
    objectKey: `uploads/${Date.now()}-${file.name}`,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    extension: file.name.split('.').pop() ?? '',
    visibility: 'public',
    url: `https://via.placeholder.com/200?text=${encodeURIComponent(file.name)}`,
    uploaderName: 'Admin',
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  };
  mockManagedFiles.push(uploaded);
  return uploaded;
}

function buildBrowseResult(storageConfigId: number, path: string): StorageBrowseResult {
  const config = mockFileStorageConfigs.find((c) => c.id === storageConfigId);
  const basePath = (config?.basePath ?? '').replace(/^\/+|\/+$/g, '');
  const currentPath = path.replace(/^\/+|\/+$/g, '');
  const fullPrefix = [basePath, currentPath].filter(Boolean).join('/');
  const prefixWithSlash = fullPrefix ? `${fullPrefix}/` : '';

  const folderSet = new Set<string>();
  const levelFiles: ManagedFile[] = [];

  for (const file of mockManagedFiles) {
    if (file.storageConfigId !== storageConfigId) continue;
    let relKey = file.objectKey;
    if (prefixWithSlash) {
      if (!relKey.startsWith(prefixWithSlash)) continue;
      relKey = relKey.slice(prefixWithSlash.length);
    }
    const slashIdx = relKey.indexOf('/');
    if (slashIdx === -1) {
      levelFiles.push(file);
    } else {
      const folderName = relKey.slice(0, slashIdx);
      if (folderName) folderSet.add(folderName);
    }
  }

  const folders: FolderEntry[] = [...folderSet].sort().map((name) => ({
    name,
    path: currentPath ? `${currentPath}/${name}` : name,
  }));

  return { folders, files: levelFiles, currentPath, basePath };
}

/** 模拟后端：列表/详情一律不返回密钥字段 */
function stripStorageSecrets(config: MockFileStorageConfig): FileStorageConfig {
  const clone: MockFileStorageConfig = { ...config };
  for (const field of STORAGE_SECRET_FIELDS) delete clone[field];
  return clone;
}

interface MockUploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  chunkSize: number;
  totalChunks: number;
  received: Set<number>;
  status: UploadSessionStatus['status'];
}
const mockUploadSessions = new Map<string, MockUploadSession>();

export const filesHandlers = [
  // 文件列表（分页）
  mock(fileContract.list, ({ query, ok, paginate }) => {
    const list = mockManagedFiles.filter((f) => {
      if (query.keyword && !includesKeyword(query.keyword, f.originalName)) return false;
      return true;
    });
    return ok(paginate(list));
  }),

  // 按存储配置浏览文件目录（必须放在 detail 之前）
  mock(fileContract.browse, ({ query, ok }) => ok(buildBrowseResult(query.storageConfigId, query.path ?? ''))),

  // 上传文件（demo 模式支持多文件）
  mock(fileContract.upload, ({ body, ok }) => {
    const files = body.getAll('file').filter((f): f is File => f instanceof File);
    const uploadedFiles = files.map(registerUploadedFile);
    return ok(uploadedFiles, `成功上传 ${uploadedFiles.length} 个文件`);
  }),

  // 上传单个文件
  mock(fileContract.uploadOne, ({ body, ok }) => {
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('请选择要上传的文件');
    return ok(registerUploadedFile(file), '上传成功');
  }),

  // 分片上传：初始化
  mock(fileContract.uploadInit, ({ body, ok }) => {
    const uploadId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.max(1, Math.ceil(body.fileSize / body.chunkSize));
    mockUploadSessions.set(uploadId, {
      uploadId, fileName: body.fileName, fileSize: body.fileSize, mimeType: body.mimeType,
      chunkSize: body.chunkSize, totalChunks, received: new Set(), status: 'uploading',
    });
    return ok({ uploadId, chunkSize: body.chunkSize, totalChunks, received: [] });
  }),

  // 分片上传：上传单个分片
  mock(fileContract.uploadChunk, ({ body, ok }) => {
    const uploadId = String(body.get('uploadId') ?? '');
    const index = Number(body.get('index'));
    const session = mockUploadSessions.get(uploadId);
    if (!session) return notFound('上传会话不存在');
    session.received.add(index);
    return ok({ index, received: [...session.received].sort((a, b) => a - b) });
  }),

  // 分片上传：完成合并
  mock(fileContract.uploadComplete, ({ body, ok }) => {
    const session = mockUploadSessions.get(body.uploadId);
    if (!session) return notFound('上传会话不存在');
    session.status = 'completed';
    const uploaded: ManagedFile = {
      id: mockUuidV7(), storageConfigId: 1, storageName: '本地磁盘', provider: 'local',
      originalName: session.fileName, objectKey: `uploads/${Date.now()}-${session.fileName}`,
      size: session.fileSize, mimeType: session.mimeType ?? 'application/octet-stream',
      extension: session.fileName.split('.').pop() ?? '',
      visibility: 'public',
      url: `https://via.placeholder.com/200?text=${encodeURIComponent(session.fileName)}`,
      uploaderName: 'Admin', createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockManagedFiles.push(uploaded);
    mockUploadSessions.delete(body.uploadId);
    return ok(uploaded, '上传成功');
  }),

  // 分片上传：查询进度（断点续传）
  mock(fileContract.uploadStatus, ({ params, ok }) => {
    const session = mockUploadSessions.get(params.uploadId);
    if (!session) return notFound('上传会话不存在');
    return ok({
      uploadId: session.uploadId, status: session.status, chunkSize: session.chunkSize,
      totalChunks: session.totalChunks, received: [...session.received].sort((a, b) => a - b),
    });
  }),

  // 分片上传：中止
  mock(fileContract.uploadAbort, ({ params, ok }) => {
    mockUploadSessions.delete(params.uploadId);
    return ok(null, '已中止');
  }),

  // 文件统计（必须放在 detail 之前，防止 "stats" 被当成文件 ID）
  mock(fileContract.stats, ({ ok }) => {
    const total = mockManagedFiles.length;
    const totalSize = mockManagedFiles.reduce((s, f) => s + (f.size ?? 0), 0);
    const imgExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);
    const videoExts = new Set(['mp4', 'avi', 'mov', 'mkv', 'webm']);
    const audioExts = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac']);
    const docExts = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md']);
    const counts = { image: 0, video: 0, audio: 0, document: 0, other: 0 };
    const sizes = { image: 0, video: 0, audio: 0, document: 0, other: 0 };
    for (const f of mockManagedFiles) {
      const ext = (f.extension ?? '').toLowerCase();
      let cat: keyof typeof counts = 'other';
      if (imgExts.has(ext)) cat = 'image';
      else if (videoExts.has(ext)) cat = 'video';
      else if (audioExts.has(ext)) cat = 'audio';
      else if (docExts.has(ext)) cat = 'document';
      counts[cat]++;
      sizes[cat] += f.size ?? 0;
    }
    const typeLabels: Record<string, string> = { image: '图片', video: '视频', audio: '音频', document: '文档', other: '其他' };
    const typeStats = Object.entries(counts).map(([type, count]) => ({ type, label: typeLabels[type] ?? type, count, size: sizes[type as keyof typeof sizes] }));
    return ok({
      summary: { totalFiles: total, totalSize, imageCount: counts.image, docCount: counts.document, videoCount: counts.video, audioCount: counts.audio, todayCount: 2, thisMonthCount: total },
      typeStats,
      providerStats: [{ provider: 'local', count: total, size: totalSize }],
      monthlyStats: [{ month: '2026-01', count: 3 }, { month: '2026-02', count: total - 3 }],
      uploaderStats: [{ username: 'Admin', count: total, size: totalSize }],
      sizeRangeStats: [{ range: '< 1MB', count: total - 1 }, { range: '1-10MB', count: 1 }, { range: '> 10MB', count: 0 }],
    });
  }),

  // 解析文件访问直链（必须放在 detail 之前）
  mock(fileContract.accessUrl, ({ params, ok }) => {
    const file = mockManagedFiles.find((f) => f.id === params.id);
    if (!file) return notFound('文件不存在');
    return ok({ url: file.directUrl ?? file.url, strategy: file.directUrl ? 'public' : 'proxy', expiresAt: null });
  }),

  // 获取单个文件详情
  mock(fileContract.detail, ({ params, ok }) => {
    const file = mockManagedFiles.find((f) => f.id === params.id);
    if (!file) return notFound('文件不存在');
    return ok(file);
  }),

  // 批量删除文件（静态 /batch 必须早于动态 /{id}）
  mock(fileContract.removeBatch, ({ body, ok }) => {
    let count = 0;
    for (const id of body.ids) {
      const index = mockManagedFiles.findIndex((f) => f.id === id);
      if (index !== -1) {
        mockManagedFiles.splice(index, 1);
        count++;
      }
    }
    return ok(null, `已删除 ${count} 个文件`);
  }),

  // 删除文件
  mock(fileContract.remove, ({ params, ok }) => {
    const index = mockManagedFiles.findIndex((f) => f.id === params.id);
    if (index === -1) return notFound('文件不存在');
    mockManagedFiles.splice(index, 1);
    return ok(null, '删除成功');
  }),

  // ─── 文件存储配置 ───────────────────────────────────────────────────────────

  // 存储配置列表（支持服务端分页）
  mock(fileStorageConfigContract.list, ({ query, ok, paginate }) => {
    const filtered = mockFileStorageConfigs.filter((c) => {
      if (query.status && c.status !== query.status) return false;
      return true;
    });
    const page = paginate(filtered);
    return ok({ ...page, list: page.list.map(stripStorageSecrets) });
  }),

  // 获取默认存储配置（必须在 detail 之前注册，防止 "default" 被当成数字 ID）
  mock(fileStorageConfigContract.defaultConfig, ({ ok }) => {
    const config = mockFileStorageConfigs.find((c) => c.isDefault) ?? null;
    return ok(config ? stripStorageSecrets(config) : null);
  }),

  // 测试存储配置连接（新增表单）
  mock(fileStorageConfigContract.test, ({ ok }) => ok(null, '存储连接测试通过')),

  // 测试已保存存储配置连接（必须在 detail 之前）
  mock(fileStorageConfigContract.testExisting, ({ params, ok }) => {
    requireItem(mockFileStorageConfigs, params.id, '存储配置不存在');
    return ok(null, '存储连接测试通过');
  }),

  // 获取单个存储配置
  mock(fileStorageConfigContract.detail, ({ params, ok }) => {
    const config = requireItem(mockFileStorageConfigs, params.id, '存储配置不存在');
    return ok(stripStorageSecrets(config));
  }),

  // 新增存储配置：body 即 CreateFileStorageConfigInput（已校验、已补默认值）
  mock(fileStorageConfigContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const newConfig: MockFileStorageConfig = {
      ...body,
      id: nextIdFrom(mockFileStorageConfigs),
      publicBaseUrl: body.publicBaseUrl || null,
      createdAt: now,
      updatedAt: now,
    };
    mockFileStorageConfigs.push(newConfig);
    return ok(stripStorageSecrets(newConfig), '新增成功');
  }),

  // 更新存储配置
  mock(fileStorageConfigContract.update, ({ params, body, ok }) => {
    const config = requireItem(mockFileStorageConfigs, params.id, '存储配置不存在');
    // 密钥留空表示不修改，删除空密钥字段后再合并（write-only）
    const patch: Partial<MockFileStorageConfig> = { ...body, publicBaseUrl: body.publicBaseUrl || null };
    for (const field of STORAGE_SECRET_FIELDS) {
      if (!patch[field]) delete patch[field];
    }
    Object.assign(config, patch, { updatedAt: mockDateTime() });
    return ok(stripStorageSecrets(config), '更新成功');
  }),

  // 删除存储配置
  mock(fileStorageConfigContract.remove, ({ params, ok }) => {
    requireItem(mockFileStorageConfigs, params.id, '存储配置不存在');
    removeByIds(mockFileStorageConfigs, [params.id]);
    return ok(null, '删除成功');
  }),

  // 设置默认存储
  mock(fileStorageConfigContract.setDefault, ({ params, ok }) => {
    const target = requireItem(mockFileStorageConfigs, params.id, '存储配置不存在');
    mockFileStorageConfigs.forEach((c) => { c.isDefault = c.id === params.id; });
    return ok(stripStorageSecrets(target), '默认文件服务已更新');
  }),
];
