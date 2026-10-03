import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { laterActivationsWhere } from './activation-order';
import { tenantScope } from '../../../lib/tenant';
import { workflowNodeActivations } from '../../../db/schema';
vi.mock('../../../lib/tenant', () => ({ tenantScope: vi.fn(() => undefined) }));
afterEach(() => vi.mocked(tenantScope).mockReturnValue(undefined));

const dialect = new PgDialect({ casing: 'snake_case' });

// 回归锚点：撤回的「后续节点」判定曾用 JS 侧 gt(createdAt, entered.createdAt)——
// 微秒精度的 timestamp 经 JS Date 往返只剩毫秒，回传参数被截断，本 activation 自身恒被
// 算进 later → 任何已办任务撤回必然 400「后续节点已被处理」。
describe('laterActivationsWhere', () => {
  it('与本 activation 的 created_at 做 SQL 侧同列比较，参数中不含 Date', () => {
    const condition = laterActivationsWhere(304, 'd7dcec8c-b93b-46f6-8dd7-b226e9a4e2d5');
    const { sql, params } = dialect.sqlToQuery(condition);

    expect(sql.replace(/\s+/g, ' ')).toContain('"workflow_node_activations"."created_at" > (select "created_at"');
    expect(sql).toContain('"workflow_node_activations"."instance_id" = $3');
    expect(params).toEqual([304, 'd7dcec8c-b93b-46f6-8dd7-b226e9a4e2d5', 304]);
    expect(params.some((param) => param instanceof Date)).toBe(false);
  });
  it('applies the same tenant scope to the anchor and the later activation rows', () => {
    vi.mocked(tenantScope).mockReturnValue(eq(workflowNodeActivations.tenantId, 17));
    const { sql, params } = dialect.sqlToQuery(laterActivationsWhere(304, 'activation'));
    expect(sql.match(/"tenant_id"/g)).toHaveLength(2);
    expect(params.filter(value => value === 17)).toHaveLength(2);
  });
});
