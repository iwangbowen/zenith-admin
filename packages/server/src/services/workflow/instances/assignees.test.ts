import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/types';
import type { TaskAction } from '../../../lib/workflow-engine';

vi.mock('../workflow-assignee-resolver.service', () => ({ resolveAssigneeIds: vi.fn(async () => []) }));

import { applyAssigneeRuntimeStrategies } from './assignees';

const dialect = new PgDialect({ casing: 'snake_case' });

function task(nodeType: 'approve' | 'handler'): TaskAction {
  return {
    nodeKey: 'approve_manager', nodeName: '直属主管审批', nodeType,
    nodeConfig: { key: 'approve_manager', type: nodeType, label: '直属主管审批', assigneeType: 'user', assigneeIds: [23] },
  } as unknown as TaskAction;
}

/** 假执行器：记录 where 条件并按行集返回，用于断言生成 SQL 并模拟数据库筛选结果 */
function captureExecutor(rows: Array<{ nodeKey: string; assigneeId: number | null; nodeType?: string }>) {
  const captured: SQL[] = [];
  const chain = {
    from: () => chain,
    where: (condition: SQL) => { captured.push(condition); return chain; },
    orderBy: () => chain,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return { executor: { select: () => chain } as unknown as DbExecutor, captured };
}

const run = (executor: DbExecutor, nodeType: 'approve' | 'handler') => applyAssigneeRuntimeStrategies(task(nodeType), [23], {
  instanceId: 319, initiatorId: 22, executor, settings: { approverDedupMode: 'all' },
} as never);

describe('applyAssigneeRuntimeStrategies · 审批人去重轮次范围', () => {
  it('去重限定当前轮次（returnInitiator 之后）并排除重入节点的旧表态，参数中不含 Date', async () => {
    const { executor, captured } = captureExecutor([{ nodeKey: 'approve_manager', assigneeId: 23, nodeType: 'approve' }]);
    const result = await run(executor, 'approve');

    expect(result).toEqual({ ids: [], emptiedBy: 'dedup', excluded: [{ userId: 23, reason: 'dedup' }] });
    expect(captured).toHaveLength(1);
    const { sql, params } = dialect.sqlToQuery(captured[0]);
    // 轮次起点子查询：最近一次「退回发起人」时间；无退回历史时回落到 -infinity（保留既有全实例去重语义）
    expect(sql).toContain(`"workflow_tasks"."decision"->>'action' = 'returnInitiator'`);
    expect(sql).toContain("'-infinity'::timestamptz");
    expect(sql.replace(/\s+/g, ' ')).toMatch(/action_at" > coalesce\(\(select/);
    // 重入节点（撤回重审 / 退回节点 / 重提重走）的上一轮表态作废，不再参与去重
    expect(sql).toMatch(/"workflow_tasks"\."node_key" <> \$\d+/);
    expect(params).toContain('approve_manager');
    expect(params).toContain(319);
    expect(params.some((param) => param instanceof Date)).toBe(false);
  });

  it('重提后新一轮无人审批过：原审批人不被跨轮剔除', async () => {
    const { executor } = captureExecutor([]);
    expect(await run(executor, 'approve')).toEqual({ ids: [23], emptiedBy: null, excluded: [] });
  });

  it('handler 节点不参与去重，且不产生去重查询', async () => {
    const { executor, captured } = captureExecutor([]);
    expect(await run(executor, 'handler')).toEqual({ ids: [23], emptiedBy: null, excluded: [] });
    expect(captured).toHaveLength(0);
  });
});
