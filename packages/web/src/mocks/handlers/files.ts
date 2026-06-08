import { http, HttpResponse } from 'msw';
import { mockFileStorageConfigs } from '@/mocks/data/system';
import { mockDateTime } from '@/mocks/utils/date';
import type { FolderEntry, ManagedFile, FileStorageConfig, StorageBrowseResult } from '@zenith/shared';

export const mockManagedFiles: ManagedFile[] = [
  {
    id: 1,
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'demo-avatar.png',
    objectKey: 'uploads/2026/01/demo-avatar.png',
    size: 102400,
    mimeType: 'image/png',
    extension: 'png',
    url: 'https://avatars.githubusercontent.com/u/583231',
    uploaderName: 'Admin',
    createdAt: '2026-01-10 10:00:00',
    updatedAt: '2026-01-10 10:00:00',
  },
  {
    id: 2,
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'report-2026.pdf',
    objectKey: 'uploads/2026/01/report-2026.pdf',
    size: 512000,
    mimeType: 'application/pdf',
    extension: 'pdf',
    url: '/api/files/2/content',
    uploaderName: 'Admin',
    createdAt: '2026-01-15 14:30:00',
    updatedAt: '2026-01-15 14:30:00',
  },
  {
    id: 3,
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'intro.mp4',
    objectKey: 'uploads/2026/02/intro.mp4',
    size: 10240000,
    mimeType: 'video/mp4',
    extension: 'mp4',
    url: '/api/files/3/content',
    uploaderName: 'Admin',
    createdAt: '2026-02-05 09:00:00',
    updatedAt: '2026-02-05 09:00:00',
  },
  {
    id: 4,
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'banner.jpg',
    objectKey: 'uploads/2026/02/banner.jpg',
    size: 204800,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    url: 'https://picsum.photos/800/300',
    uploaderName: 'Admin',
    createdAt: '2026-02-10 11:00:00',
    updatedAt: '2026-02-10 11:00:00',
  },
  {
    id: 5,
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'data-export.xlsx',
    objectKey: 'uploads/2026/03/data-export.xlsx',
    size: 81920,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
    url: '/api/files/5/content',
    uploaderName: 'Admin',
    createdAt: '2026-03-01 08:00:00',
    updatedAt: '2026-03-01 08:00:00',
  },
  {
    id: 6,
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'logo.png',
    objectKey: 'uploads/logo.png',
    size: 30720,
    mimeType: 'image/png',
    extension: 'png',
    url: 'https://avatars.githubusercontent.com/u/9919',
    uploaderName: 'Admin',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  },
];

let nextFileId = mockManagedFiles.length + 1;

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
        id: nextFileId++,
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
      id: nextFileId++,
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

  // 获取 Excel 表格预览数据（必须放在 /api/files/:id 之前）
  http.get('/api/files/:id/sheet-preview', ({ params }) => {
    const file = mockManagedFiles.find((f) => f.id === Number(params.id));
    if (!file) return HttpResponse.json({ code: 404, message: '文件不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: { ...mockSheetPreview, name: file.originalName } });
  }),

  // 获取单个文件详情
  http.get('/api/files/:id', ({ params }) => {
    const file = mockManagedFiles.find((f) => f.id === Number(params.id));
    if (!file) return HttpResponse.json({ code: 404, message: '文件不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: file });
  }),

  // 删除文件
  http.delete('/api/files/:id', ({ params }) => {
    const index = mockManagedFiles.findIndex((f) => f.id === Number(params.id));
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
      const index = mockManagedFiles.findIndex((f) => f.id === id);
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
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 获取单个存储配置
  http.get('/api/file-storage-configs/:id', ({ params }) => {
    const config = mockFileStorageConfigs.find((c) => c.id === Number(params.id));
    if (!config) return HttpResponse.json({ code: 404, message: '存储配置不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: config });
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
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockFileStorageConfigs.push(newConfig);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newConfig });
  }),

  // 更新存储配置
  http.put('/api/file-storage-configs/:id', async ({ params, request }) => {
    const config = mockFileStorageConfigs.find((c) => c.id === Number(params.id));
    if (!config) return HttpResponse.json({ code: 404, message: '存储配置不存在', data: null });
    const body = await request.json() as Partial<FileStorageConfig>;
    Object.assign(config, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: config });
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
