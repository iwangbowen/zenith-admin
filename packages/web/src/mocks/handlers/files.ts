import { http, HttpResponse } from 'msw';
import { mockFileStorageConfigs } from '@/mocks/data/system';
import { mockDateTime } from '@/mocks/utils/date';
import type { FolderEntry, ManagedFile, FileStorageConfig, StorageBrowseResult } from '@zenith/shared';

function mockUuidV7() {
  const timeHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const rand = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${rand().slice(1)}-${((8 + Math.floor(Math.random() * 4)).toString(16) + rand().slice(1))}-${rand()}${rand()}${rand()}`;
}

export const mockManagedFiles: ManagedFile[] = [
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
    url: '/api/files/018f6f8a-0001-7000-8000-000000000001/content',
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
    url: '/api/files/018f6f8a-0002-7000-8000-000000000002/content',
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
    url: '/api/files/018f6f8a-0003-7000-8000-000000000003/content',
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
    url: '/api/files/018f6f8a-0004-7000-8000-000000000004/content',
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
    url: '/api/files/018f6f8a-0005-7000-8000-000000000005/content',
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
    url: '/api/files/018f6f8a-0006-7000-8000-000000000006/content',
    directUrl: 'https://avatars.githubusercontent.com/u/9919',
    uploaderName: 'Admin',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  },
];


// demo 模式下的静态 Excel 预览数据（Univer IWorkbookData 子集）
const mockSheetPreview = {
  id: 'preview-demo',
  name: 'data-export.xlsx',
  appVersion: '0.1.0',
  sheetOrder: ['sheet-1'],
  styles: {
    s1: { bl: 1, bg: { rgb: '#1A7F37' }, cl: { rgb: '#FFFFFF' }, ht: 2, vt: 2 },
  },
  sheets: {
    'sheet-1': {
      id: 'sheet-1',
      name: '销售数据',
      rowCount: 50,
      columnCount: 26,
      defaultColumnWidth: 88,
      defaultRowHeight: 24,
      mergeData: [],
      cellData: {
        0: {
          0: { v: '产品', t: 1, s: 's1' },
          1: { v: '销量', t: 1, s: 's1' },
          2: { v: '金额（元）', t: 1, s: 's1' },
        },
        1: { 0: { v: '苹果', t: 1 }, 1: { v: 120, t: 2 }, 2: { v: 2400, t: 2 } },
        2: { 0: { v: '香蕉', t: 1 }, 1: { v: 80, t: 2 }, 2: { v: 960, t: 2 } },
        3: { 0: { v: '橙子', t: 1 }, 1: { v: 200, t: 2 }, 2: { v: 3000, t: 2 } },
        4: { 0: { v: '合计', t: 1, s: 's1' }, 1: { v: 400, t: 2 }, 2: { v: 6360, t: 2 } },
      },
      rowData: {},
      columnData: { 0: { w: 120 }, 1: { w: 100 }, 2: { w: 120 } },
    },
  },
};

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

const STORAGE_SECRET_FIELDS = [
  'ossAccessKeySecret', 's3SecretAccessKey', 'cosSecretKey',
  'obsSecretAccessKey', 'kodoSecretKey', 'bosSecretAccessKey',
  'azureAccountKey', 'sftpPassword', 'sftpPrivateKey',
] as const;

/** 模拟后端：列表/详情一律不返回密钥字段 */
function stripStorageSecrets(config: FileStorageConfig): FileStorageConfig {
  const clone = { ...config };
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
  status: 'uploading' | 'completed' | 'aborted';
}
const mockUploadSessions = new Map<string, MockUploadSession>();

export const filesHandlers = [
  // 文件列表（分页）
  http.get('/api/files', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';

    let list = mockManagedFiles.filter((f) => {
      if (keyword && !f.originalName.includes(keyword)) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 按存储配置浏览文件目录（必须放在 /api/files/:id 之前）
  http.get('/api/files/browse', ({ request }) => {
    const url = new URL(request.url);
    const storageConfigId = Number(url.searchParams.get('storageConfigId'));
    const path = url.searchParams.get('path') ?? '';
    if (!storageConfigId) return HttpResponse.json({ code: 400, message: '参数错误', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: buildBrowseResult(storageConfigId, path) });
  }),

  // 上传文件（demo 模式支持多文件）
  http.post('/api/files/upload', async ({ request }) => {
    const formData = await request.formData();
    const files = formData.getAll('file') as File[];
    const uploadedFiles: ManagedFile[] = files.map((file) => {
      const uploaded: ManagedFile = {
        id: mockUuidV7(),
        storageConfigId: 1,
        storageName: '本地磁盘',
        provider: 'local',
        originalName: file?.name ?? 'unknown',
        objectKey: `uploads/${Date.now()}-${file?.name ?? 'file'}`,
        size: file?.size ?? 0,
        mimeType: file?.type ?? 'application/octet-stream',
        extension: file?.name?.split('.').pop() ?? '',
        url: `https://via.placeholder.com/200?text=${encodeURIComponent(file?.name ?? 'file')}`,
        uploaderName: 'Admin',
        createdAt: mockDateTime(),
        updatedAt: mockDateTime(),
      };
      mockManagedFiles.push(uploaded);
      return uploaded;
    });
    return HttpResponse.json({ code: 0, message: `成功上传 ${uploadedFiles.length} 个文件`, data: uploadedFiles });
  }),

  // 上传单个文件
  http.post('/api/files/upload-one', async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return HttpResponse.json({ code: 400, message: '请选择要上传的文件', data: null });
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
      url: `https://via.placeholder.com/200?text=${encodeURIComponent(file.name)}`,
      uploaderName: 'Admin',
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockManagedFiles.push(uploaded);
    return HttpResponse.json({ code: 0, message: '上传成功', data: uploaded });
  }),

  // 分片上传：初始化
  http.post('/api/files/upload/init', async ({ request }) => {
    const body = await request.json() as { fileName: string; fileSize: number; mimeType?: string; chunkSize: number };
    const uploadId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.max(1, Math.ceil(body.fileSize / body.chunkSize));
    mockUploadSessions.set(uploadId, {
      uploadId, fileName: body.fileName, fileSize: body.fileSize, mimeType: body.mimeType,
      chunkSize: body.chunkSize, totalChunks, received: new Set(), status: 'uploading',
    });
    return HttpResponse.json({ code: 0, message: 'ok', data: { uploadId, chunkSize: body.chunkSize, totalChunks, received: [] } });
  }),

  // 分片上传：上传单个分片
  http.post('/api/files/upload/chunk', async ({ request }) => {
    const formData = await request.formData();
    const uploadId = String(formData.get('uploadId') ?? '');
    const index = Number(formData.get('index'));
    const session = mockUploadSessions.get(uploadId);
    if (!session) return HttpResponse.json({ code: 404, message: '上传会话不存在', data: null });
    session.received.add(index);
    return HttpResponse.json({ code: 0, message: 'ok', data: { index, received: [...session.received].sort((a, b) => a - b) } });
  }),

  // 分片上传：完成合并
  http.post('/api/files/upload/complete', async ({ request }) => {
    const body = await request.json() as { uploadId: string };
    const session = mockUploadSessions.get(body.uploadId);
    if (!session) return HttpResponse.json({ code: 404, message: '上传会话不存在', data: null });
    session.status = 'completed';
    const uploaded: ManagedFile = {
      id: mockUuidV7(), storageConfigId: 1, storageName: '本地磁盘', provider: 'local',
      originalName: session.fileName, objectKey: `uploads/${Date.now()}-${session.fileName}`,
      size: session.fileSize, mimeType: session.mimeType ?? 'application/octet-stream',
      extension: session.fileName.split('.').pop() ?? '',
      url: `https://via.placeholder.com/200?text=${encodeURIComponent(session.fileName)}`,
      uploaderName: 'Admin', createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockManagedFiles.push(uploaded);
    mockUploadSessions.delete(body.uploadId);
    return HttpResponse.json({ code: 0, message: '上传成功', data: uploaded });
  }),

  // 分片上传：查询进度（断点续传）
  http.get('/api/files/upload/:uploadId/status', ({ params }) => {
    const session = mockUploadSessions.get(String(params.uploadId));
    if (!session) return HttpResponse.json({ code: 404, message: '上传会话不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: {
      uploadId: session.uploadId, status: session.status, chunkSize: session.chunkSize,
      totalChunks: session.totalChunks, received: [...session.received].sort((a, b) => a - b),
    } });
  }),

  // 分片上传：中止
  http.delete('/api/files/upload/:uploadId', ({ params }) => {
    mockUploadSessions.delete(String(params.uploadId));
    return HttpResponse.json({ code: 0, message: '已中止', data: null });
  }),

  // 获取 Excel 表格预览数据（必须放在 /api/files/:id 之前）
  http.get('/api/files/:id/sheet-preview', ({ params }) => {
    const file = mockManagedFiles.find((f) => f.id === String(params.id));
    if (!file) return HttpResponse.json({ code: 404, message: '文件不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: { ...mockSheetPreview, name: file.originalName } });
  }),

  // 文件统计（必须放在 /api/files/:id 之前，防止 "stats" 被当成文件 ID）
  http.get('/api/files/stats', () => {
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
    const data = {
      summary: { totalFiles: total, totalSize, imageCount: counts.image, docCount: counts.document, videoCount: counts.video, audioCount: counts.audio, todayCount: 2, thisMonthCount: total },
      typeStats,
      providerStats: [{ provider: 'local', count: total, size: totalSize }],
      monthlyStats: [{ month: '2026-01', count: 3 }, { month: '2026-02', count: total - 3 }],
      uploaderStats: [{ username: 'Admin', count: total, size: totalSize }],
      sizeRangeStats: [{ range: '< 1MB', count: total - 1 }, { range: '1-10MB', count: 1 }, { range: '> 10MB', count: 0 }],
    };
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // 解析文件访问直链（必须放在 /api/files/:id 之前）
  http.get('/api/files/:id/access-url', ({ params }) => {
    const file = mockManagedFiles.find((f) => f.id === String(params.id));
    if (!file) return HttpResponse.json({ code: 404, message: '文件不存在', data: null });
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { url: file.directUrl ?? file.url, strategy: file.directUrl ? 'public' : 'proxy', expiresAt: null },
    });
  }),

  // 获取单个文件详情
  http.get('/api/files/:id', ({ params }) => {
    const file = mockManagedFiles.find((f) => f.id === String(params.id));
    if (!file) return HttpResponse.json({ code: 404, message: '文件不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: file });
  }),

  // 删除文件
  http.delete('/api/files/:id', ({ params }) => {
    const index = mockManagedFiles.findIndex((f) => f.id === String(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '文件不存在', data: null });
    mockManagedFiles.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 批量删除文件
  http.delete('/api/files/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const { ids } = body;
    let count = 0;
    for (const id of ids) {
      const index = mockManagedFiles.findIndex((f) => f.id === String(id));
      if (index !== -1) {
        mockManagedFiles.splice(index, 1);
        count++;
      }
    }
    return HttpResponse.json({ code: 0, message: `已删除 ${count} 个文件`, data: null });
  }),

  // ─── 文件存储配置 ───────────────────────────────────────────────────────────

  // 存储配置列表（支持服务端分页）
  http.get('/api/file-storage-configs', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');
    const filtered = mockFileStorageConfigs.filter((c) => {
      if (status && c.status !== status) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize).map(stripStorageSecrets);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 获取默认存储配置（必须在 /:id 之前注册，防止 "default" 被当成数字 ID）
  http.get('/api/file-storage-configs/default', () => {
    const config = mockFileStorageConfigs.find((c) => c.isDefault) ?? null;
    return HttpResponse.json({ code: 0, message: 'ok', data: config ? stripStorageSecrets(config) : null });
  }),

  // 测试存储配置连接（新增表单）
  http.post('/api/file-storage-configs/test', () => {
    return HttpResponse.json({ code: 0, message: '存储连接测试通过', data: null });
  }),

  // 测试已保存存储配置连接（必须在 /:id 详情之前）
  http.post('/api/file-storage-configs/:id/test', ({ params }) => {
    const config = mockFileStorageConfigs.find((c) => c.id === Number(params.id));
    if (!config) return HttpResponse.json({ code: 404, message: '存储配置不存在', data: null });
    return HttpResponse.json({ code: 0, message: '存储连接测试通过', data: null });
  }),

  // 获取单个存储配置
  http.get('/api/file-storage-configs/:id', ({ params }) => {
    const config = mockFileStorageConfigs.find((c) => c.id === Number(params.id));
    if (!config) return HttpResponse.json({ code: 404, message: '存储配置不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: stripStorageSecrets(config) });
  }),

  // 新增存储配置
  http.post('/api/file-storage-configs', async ({ request }) => {
    const body = await request.json() as Partial<FileStorageConfig>;
    const newConfig: FileStorageConfig = {
      id: mockFileStorageConfigs.length > 0 ? Math.max(...mockFileStorageConfigs.map((c) => c.id)) + 1 : 1,
      name: body.name ?? '',
      provider: body.provider ?? 'local',
      status: body.status ?? 'enabled',
      isDefault: body.isDefault ?? false,
      ...body,
      urlStrategy: body.urlStrategy ?? 'proxy',
      presignedExpirySeconds: body.presignedExpirySeconds ?? 1800,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockFileStorageConfigs.push(newConfig);
    return HttpResponse.json({ code: 0, message: '新增成功', data: stripStorageSecrets(newConfig) });
  }),

  // 更新存储配置
  http.put('/api/file-storage-configs/:id', async ({ params, request }) => {
    const config = mockFileStorageConfigs.find((c) => c.id === Number(params.id));
    if (!config) return HttpResponse.json({ code: 404, message: '存储配置不存在', data: null });
    const body = await request.json() as Partial<FileStorageConfig>;
    // 密钥留空表示不修改，删除空密钥字段后再合并（write-only）
    for (const field of STORAGE_SECRET_FIELDS) {
      if (!body[field]) delete body[field];
    }
    Object.assign(config, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: stripStorageSecrets(config) });
  }),

  // 删除存储配置
  http.delete('/api/file-storage-configs/:id', ({ params }) => {
    const index = mockFileStorageConfigs.findIndex((c) => c.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '存储配置不存在', data: null });
    mockFileStorageConfigs.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 设置默认存储
  http.put('/api/file-storage-configs/:id/default', ({ params }) => {
    mockFileStorageConfigs.forEach((c) => { c.isDefault = c.id === Number(params.id); });
    return HttpResponse.json({ code: 0, message: '设置成功', data: null });
  }),
];
