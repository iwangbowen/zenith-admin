import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { defineRouteDomain, type Mount, type RouteDomain } from './_kit';

const router = new Hono();

describe('路由域 License 分类防漏', () => {
  it('新接口自动继承授权域；公开豁免保持原有挂载顺序', () => {
    const domain = defineRouteDomain({
      name: 'marketing',
      licensing: { feature: 'growth' },
      mounts: () => [
        ['/api/marketing', router],
        ['/api/marketing/new-resource', router],
        ['/s', router, { licenseExempt: '已发布短链继续跳转' }],
      ],
    });
    expect(domain.mounts()).toEqual([
      ['/api/marketing', router, { feature: 'growth' }],
      ['/api/marketing/new-resource', router, { feature: 'growth' }],
      ['/s', router, { licenseExempt: '已发布短链继续跳转' }],
    ]);
  });

  it('核心域的授权子功能可以单独声明', () => {
    const domain = defineRouteDomain({
      name: 'platform',
      licensing: { core: '平台基础能力' },
      mounts: () => [
        ['/api/licensing', router],
        ['/api/rules', router, { feature: 'rules' }],
      ],
    });
    expect(domain.mounts()).toEqual([
      ['/api/licensing', router],
      ['/api/rules', router, { feature: 'rules' }],
    ]);
  });

  it.each([
    {},
    { licensing: { core: ' ' } },
    { licensing: { feature: 'not-registered' } },
    { licensing: { feature: 'iot', core: '不能同时属于核心与授权功能' } },
  ])('拒绝未分类或分类无效的新模块：%j', (config) => {
    expect(() => defineRouteDomain({ name: 'new-module', mounts: () => [], ...config } as RouteDomain)).toThrow(/License/);
  });

  it.each([
    { licenseExempt: ' ' },
    { licenseExempt: '不能同时放行与门控', feature: 'iot' },
    { feature: 'not-registered' },
  ])('拒绝无效挂载分类：%j', (options) => {
    const domain = defineRouteDomain({
      name: 'iot',
      licensing: { feature: 'iot' },
      mounts: () => [['/api/iot', router, options] as Mount],
    });
    expect(() => domain.mounts()).toThrow(/License/);
  });

  it('前台兜底必须明确豁免，防止把整个站点隐式变成授权域', () => {
    const domain = defineRouteDomain({
      name: 'cms',
      licensing: { feature: 'cms' },
      mounts: () => [],
      fallback: () => [['/', router]],
    });
    expect(() => domain.fallback?.()).toThrow(/License 豁免/);
    const publicDomain = defineRouteDomain({
      name: 'cms',
      licensing: { feature: 'cms' },
      mounts: () => [],
      fallback: () => [['/', router, { licenseExempt: '已发布网站继续可达' }]],
    });
    expect(publicDomain.fallback?.()[0]?.[2]?.feature).toBeUndefined();
  });
});
