/**
 * 契约访问声明（`access`）的全局不变量：登录令牌操作必须声明 access、权限码必须在注册表、
 * 非登录令牌操作不得声明 access。构造期（`defineContract`）已逐条拒绝违规，这里对全部契约做一次总检。
 */
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from './permissions';
import { cmsDashboardContract, cmsOperationsContract } from './cms';
import { accessPermissions, type OperationAccess } from './core/contract';
import { CONTRACTS_BY_DOMAIN, listAllOperations } from './contracts';

describe('契约访问声明', () => {
  const operations = listAllOperations();

  it('每个域的契约导出都已收录进 CONTRACTS_BY_DOMAIN，且方法 + 路径全局唯一', () => {
    for (const [domain, contracts] of Object.entries(CONTRACTS_BY_DOMAIN)) {
      expect(contracts.length, `${domain} 没有收集到任何契约组`).toBeGreaterThan(0);
    }
    const keys = operations.map((o) => `${o.op.method} ${o.op.fullPath}`);
    expect(new Set(keys).size, '同一方法 + 路径出现在多个契约操作上').toBe(keys.length);
  });

  it('登录令牌操作全部声明了 access', () => {
    const undeclared = operations
      .filter(({ op }) => op.security === 'bearer' && op.access === undefined)
      .map(({ op }) => `${op.method.toUpperCase()} ${op.fullPath}`);
    expect(undeclared).toEqual([]);
  });

  it('access 引用的权限码都在注册表', () => {
    const unknown: string[] = [];
    for (const { op } of operations) {
      for (const code of accessPermissions(op.access as OperationAccess | undefined)) {
        if (!ALL_PERMISSIONS[code]) unknown.push(`${op.method} ${op.fullPath} → ${code}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('非登录令牌操作不声明 access（构造期已拒绝，此处兜底）', () => {
    const invalid = operations.filter(({ op }) => op.security !== 'bearer' && op.access !== undefined).map(({ op }) => op.fullPath);
    expect(invalid).toEqual([]);
  });

  it('CMS 数据看板与内容工作台使用独立访问权限', () => {
    expect(accessPermissions(cmsDashboardContract.stats.access)).toEqual(['cms:dashboard:view']);
    expect(accessPermissions(cmsOperationsContract.workspace.access)).toEqual([
      'cms:content:list', 'cms:form:list', 'cms:editorial-task:manage',
    ]);
    expect(accessPermissions(cmsOperationsContract.tasks.access)).toEqual(['cms:editorial-task:manage']);
    expect(accessPermissions(cmsOperationsContract.taskDetail.access)).toEqual(['cms:editorial-task:manage']);
  });

  it('会员前台契约组整组使用会员令牌，不与后台令牌混用', () => {
    const memberOps = operations.filter(({ op }) => op.fullPath.startsWith('/api/member/') || op.fullPath === '/api/member');
    expect(memberOps.length).toBeGreaterThan(0);
    const wrong = memberOps.filter(({ op }) => op.security === 'bearer').map(({ op }) => `${op.method} ${op.fullPath}`);
    expect(wrong).toEqual([]);
  });
});
