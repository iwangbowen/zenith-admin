import { describe, expect, it } from 'vitest';
import { PERMISSION_REGISTRY_BY_DOMAIN, ALL_PERMISSIONS } from './permissions';
import { CMS_PERMISSIONS } from './cms/permissions';
import { SEED_MENUS } from './seed/menus';

describe('权限码注册表', () => {
  it('权限码跨域唯一', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const [domain, registry] of Object.entries(PERMISSION_REGISTRY_BY_DOMAIN)) {
      for (const code of Object.keys(registry)) {
        const prev = seen.get(code);
        if (prev) dup.push(`${code} (${prev} / ${domain})`);
        seen.set(code, domain);
      }
    }
    expect(dup).toEqual([]);
    expect(Object.keys(ALL_PERMISSIONS).length).toBe(seen.size);
  });

  it('权限码为冒号分段的小写标识，标题非空', () => {
    for (const [code, meta] of Object.entries(ALL_PERMISSIONS)) {
      expect(code, code).toMatch(/^[a-z][a-z0-9-]*(?::[a-zA-Z0-9-]+){1,3}$/);
      expect(meta.label.trim().length, code).toBeGreaterThan(0);
    }
  });

  it('CMS 页面访问权限覆盖独立看板、统计与内容工作台入口', () => {
    expect(CMS_PERMISSIONS['cms:dashboard:view'].menu).toBe('CmsDashboard');
    expect(CMS_PERMISSIONS['cms:site:list'].menu).toEqual(['CmsSites', 'CmsDashboard', 'CmsStats', 'CmsWorkspace']);
    expect(CMS_PERMISSIONS['cms:content:list'].menu).toEqual(['CmsContents', 'CmsContentEdit', 'CmsWorkspace']);
    expect(CMS_PERMISSIONS['cms:form:list'].menu).toEqual(['CmsForms', 'CmsWorkspace']);
    expect(CMS_PERMISSIONS['cms:editorial-task:manage'].menu).toBe('CmsWorkspace');
    expect(SEED_MENUS.find((menu) => menu.name === 'CmsWorkspace')).toMatchObject({
      path: '/cms/workspace',
      component: 'cms/CmsWorkspacePage',
    });
  });

  it('menu / id / sort 数组按位置对应', () => {
    for (const [code, meta] of Object.entries(ALL_PERMISSIONS)) {
      const menus = typeof meta.menu === 'string' ? [meta.menu] : meta.menu;
      expect(menus.length, code).toBeGreaterThan(0);
      expect(new Set(menus).size, `${code} 重复挂到同一页面`).toBe(menus.length);
      if (Array.isArray(meta.id)) expect(meta.id.length, code).toBe(menus.length);
      if (Array.isArray(meta.sort)) expect(meta.sort.length, code).toBe(menus.length);
    }
  });

  it('每个权限码都生成了 button 节点，且 button 只来自注册表', () => {
    const buttons = SEED_MENUS.filter((m) => m.type === 'button');
    const generatedCodes = new Set(buttons.map((b) => b.permission));
    for (const code of Object.keys(ALL_PERMISSIONS)) expect(generatedCodes.has(code), code).toBe(true);
    for (const b of buttons) expect(ALL_PERMISSIONS[b.permission ?? ''], `按钮 ${b.id} 的权限码 ${b.permission} 不在注册表`).toBeDefined();
    // 每个按钮的父级都是已声明的页面
    const pageIds = new Set(SEED_MENUS.filter((m) => m.type !== 'button').map((m) => m.id));
    for (const b of buttons) expect(pageIds.has(b.parentId), `按钮 ${b.id} 父级 ${b.parentId}`).toBe(true);
  });

  it('菜单 id 全局唯一且 button 不越入手工菜单 id 区间', () => {
    const ids = SEED_MENUS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBeLessThan(100_000);
  });
});
