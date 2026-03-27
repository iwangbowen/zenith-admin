import { http, HttpResponse } from 'msw';
import { mockFileStorageConfigs } from '@/mocks/data/system';
import type { ManagedFile, FileStorageConfig } from '@zenith/shared';

export const mockManagedFiles: ManagedFile[] = [
  {
    id: 1,
    storageConfigId: 1,
    storageName: '本地磁盘',
    provider: 'local',
    originalName: 'demo-avatar.png',
    objectKey: 'uploads/demo-avatar.png',
    size: 102400,
    mimeType: 'image/png',
    extension: 'png',
    url: 'https://avatars.githubusercontent.com/u/583231',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

let nextFileId = 2;

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

  // 上传文件（demo 模式返回固定 URL）
  http.post('/api/files/upload', async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const uploadedFile: ManagedFile = {
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockManagedFiles.push(uploadedFile);
    return HttpResponse.json({ code: 0, message: '上传成功', data: uploadedFile });
  }),

  // 删除文件
  http.delete('/api/files/:id', ({ params }) => {
    const index = mockManagedFiles.findIndex((f) => f.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '文件不存在', data: null });
    mockManagedFiles.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // ─── 文件存储配置 ───────────────────────────────────────────────────────────

  // 存储配置列表
  http.get('/api/file-storage-configs', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: mockFileStorageConfigs });
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
      status: body.status ?? 'active',
      isDefault: body.isDefault ?? false,
      ...body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockFileStorageConfigs.push(newConfig);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newConfig });
  }),

  // 更新存储配置
  http.put('/api/file-storage-configs/:id', async ({ params, request }) => {
    const config = mockFileStorageConfigs.find((c) => c.id === Number(params.id));
    if (!config) return HttpResponse.json({ code: 404, message: '存储配置不存在', data: null });
    const body = await request.json() as Partial<FileStorageConfig>;
    Object.assign(config, body, { updatedAt: new Date().toISOString() });
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
