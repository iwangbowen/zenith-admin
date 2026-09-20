import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { HTTPException } from 'hono/http-exception';
import type { RelationAccessContext } from '../platform/relations/types';
const state = vi.hoisted(() => ({ allowed: true, list: vi.fn(), get: vi.fn() }));
vi.mock('../../lib/context', () => ({ hasPermission: async () => state.allowed, runWithCurrentUser: async (_user: unknown, fn: () => unknown) => fn() }));
vi.mock('../../lib/tenant', async (original) => ({ ...await original<typeof import('../../lib/tenant')>(), tenantCondition: () => undefined }));
vi.mock('../../config', () => ({ config: { multiTenantMode: true } }));
vi.mock('../platform/relations/runtime', () => ({ assertRelationBudget: () => undefined }));
vi.mock('../platform/relations/providers/workflow-file.provider', () => ({ workflowVisibility: async () => undefined }));
vi.mock('./workflow-attachments.service', () => ({ getWorkflowAttachmentSummary: state.get, listWorkflowAttachmentSummaries: state.list }));
import { workflowAttachmentAnchorResolvers, workflowAttachmentRelationProviders } from './workflow-attachment-relations.service';
const fixture = (id: number, instanceId: number) => ({ id, instanceId, tenantId: 7, name: `File ${id}`, source: 'task', createdAt: new Date(), taskId: 20 });
function access(rounds: { id: number }[][] = []) {
  const tx = drizzle.mock({ casing: 'snake_case' }), queries: Array<{sql:string;params:unknown[]}> = [];
  const select = tx.select.bind(tx);
  vi.spyOn(tx, 'select').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(select, tx, args), from = builder.from;
    builder.from = (...fromArgs: unknown[]) => {
      const query = Reflect.apply(from, builder, fromArgs);
      query.execute = async () => { queries.push(query.toSQL()); return rounds.shift() ?? []; }; return query;
    }; return builder;
  });
  return { queries, context: { user: { userId: 9, username: 'viewer', roles: [], tenantId: 7 }, db: tx } as unknown as RelationAccessContext };
}
beforeEach(() => {
  state.allowed = true; state.get.mockReset(); state.list.mockReset();
  state.list.mockImplementation(async (id: number, opts: { limit: number; beforeId?: number }) => [fixture(100,10),fixture(99,10),fixture(90,9)]
    .filter((file) => file.instanceId === id && (!opts.beforeId || file.id < opts.beforeId)).slice(0,opts.limit));
});
describe('attachment source navigation and round pagination', () => {
  it('continues across rounds without skipping or duplicating the last file of a round', async () => {
    const provider = workflowAttachmentRelationProviders.find((entry) => entry.key === 'biz.leave.attachments')!;
    const first = access([[{id:10},{id:9}]]);
    const anchor = { ref: { type:'biz.leave' as const,key:'4' },title:'Leave',tenantId:7 };
    const page = await provider.list(anchor,{limit:2,access:first.context});
    expect(page.items.map((row) => row.ref.key)).toEqual(['100','99']);
    expect(page.nextCursor).toBe('[10,99]');
    const second = access([[{id:10},{id:9}]]);
    const final = await provider.list(anchor,{limit:2,cursor:page.nextCursor!,access:second.context});
    expect(final.items.map((row) => row.ref.key)).toEqual(['90']); expect(final.hasMore).toBe(false);
    expect(first.queries[0].params).toEqual(expect.arrayContaining(['biz_leave','4',7]));
    expect(second.queries[0].sql).toContain('"workflow_instances"."id" <=');
  });
  it('validates composite cursors before executing file queries', async () => {
    const provider = workflowAttachmentRelationProviders.find((entry) => entry.key === 'biz.leave.attachments')!;
    await expect(provider.list({ref:{type:'biz.leave',key:'4'},title:'Leave',tenantId:7},{limit:2,cursor:'[10,-1]',access:access().context})).rejects.toMatchObject({status:400});
    expect(state.list).not.toHaveBeenCalled();
  });
  it('does not resolve a hidden file and never conceals an infrastructure failure', async () => {
    const resolver = workflowAttachmentAnchorResolvers[0], context=access().context;
    state.get.mockRejectedValueOnce(new HTTPException(404));
    expect(await resolver.resolve({type:'workflow.attachment',key:'3'},context)).toBeNull();
    state.get.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(resolver.resolve({type:'workflow.attachment',key:'3'},context)).rejects.toThrow('database unavailable');
  });
  it('restricts a task group to its own persisted task and instance', async () => {
    const provider=workflowAttachmentRelationProviders.find((entry)=>entry.key==='workflow.task.attachments')!;
    const context=access().context;
    await provider.list({ref:{type:'workflow.task',key:'20'},title:'Task',tenantId:7,metadata:{instanceId:10}},{limit:2,access:context});
    expect(state.list).toHaveBeenCalledWith(10,{limit:3,beforeId:undefined,taskId:20},context.db);
  });
});
