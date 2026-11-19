import { describe, expect, it } from 'vitest';
import type { WorkflowFlowData, WorkflowNodeConfig } from '@zenith/shared/workflow';
import { MemoryWorkflowRuntime, type MemoryRuntimeFacts, type MemoryExecutionDefinition } from './memory';

function flow(config: Partial<WorkflowNodeConfig> = {}, next = true): WorkflowFlowData {
  const nodes: WorkflowNodeConfig[] = [{ key: 'start', type: 'start', label: '发起' },
    { key: 'review', label: '会审', type: 'approve', assigneeType: 'user', assigneeIds: [1, 2], sameInitiatorStrategy: 'selfApprove', ...config },
    ...(next ? [{ key: 'after', label: '后续', type: 'approve' as const, assigneeType: 'user' as const, assigneeIds: [3] }] : []),
    { key: 'end', type: 'end', label: '结束' }];
  return { nodes: nodes.map(data => ({ id: data.key, position: { x: 0, y: 0 }, data })),
    edges: nodes.slice(0, -1).map((data, index) => ({ id: String(index), source: data.key, target: nodes[index + 1].key })), settings: { approverDedupMode: 'none' } };
}
function facts(children: MemoryExecutionDefinition[] = []): MemoryRuntimeFacts {
  return { resolve: async config => config.assigneeIds ?? config.userIds ?? [],
    filterSelected: async (config, ids) => ids.filter(id => !config.selectScopeIds?.length || config.selectScopeIds.includes(id)),
    candidates: async config => config.selectScopeIds ?? [1, 2, 3],
    names: async ids => new Map(ids.map(id => [id, '成员' + id])), starter: async userId => ({ userId, deptIds: [], roleIds: [], postIds: [] }),
    admin: async () => 88, delegate: async () => null, decide: async () => ({ route: 'high' }),
    definition: async id => children.find(child => child.id === id) ?? null };
}
async function start(graph: WorkflowFlowData, options = {}, context = facts()) {
  return new MemoryWorkflowRuntime(context, { now: 0, ...options }).start({ id: 1, flowData: graph, fields: [] }, {}, 99);
}

describe('same execution runtime with memory storage', () => {
  it.each(['and', 'ratio', 'sequential'] as const)('%s never advances before its frozen votes are satisfied', async method => {
    const runtime = await start(flow({ approveMethod: method, approveRatio: 100 }));
    await runtime.command({ nodeKey: 'review', assigneeId: 1, action: 'approve' });
    expect((await runtime.snapshot()).tasks.some(task => task.nodeKey === 'after')).toBe(false);
    await runtime.command({ nodeKey: 'review', assigneeId: 2, action: 'approve' });
    expect((await runtime.snapshot()).tasks.filter(task => task.status === 'pending').map(task => task.nodeKey)).toEqual(['after']);
  });
  it('OR approval cancels the remaining seat and rejects a stale second opinion', async () => {
    const runtime = await start(flow({ approveMethod: 'or' }));
    await runtime.command({ nodeKey: 'review', assigneeId: 1, action: 'approve' });
    await expect(runtime.command({ nodeKey: 'review', assigneeId: 2, action: 'reject' })).rejects.toThrow('没有可操作');
    expect(runtime.executions[0].tasks.find(task => task.nodeKey === 'review' && task.assigneeId === 2)?.status).toBe('skipped');
  });
  it('a ratio refusal is partial while the threshold can still be reached', async () => {
    const runtime = await start(flow({ approveMethod: 'ratio', approveRatio: 50 }));
    await runtime.command({ nodeKey: 'review', assigneeId: 1, action: 'reject' });
    expect(runtime.executions[0].status).toBe('running');
    await runtime.command({ nodeKey: 'review', assigneeId: 2, action: 'approve' });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('sequential second approver waits for the first approver', async () => {
    const runtime = await start(flow({ approveMethod: 'sequential' }));
    await expect(runtime.command({ nodeKey: 'review', assigneeId: 2, action: 'approve' })).rejects.toThrow('尚未激活');
  });
  it('handler assigned to the initiator remains a real actionable task', async () => {
    const runtime = await start(flow({ type: 'handler', assigneeIds: [99], sameInitiatorStrategy: 'autoSkip' }));
    expect((await runtime.snapshot()).tasks[0]).toMatchObject({ nodeKey: 'review', assigneeId: 99, status: 'pending' });
  });
  it('node exception termination takes precedence over empty-person auto approval', async () => {
    const runtime = await start(flow({ assigneeIds: [], catchAction: 'terminate', emptyStrategy: 'autoApprove' }));
    expect(runtime.executions[0].status).toBe('rejected');
  });
  it('random source is deterministic per replay and selects exactly one candidate', async () => {
    const first = await start(flow({ approveMethod: 'random' }), { seed: 42 });
    const second = await start(flow({ approveMethod: 'random' }), { seed: 42 });
    expect((await first.snapshot()).tasks).toHaveLength(1);
    expect((await first.snapshot()).tasks[0].assigneeId).toBe((await second.snapshot()).tasks[0].assigneeId);
  });
  it('returns to the initiator and supports a new round without previous active tasks', async () => {
    const runtime = await start(flow({ assigneeIds: [1], rejectStrategy: 'returnStart' }));
    await runtime.command({ nodeKey: 'review', action: 'reject' });
    expect(runtime.executions[0].status).toBe('returned'); expect((await runtime.snapshot()).tasks).toEqual([]);
    await runtime.command({ nodeKey: 'start', action: 'resubmit' });
    expect(runtime.executions[0].status).toBe('running'); expect((await runtime.snapshot()).tasks).toHaveLength(1);
  });
  it('resolves a real rule output before selecting a gateway branch', async () => {
    const graph = flow({ type: 'routeGateway', decisionRuleKey: 'route', routeFieldKey: 'route' });
    graph.edges.splice(1, 1, { id: 'high', source: 'review', target: 'after', condition: { field: 'route', operator: 'eq', value: 'high' } }, { id: 'other', source: 'review', target: 'end', isDefault: true });
    const runtime = await start(graph); expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('advances a waiting delay only when virtual time reaches the deadline', async () => {
    const runtime = await start(flow({ type: 'delay', delayValue: 2, delayUnit: 'hour' }));
    expect((await runtime.snapshot()).tasks[0].waitReason).toBe('delay');
    await runtime.command({ nodeKey: 'clock', action: 'advanceTime', minutes: 119 });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('review');
    await runtime.command({ nodeKey: 'clock', action: 'advanceTime', minutes: 1 });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('external approval waits for an explicit mock callback', async () => {
    const runtime = await start(flow({ externalApproval: { enabled: true, url: 'https://example.invalid/approval' } }));
    expect((await runtime.snapshot()).tasks[0]).toMatchObject({ status: 'waiting', waitReason: 'external' });
    await runtime.command({ nodeKey: 'review', action: 'approve' });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('external dispatch failure with manual fallback preserves the waiting task', async () => {
    const runtime=await start(flow({externalApproval:{enabled:true,url:'https://example.invalid/approval',secret:'test',fallbackStrategy:'manual'}}));
    await runtime.command({nodeKey:'review',action:'approve',outcome:'failed'});
    expect((await runtime.snapshot()).tasks[0]).toMatchObject({nodeKey:'review',status:'waiting',waitReason:'external'});
  });
  it('actually executes a child and waits before restoring its parent', async () => {
    const child = { id: 12, flowData: flow({ assigneeIds: [7] }, false), fields: [] };
    const runtime = await start(flow({ type: 'subProcess', subProcessId: 12, subProcessWaitChild: true }), {}, facts([child]));
    expect((await runtime.snapshot()).tasks.some(task => task.nodeKey === 'after')).toBe(false);
    const childTask = (await runtime.snapshot()).tasks.find(task => task.executionPath !== 'root')!;
    await runtime.command({ nodeKey: childTask.nodeKey, taskId: childTask.id, executionPath: childTask.executionPath, action: 'approve' });
    expect((await runtime.snapshot()).tasks.filter(task => task.status === 'pending').map(task => task.nodeKey)).toEqual(['after']);
  });
  it('uses the runtime assignee history to remove repeated approval candidates', async () => {
    const graph = flow({ assigneeIds: [1] }); graph.nodes[2].data.assigneeIds = [1]; graph.settings = { approverDedupMode: 'all' };
    const runtime = await start(graph); await runtime.command({ nodeKey: 'review', action: 'approve' });
    expect(runtime.executions[0].status).toBe('finished'); expect((await runtime.snapshot()).tasks).toEqual([]);
  });
  it('isolates form and graph data from callers and blocks unsatisfied approval requirements', async () => {
    const graph = flow({ assigneeIds: [1], operations: ['opinionRequired'] });
    const original = structuredClone(graph); const runtime = await start(graph);
    await expect(runtime.command({ nodeKey: 'review', action: 'approve' })).rejects.toThrow('模拟满足');
    expect(graph).toEqual(original);
  });
  it('routes a rejected child through the same parent return policy', async () => {
    const child = { id: 12, flowData: flow({ assigneeIds: [7] }, false), fields: [] };
    const runtime = await start(flow({ type: 'subProcess', subProcessId: 12, subProcessWaitChild: true, rejectStrategy: 'returnStart' }), {}, facts([child]));
    const task = (await runtime.snapshot()).tasks.find(item => item.executionPath !== 'root')!;
    await runtime.command({ nodeKey: task.nodeKey, taskId: task.id, executionPath: task.executionPath, action: 'reject' });
    expect(runtime.executions[0].status).toBe('returned');
  });
  it('an invalid command rolls back tasks, form changes and token advancement atomically', async () => {
    const graph = flow({ assigneeIds: [1] }); graph.nodes[2].data.assigneeType = 'approverSelect';
    const runtime = await start(graph); const previous = structuredClone(runtime.executions);
    await expect(runtime.command({ nodeKey: 'review', action: 'approve', formPatch: { amount: 999 } })).rejects.toThrow('请选择');
    expect(runtime.executions).toEqual(previous);
  });
  it('chronologically applies multiple virtual timeout reminders and escalation', async () => {
    const runtime = await start(flow({ assigneeIds: [1], timeout: { enabled: true, duration: 1, unit: 'hours', action: 'remind', remindCount: 2, escalateAction: 'autoApprove' } }, false));
    await runtime.command({ nodeKey: 'clock', action: 'advanceTime', minutes: 120 });
    expect(runtime.executions[0].status).toBe('finished');
    expect(runtime.timeline.some(item => item.reason?.includes('提醒 1'))).toBe(true);
  });
  it('applies explicit effect failure policies without making external requests', async () => {
    const runtime = await start(flow({ type: 'trigger', triggerConfig: { triggerType: 'callback' }, failurePolicy: { action: 'continue' } }));
    await runtime.command({ nodeKey: 'review', action: 'approve', outcome: 'failed' });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('creates an actionable repair task for a failed callback needing human recovery', async () => {
    const runtime = await start(flow({ type: 'trigger', triggerConfig: { triggerType: 'callback' }, failurePolicy: { action: 'notify' } }));
    await runtime.command({ nodeKey: 'review', action: 'approve', outcome: 'failed' });
    expect((await runtime.snapshot()).tasks[0]).toMatchObject({ status: 'pending', assigneeId: 88 });
    await runtime.command({ nodeKey: 'review', action: 'approve' });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('keeps a before-sign group mandatory even for OR approval', async () => {
    const runtime = await start(flow({ approveMethod: 'or', actionButtons: { addSign: { enabled: true }, reduceSign: { enabled: true } } }));
    await runtime.command({ nodeKey: 'review', assigneeId: 1, action: 'addSign', targetUserIds: [7], position: 'before' });
    await runtime.command({ nodeKey: 'review', assigneeId: 2, action: 'approve' });
    expect((await runtime.snapshot()).tasks.some(task => task.nodeKey === 'after')).toBe(false);
    await runtime.command({ nodeKey: 'review', assigneeId: 7, action: 'approve' });
    await runtime.command({ nodeKey: 'review', assigneeId: 1, action: 'approve' });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('delegated suggestions return to the principal without casting a formal vote', async () => {
    const runtime = await start(flow({ assigneeIds: [1], actionButtons: { delegate: { enabled: true } } }));
    await runtime.command({ nodeKey: 'review', action: 'delegate', targetUserIds: [7] });
    await runtime.command({ nodeKey: 'review', assigneeId: 7, action: 'approve' });
    expect((await runtime.snapshot()).tasks[0]).toMatchObject({ nodeKey: 'review', assigneeId: 1 });
    await runtime.command({ nodeKey: 'review', assigneeId: 1, action: 'approve' });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('rejects transfer back to a previous holder', async () => {
    const runtime = await start(flow({ assigneeIds: [1], actionButtons: { transfer: { enabled: true } } }));
    await runtime.command({ nodeKey: 'review', action: 'transfer', targetUserIds: [7] });
    await expect(runtime.command({ nodeKey: 'review', action: 'transfer', targetUserIds: [1] })).rejects.toThrow('经手');
  });
  it('reduces a pending supplemental group without changing frozen base votes', async () => {
    const runtime = await start(flow({ assigneeIds: [1], actionButtons: { addSign: { enabled: true }, reduceSign: { enabled: true } } }));
    await runtime.command({ nodeKey: 'review', action: 'addSign', targetUserIds: [7], position: 'after' });
    const extra = (await runtime.snapshot()).tasks.find(task => task.assigneeId === 7)!;
    await runtime.command({ nodeKey: 'review', taskId: extra.id, action: 'reduceSign', groupId: extra.groupId!, targetSlotIds: [extra.slotId!] });
    await runtime.command({ nodeKey: 'review', assigneeId: 1, action: 'approve' });
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
  it('regresses procurement with conditional parallel OR/AND votes, child approval, output mapping and delay', async () => {
    const configs: WorkflowNodeConfig[] = [
      { key: 'start', type: 'start', label: '采购发起' },
      { key: 'amount', type: 'exclusiveGateway', label: '金额分级' },
      { key: 'fork', type: 'parallelGateway', label: '并行会审' },
      { key: 'finance', type: 'approve', label: '财务会签', assigneeType: 'user', assigneeIds: [1,2], approveMethod: 'and', actionButtons: { addSign: { enabled: true } } },
      { key: 'legal', type: 'approve', label: '法务或签', assigneeType: 'user', assigneeIds: [4,5], approveMethod: 'or' },
      { key: 'join', type: 'parallelGateway', label: '会审汇聚' },
      { key: 'contract', type: 'subProcess', label: '合同审批', subProcessId: 12, subProcessWaitChild: true, subProcessFieldMapping: { contractAmount: '{{form.amount}}' }, subProcessOutputMapping: { contractResult: 'result' } },
      { key: 'delay', type: 'delay', label: '冷静期', delayValue: 1, delayUnit: 'hour' },
      { key: 'director', type: 'approve', label: '总监审批', assigneeType: 'user', assigneeIds: [8] },
      { key: 'small', type: 'approve', label: '小额审批', assigneeType: 'user', assigneeIds: [9] },
      { key: 'end', type: 'end', label: '完成' },
    ];
    const graph: WorkflowFlowData = { nodes: configs.map(data => ({ id: data.key, position: { x: 0, y: 0 }, data })), settings: { approverDedupMode: 'none' },
      edges: [['start','amount'],['amount','fork'],['amount','small'],['fork','finance'],['fork','legal'],['finance','join'],['legal','join'],['join','contract'],['contract','delay'],['delay','director'],['director','end'],['small','end']]
        .map(([source,target], index) => ({ id: 'p' + index, source, target, ...(source === 'amount' && target === 'fork' ? { condition: { field: 'amount', operator: 'gt' as const, value: 10000 } } : source === 'amount' ? { isDefault: true } : {}) })) };
    const child = flow({ assigneeIds: [7] }, false); child.nodes.splice(2,0,{id:'update',position:{x:0,y:0},data:{key:'update',type:'trigger',label:'合同结果',triggerConfig:{triggerType:'updateData',fieldKeys:['result'],fieldValues:{result:'confirmed'}}}});
    child.edges[1].target = 'update'; child.edges.push({id:'child-result',source:'update',target:'end'});
    const runtime = await new MemoryWorkflowRuntime(facts([{ id:12, flowData:child, fields:[] }]), {now:0}).start({id:1,flowData:graph,fields:[]},{amount:28000},99);
    await runtime.command({nodeKey:'finance',assigneeId:1,action:'addSign',targetUserIds:[6],position:'before'});
    await runtime.command({nodeKey:'legal',assigneeId:4,action:'approve'});
    await runtime.command({nodeKey:'finance',assigneeId:6,action:'approve'});
    await runtime.command({nodeKey:'finance',assigneeId:1,action:'approve'});
    expect((await runtime.snapshot()).tasks.some(task=>task.nodeKey==='contract')).toBe(false);
    await runtime.command({nodeKey:'finance',assigneeId:2,action:'approve'});
    const childTask=(await runtime.snapshot()).tasks.find(task=>task.executionPath!=='root')!;
    await runtime.command({nodeKey:childTask.nodeKey,taskId:childTask.id,executionPath:childTask.executionPath,action:'approve'});
    expect(runtime.executions[0].formData.contractResult).toBe('confirmed');
    await runtime.command({nodeKey:'clock',action:'advanceTime',minutes:60});
    await runtime.command({nodeKey:'director',action:'approve'});
    expect(runtime.executions[0].status).toBe('finished');
    expect(runtime.timeline.some(item=>item.nodeKey==='small')).toBe(false);
  });
  it('evaluates relative-date conditions against the advanced virtual clock', async () => {
    const graph = flow({ type: 'delay', delayValue: 3, delayUnit: 'day' });
    graph.nodes.splice(2,0,{id:'date-check',position:{x:0,y:0},data:{key:'date-check',type:'exclusiveGateway',label:'日期判断'}});
    graph.edges[1].target='date-check';
    graph.edges.push({id:'recent',source:'date-check',target:'after',condition:{field:'submitted',operator:'withinDays',value:1}},{id:'expired',source:'date-check',target:'end',isDefault:true});
    const now=new Date('2026-11-19T00:00:00Z').getTime();
    const runtime=await new MemoryWorkflowRuntime(facts(),{now}).start({id:1,flowData:graph,fields:[]},{submitted:'2026-11-19T00:00:00Z'},99);
    await runtime.command({nodeKey:'clock',action:'advanceTime',minutes:3*24*60});
    expect(runtime.executions[0].status).toBe('finished');
    expect(runtime.timeline.some(item=>item.nodeKey==='after')).toBe(false);
  });
  it('applies only editable form fields and recomputes derived amounts before routing', async () => {
    const graph=flow({assigneeIds:[1],fieldPermissions:{amount:'edit'}});
    const fields=[{key:'amount',label:'金额',type:'amount' as const},{key:'total',label:'合计',type:'formula' as const,formula:'{amount} * 2'}];
    const runtime=await new MemoryWorkflowRuntime(facts(),{now:0}).start({id:1,flowData:graph,fields},{amount:100},99);
    await runtime.command({nodeKey:'review',action:'approve',formPatch:{amount:200,total:1,unauthorized:'ignored'}});
    expect(runtime.executions[0].formData).toMatchObject({amount:200,total:400});
    expect(runtime.executions[0].formData).not.toHaveProperty('unauthorized');
  });
  it.each(['serial','parallel'] as const)('runs every %s child instance with ordered mapped output',async execution=>{
    const child=flow({assigneeIds:[7],fieldPermissions:{result:'edit'}},false);
    const parent=flow({type:'subProcess',subProcessId:12,subProcessMode:'multi',subProcessMultiSource:'items',subProcessMultiExecution:execution,subProcessFieldMapping:{result:'{{item}}'},subProcessOutputMapping:{results:'result'}});
    const runtime=await new MemoryWorkflowRuntime(facts([{id:12,flowData:child,fields:[]}]),{now:0}).start({id:1,flowData:parent,fields:[]},{items:['A','B']},99);
    const first=(await runtime.snapshot()).tasks.find(task=>task.executionPath!=='root')!;
    await runtime.command({nodeKey:first.nodeKey,taskId:first.id,executionPath:first.executionPath,action:'approve'});
    const second=(await runtime.snapshot()).tasks.find(task=>task.executionPath!=='root')!;
    await runtime.command({nodeKey:second.nodeKey,taskId:second.id,executionPath:second.executionPath,action:'approve'});
    expect(runtime.executions[0].formData.results).toEqual(['A','B']);
    expect((await runtime.snapshot()).tasks[0].nodeKey).toBe('after');
  });
});
