/**
 * 权限清单对账测试（seed ↔ 后端 guard 契约防漂移）
 *
 * 扫描 `src/routes/**` 中所有 `guard({ permission: ... })` 引用的权限码，
 * 断言每一个都能在 `@zenith/shared` 的 SEED_MENUS（菜单/按钮 permission 字段）中找到。
 *
 * 背景：权限码由菜单驱动分配——后端引用了 seed 中不存在的权限码时，
 * 除平台超管外**任何角色都无法获得该权限**（曾出现 system:user:assign 缺口导致
 * 用户授权功能对非超管完全不可用）。该测试在 CI 中拦截此类契约漂移。
 *
 * 新增权限码的正确姿势：先在 packages/shared/src/seed-data.ts 对应菜单下补按钮
 * （permission 字段），再在路由 guard 中引用。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { SEED_MENUS } from '@zenith/shared';

const ROUTES_DIR = join(__dirname, '..', 'routes');

function collectRouteFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectRouteFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      result.push(full);
    }
  }
  return result;
}

/** 提取一个路由文件中 guard 引用的全部权限码（单个字符串 + 数组两种写法） */
function extractPermissions(content: string): string[] {
  const codes: string[] = [];
  for (const m of content.matchAll(/permission:\s*'([^']+)'/g)) {
    codes.push(m[1]);
  }
  for (const m of content.matchAll(/permission:\s*\[([^\]]+)\]/g)) {
    for (const p of m[1].matchAll(/'([^']+)'/g)) {
      codes.push(p[1]);
    }
  }
  return codes.filter((c) => c !== '');
}

describe('权限清单对账（routes guard ↔ SEED_MENUS）', () => {
  it('后端 guard 引用的每个权限码都必须在 seed 菜单中声明', () => {
    const seedPermissions = new Set(
      SEED_MENUS.map((m) => m.permission).filter((p): p is string => !!p),
    );
    expect(seedPermissions.size).toBeGreaterThan(0);

    const missingByFile = new Map<string, string[]>();
    for (const file of collectRouteFiles(ROUTES_DIR)) {
      const content = readFileSync(file, 'utf-8');
      const missing = [...new Set(extractPermissions(content))].filter((c) => !seedPermissions.has(c));
      if (missing.length > 0) {
        missingByFile.set(file.replace(ROUTES_DIR, 'routes'), missing);
      }
    }

    const report = [...missingByFile.entries()]
      .map(([file, codes]) => `  ${file}: ${codes.join(', ')}`)
      .join('\n');
    expect(
      missingByFile.size,
      `以下路由引用的权限码未在 packages/shared/src/seed-data.ts 的 SEED_MENUS 中声明，`
      + `除平台超管外任何角色都无法获得这些权限（请先补 seed 按钮再引用）：\n${report}`,
    ).toBe(0);
  });
});
