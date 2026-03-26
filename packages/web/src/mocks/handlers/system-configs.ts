import { http, HttpResponse } from 'msw';
import { mockSystemConfigs } from '../data/system';
import type { SystemConfig } from '@zenith/shared';

export const systemConfigsHandlers = [
  // 密码策略（公开，无需鉴权）
  http.get('/api/system-configs/password-policy', () => {
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: { minLength: 6, requireUppercase: false, requireSpecialChar: false },
    });
  }),

  // 系统参数列表
  http.get('/api/system-configs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';

    let list = mockSystemConfigs.filter((c) => {
      if (keyword && !c.configKey.includes(keyword) && !c.description.includes(keyword)) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 通过 key 查询公开配置（无需鉴权）
  http.get('/api/system-configs/public/:key', ({ params }) => {
    const config = mockSystemConfigs.find((c) => c.configKey === params.key);
    if (!config) return HttpResponse.json({ code: 404, message: '配置不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: config });
  }),

  // 获取单个配置
  http.get('/api/system-configs/:id', ({ params }) => {
    const config = mockSystemConfigs.find((c) => c.id === Number(params.id));
    if (!config) return HttpResponse.json({ code: 404, message: '配置不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: config });
  }),

  // 新增配置
  http.post('/api/system-configs', async ({ request }) => {
    const body = await request.json() as Partial<SystemConfig>;
    const newConfig: SystemConfig = {
      id: mockSystemConfigs.length > 0 ? Math.max(...mockSystemConfigs.map((c) => c.id)) + 1 : 1,
      configKey: body.configKey ?? '',
      configValue: body.configValue ?? '',
      configType: body.configType ?? 'string',
      description: body.description ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockSystemConfigs.push(newConfig);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newConfig });
  }),

  // 更新配置
  http.put('/api/system-configs/:id', async ({ params, request }) => {
    const config = mockSystemConfigs.find((c) => c.id === Number(params.id));
    if (!config) return HttpResponse.json({ code: 404, message: '配置不存在', data: null });
    const body = await request.json() as Partial<SystemConfig>;
    Object.assign(config, body, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: config });
  }),

  // 删除配置
  http.delete('/api/system-configs/:id', ({ params }) => {
    const index = mockSystemConfigs.findIndex((c) => c.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '配置不存在', data: null });
    mockSystemConfigs.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
