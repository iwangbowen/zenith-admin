import { systemConfigContract, type SystemConfig } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockSystemConfigs } from '@/mocks/data/system';
import { mockDateTime } from '@/mocks/utils/date';

export const systemConfigsHandlers = [
  // 密码策略（公开，无需鉴权）
  mock(systemConfigContract.passwordPolicy, ({ ok }) => {
    return ok({ minLength: 6, requireUppercase: false, requireSpecialChar: false }, 'success');
  }),

  // 系统参数列表
  mock(systemConfigContract.list, ({ query, ok, paginate }) => {
    const { keyword, configType, keys } = query;

    // 精确批量查询模式（不分页）
    if (keys) {
      const keyList = keys.split(',').map((k) => k.trim()).filter(Boolean);
      const list = mockSystemConfigs.filter((c) => keyList.includes(c.configKey));
      return ok({ list, total: list.length, page: 1, pageSize: list.length });
    }

    const list = mockSystemConfigs.filter((c) => {
      if (keyword && !c.configKey.includes(keyword) && !c.configName.includes(keyword) && !c.description.includes(keyword)) return false;
      if (configType && c.configType !== configType) return false;
      return true;
    });
    return ok(paginate(list));
  }),

  // 通过 key 查询公开配置（无需鉴权）
  mock(systemConfigContract.publicByKey, ({ params, ok }) => {
    const config = mockSystemConfigs.find((c) => c.configKey === params.key);
    if (!config) return notFound('配置不存在');
    return ok({ configKey: config.configKey, configValue: config.configValue, configType: config.configType });
  }),

  // 获取单个配置
  mock(systemConfigContract.detail, ({ params, ok }) => {
    const config = mockSystemConfigs.find((c) => c.id === params.id);
    if (!config) return notFound('配置不存在');
    return ok(config);
  }),

  // 新增配置
  mock(systemConfigContract.create, ({ body, ok }) => {
    const newConfig: SystemConfig = {
      id: nextIdFrom(mockSystemConfigs),
      configKey: body.configKey,
      configName: body.configName,
      configValue: body.configValue,
      configType: body.configType,
      description: body.description,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockSystemConfigs.push(newConfig);
    return ok(newConfig, '新增成功');
  }),

  // 更新配置
  mock(systemConfigContract.update, ({ params, body, ok }) => {
    const config = mockSystemConfigs.find((c) => c.id === params.id);
    if (!config) return notFound('配置不存在');
    Object.assign(config, body, { updatedAt: mockDateTime() });
    return ok(config, '更新成功');
  }),

  // 删除配置
  mock(systemConfigContract.remove, ({ params, ok }) => {
    const index = mockSystemConfigs.findIndex((c) => c.id === params.id);
    if (index === -1) return notFound('配置不存在');
    mockSystemConfigs.splice(index, 1);
    return ok(null, '删除成功');
  }),
];
