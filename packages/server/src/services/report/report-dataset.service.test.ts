/**
 * 报表数据集纯函数单测：
 * resolveDatasetParams（默认值 + 类型强转 + 必填校验）；
 * buildExternalParamSql（${name} → 占位符 + values，参数化防注入，多方言）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { resolveDatasetParams, buildExternalParamSql, applyRowRulesToSql, buildSystemParams } from './report-dataset.service';
import { coercePostgresNumericRows } from './report-dataset-execution.service';
import { runWithCurrentUser } from '../../lib/context';
import { config } from '../../config';
import type { ReportDatasetParam } from '@zenith/shared/report';
import type { JwtPayload } from '../../middleware/auth';

describe('resolveDatasetParams', () => {
  it('未提供时套用默认值（默认值不强转）', () => {
    const defs: ReportDatasetParam[] = [{ name: 's', label: '状态', type: 'string', defaultValue: 'on' }];
    expect(resolveDatasetParams(defs, {})).toEqual({ s: 'on' });
  });
  it('按类型强转：number / boolean / string', () => {
    const defs: ReportDatasetParam[] = [
      { name: 'n', label: 'N', type: 'number' },
      { name: 'b', label: 'B', type: 'boolean' },
      { name: 's', label: 'S', type: 'string' },
    ];
    expect(resolveDatasetParams(defs, { n: '5', b: 'true', s: 123 })).toEqual({ n: 5, b: true, s: '123' });
    expect(resolveDatasetParams(defs, { n: 'x', b: '0' })).toMatchObject({ n: null, b: false });
  });
  it('空串视为未提供，套默认值', () => {
    const defs: ReportDatasetParam[] = [{ name: 's', label: 'S', type: 'string', defaultValue: 'def' }];
    expect(resolveDatasetParams(defs, { s: '' })).toEqual({ s: 'def' });
  });
  it('必填缺失抛 400', () => {
    const defs: ReportDatasetParam[] = [{ name: 'r', label: '必填', type: 'string', required: true }];
    expect(() => resolveDatasetParams(defs, {})).toThrow(HTTPException);
  });
  it('拒绝未声明的运行参数', () => {
    expect(() => resolveDatasetParams([], { extra: 1 })).toThrow(HTTPException);
  });
  it('剥离 __ 前缀的客户端伪造系统变量', () => {
    const defs: ReportDatasetParam[] = [{ name: 'ok', label: 'ok', type: 'number' }];
    expect(resolveDatasetParams(defs, { __userId: 999, ok: 1 })).toEqual({ ok: 1 });
  });
});

describe('coercePostgresNumericRows', () => {
  it('restores PostgreSQL numeric columns while preserving text identifiers', () => {
    expect(coercePostgresNumericRows(
      [{ amount: '20000.00', orderNo: '00123' }],
      [{ name: 'amount', type: 1700 }, { name: 'orderNo', type: 25 }],
    )).toEqual([{ amount: 20000, orderNo: '00123' }]);
  });
});

describe('applyRowRulesToSql - 行级权限包裹', () => {
  it('无规则原样返回', () => {
    expect(applyRowRulesToSql('SELECT * FROM t', [])).toBe('SELECT * FROM t');
  });
  it('单规则包裹子查询', () => {
    const out = applyRowRulesToSql('SELECT * FROM t;', [{ where: 'dept_id = ${__deptId}' }]);
    expect(out).toBe('SELECT * FROM (\nSELECT * FROM t\n) AS _rls WHERE (dept_id = ${__deptId})');
  });
  it('多规则 OR 合并', () => {
    const out = applyRowRulesToSql('SELECT * FROM t', [{ where: 'a = 1' }, { where: 'b = 2' }]);
    expect(out).toContain('WHERE (a = 1) OR (b = 2)');
  });
  it('原 SQL 尾分号被剥离（防拼接多语句）', () => {
    const out = applyRowRulesToSql('SELECT 1;  ', [{ where: 'x > 0' }]);
    expect(out).not.toContain(';');
  });
});

describe('buildExternalParamSql - 参数化防注入', () => {
  const text = 'SELECT * FROM t WHERE name = ${name} AND age > ${age}';

  it('PostgreSQL → $N 占位符 + values 顺序', () => {
    const r = buildExternalParamSql(text, { name: 'A', age: 18 }, 'postgresql');
    expect(r.text).toBe('SELECT * FROM t WHERE name = $1 AND age > $2');
    expect(r.values).toEqual(['A', 18]);
  });
  it('MySQL → ? 占位符', () => {
    const r = buildExternalParamSql(text, { name: 'A', age: 18 }, 'mysql');
    expect(r.text).toBe('SELECT * FROM t WHERE name = ? AND age > ?');
    expect(r.values).toEqual(['A', 18]);
  });
  it('SQL Server → @pN 占位符', () => {
    const r = buildExternalParamSql(text, { name: 'A', age: 18 }, 'sqlserver');
    expect(r.text).toBe('SELECT * FROM t WHERE name = @p0 AND age > @p1');
    expect(r.values).toEqual(['A', 18]);
  });
  it('注入字符串进入 values 而非内联到 SQL', () => {
    const evil = "x'; DROP TABLE users; --";
    const r = buildExternalParamSql('SELECT * FROM t WHERE n = ${name}', { name: evil }, 'postgresql');
    expect(r.text).toBe('SELECT * FROM t WHERE n = $1');
    expect(r.text).not.toContain('DROP TABLE');
    expect(r.values).toEqual([evil]);
  });
  it('未提供的参数置 null', () => {
    const r = buildExternalParamSql('SELECT ${a}', {}, 'mysql');
    expect(r.values).toEqual([null]);
  });
  it('无参数时原样返回，values 为空', () => {
    const r = buildExternalParamSql('SELECT 1', {}, 'postgresql');
    expect(r.text).toBe('SELECT 1');
    expect(r.values).toEqual([]);
  });
});

describe('buildSystemParams - __tenantId 系统变量安全（行为中心阶段1 报表接入）', () => {
  const superAdmin: JwtPayload = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };

  beforeEach(() => {
    config.multiTenantMode = true;
  });

  it('SQL 未引用任何系统变量时不注入任何值（公共数据集结果可跨用户复用）', async () => {
    await runWithCurrentUser(superAdmin, async () => {
      expect(await buildSystemParams('SELECT 1')).toEqual({});
    });
  });

  it('普通租户用户：__tenantId 取自身 tenantId', async () => {
    const user: JwtPayload = { userId: 2, username: 'u', roles: ['user'], tenantId: 5 };
    await runWithCurrentUser(user, async () => {
      const params = await buildSystemParams('SELECT * FROM t WHERE (${__tenantId}::int IS NULL OR tenant_id=${__tenantId})');
      expect(params.__tenantId).toBe(5);
    });
  });

  it('平台超管未切换租户视角：__tenantId 为 null（平台视角，可见全部租户，不泄露/不误限定单一租户）', async () => {
    await runWithCurrentUser(superAdmin, async () => {
      const params = await buildSystemParams('SELECT ${__tenantId}');
      expect(params.__tenantId).toBeNull();
    });
  });

  it('平台超管切换到指定租户视角：__tenantId 使用 viewingTenantId，而非 null 或超管自身 tenantId', async () => {
    const viewing: JwtPayload = { ...superAdmin, viewingTenantId: 7 };
    await runWithCurrentUser(viewing, async () => {
      const params = await buildSystemParams('SELECT ${__tenantId}');
      expect(params.__tenantId).toBe(7);
    });
  });

  it('multiTenantMode 关闭时 __tenantId 恒为 null，即使用户带 tenantId', async () => {
    config.multiTenantMode = false;
    const user: JwtPayload = { userId: 3, username: 'u2', roles: ['user'], tenantId: 9 };
    await runWithCurrentUser(user, async () => {
      const params = await buildSystemParams('SELECT ${__tenantId}');
      expect(params.__tenantId).toBeNull();
    });
  });

  it('未登录（无上下文用户）时 __tenantId 为 null，而非抛错', async () => {
    expect(await buildSystemParams('SELECT ${__tenantId}')).toEqual({ __tenantId: null });
  });
});
