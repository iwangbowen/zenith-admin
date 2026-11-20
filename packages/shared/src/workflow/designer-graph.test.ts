import { describe, expect, it } from 'vitest';
import type { WorkflowFlowData, WorkflowNodeConfig } from './types';
import { compileWorkflowTree, projectWorkflowGraph, type WorkflowDesignerProcess } from './designer-graph';
import { workflowFlowDataSchema } from './graph-schema';

function node(id: string, type: WorkflowNodeConfig['type'], extra: Partial<WorkflowNodeConfig> = {}): WorkflowFlowData['nodes'][number] {
  return { id, type: 'workflowNode', position: { x: id.length * 11, y: id.length * 17 }, data: { key: `key-${id}`, label: id, type, ...extra } };
}

function flow(nodes: WorkflowFlowData['nodes'], links: Array<[string, string]>): WorkflowFlowData {
  return { nodes, edges: links.map(([source, target], index) => ({ id: `edge-${index}`, source, target })) };
}

function projected(graph: WorkflowFlowData): WorkflowDesignerProcess {
  const result = projectWorkflowGraph(graph);
  expect(result.kind).toBe('tree');
  if (result.kind !== 'tree') throw new Error(result.reason);
  return result.process;
}

function expectSameGraph(actual: WorkflowFlowData, expected: WorkflowFlowData): void {
  expect(actual.nodes).toEqual(expected.nodes);
  expect([...actual.edges].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...expected.edges].sort((a, b) => a.id.localeCompare(b.id)));
  expect(actual.settings).toEqual(expected.settings);
  expect(actual).not.toHaveProperty('process');
}

describe('graph editing projection', () => {
  it.each(['', '财务部'])('preserves the initiator description %j through strict validation and editing', (initiatorDesc) => {
    const process: WorkflowDesignerProcess = { initiator: {
      id: 'initiator', type: 'initiator', name: '发起人', props: { initiatorDesc, fieldPermissions: { amount: 'edit' } },
    } };
    const graph = workflowFlowDataSchema.parse(compileWorkflowTree(process));
    expect(graph.nodes[0].data.initiatorDesc).toBe(initiatorDesc);
    expectSameGraph(compileWorkflowTree(projected(graph)), graph);
  });

  it('round trips graph identities, configuration, positions and settings without mutating the source', () => {
    const graph = flow([
      node('start', 'start', { fieldPermissions: { amount: 'edit' } }),
      node('approval', 'approve', { assigneeIds: [2, 3], approveMethod: 'and', signaturePolicy: 'handwritten', actionButtons: { return: { enabled: true, jumpToNodeKey: 'key-start' } } }),
      node('child', 'subProcess', { subProcessId: 7, subProcessWaitChild: false, subProcessMode: 'multi', subProcessMultiSource: 'items', subProcessFieldMapping: { total: '{{form.total}}' } }),
      node('end', 'end'),
    ], [['start', 'approval'], ['approval', 'child'], ['child', 'end']]);
    graph.settings = { allowWithdraw: false, allowResubmit: true, notifyInitiator: true, approverDedupMode: 'none' };
    const before = structuredClone(graph);
    const process = projected(graph);
    expectSameGraph(compileWorkflowTree(process), graph);
    expect(graph).toEqual(before);
    process.initiator.children!.name = '修改后的审批名称';
    const changed = compileWorkflowTree(process);
    expect(changed.nodes.find((item) => item.id === 'approval')?.data.label).toBe('修改后的审批名称');
    expect(graph).toEqual(before);
    expect(changed.nodes.find((item) => item.id === 'child')).toEqual(graph.nodes[2]);
  });

  it('preserves complete grouped conditions, default branches and explicit joins', () => {
    const graph = flow([
      node('start', 'start'), node('fork', 'exclusiveGateway'), node('high', 'approve'), node('low', 'handler'), node('join', 'exclusiveGateway'), node('end', 'end'),
    ], [['start', 'fork'], ['fork', 'high'], ['fork', 'low'], ['high', 'join'], ['low', 'join'], ['join', 'end']]);
    graph.edges[1] = { ...graph.edges[1], label: '大额且合同', conditions: [
      { type: 'and', rules: [{ field: 'amount', operator: 'gt', value: 10000 }, { field: 'docType', operator: 'in', value: '合同,协议' }] },
      { type: 'or', rules: [{ field: 'urgent', operator: 'eq', value: true }] },
    ] };
    graph.edges[2] = { ...graph.edges[2], label: '普通申请', isDefault: true };
    const process = projected(graph);
    expect(process.initiator.children?.type).toBe('conditionBranch');
    expect(process.initiator.children?.graphJoin?.id).toBe('join');
    expectSameGraph(compileWorkflowTree(process), graph);
  });

  it('supports branches merging directly into a human node, without introducing a gateway', () => {
    const graph = flow([
      node('start', 'start'), node('fork', 'exclusiveGateway'), node('a', 'approve'), node('b', 'approve'), node('final', 'approve'), node('end', 'end'),
    ], [['start', 'fork'], ['fork', 'a'], ['fork', 'b'], ['a', 'final'], ['b', 'final'], ['final', 'end']]);
    const process = projected(graph);
    expect(process.initiator.children?.graphJoin).toBeNull();
    expect(process.initiator.children?.children?.id).toBe('final');
    expectSameGraph(compileWorkflowTree(process), graph);
  });

  it('preserves empty default branches merging directly at the end', () => {
    const graph = flow([node('s', 'start'), node('fork', 'exclusiveGateway'), node('a', 'approve'), node('end', 'end')],
      [['s', 'fork'], ['fork', 'a'], ['fork', 'end'], ['a', 'end']]);
    graph.edges[2] = { ...graph.edges[2], isDefault: true, label: '无需复核' };
    expectSameGraph(compileWorkflowTree(projected(graph)), graph);
  });

  it('round trips nested parallel and inclusive regions', () => {
    const graph = flow([
      node('s', 'start'), node('outer', 'parallelGateway'), node('inner', 'inclusiveGateway'), node('a', 'approve'), node('b', 'approve'),
      node('inner-join', 'inclusiveGateway'), node('c', 'handler'), node('outer-join', 'parallelGateway'), node('end', 'end'),
    ], [['s', 'outer'], ['outer', 'inner'], ['outer', 'c'], ['inner', 'a'], ['inner', 'b'], ['a', 'inner-join'], ['b', 'inner-join'], ['inner-join', 'outer-join'], ['c', 'outer-join'], ['outer-join', 'end']]);
    expectSameGraph(compileWorkflowTree(projected(graph)), graph);
  });

  it('preserves route gateway decisions and their branch rules', () => {
    const graph = flow([node('s', 'start'), node('route', 'routeGateway', { decisionRuleKey: 'contract-route', decisionRefKind: 'table' }), node('a', 'approve'), node('b', 'approve'), node('end', 'end')],
      [['s', 'route'], ['route', 'a'], ['route', 'b'], ['a', 'end'], ['b', 'end']]);
    graph.edges[1].conditions = [{ type: 'and', rules: [{ field: 'routeResult', operator: 'eq', value: 'legal' }] }];
    graph.edges[2].isDefault = true;
    const process = projected(graph);
    expect(process.initiator.children?.props.routeFieldKey).toBe('routeResult');
    expect(process.initiator.children?.branches?.[0].caseValue).toBe('legal');
    const compiled = compileWorkflowTree(process);
    expectSameGraph(compiled, graph);
    expect(workflowFlowDataSchema.safeParse(compiled).success).toBe(true);
    expect(compiled.nodes.find(item => item.id === 'route')?.data).not.toHaveProperty('routeFieldKey');
    const uncompiled = structuredClone(compiled);
    Object.assign(uncompiled.nodes.find(item => item.id === 'route')!.data, { routeFieldKey: 'routeResult' });
    expect(workflowFlowDataSchema.safeParse(uncompiled).success).toBe(false);
  });

  it('preserves numeric route case values during an unchanged edit round trip', () => {
    const graph = flow([node('s', 'start'), node('route', 'routeGateway'), node('a', 'approve'), node('end', 'end')],
      [['s', 'route'], ['route', 'a'], ['route', 'end'], ['a', 'end']]);
    graph.edges[1].conditions = [{ type: 'and', rules: [{ field: 'result', operator: 'eq', value: 0 }] }];
    graph.edges[2].isDefault = true;
    expectSameGraph(compileWorkflowTree(projected(graph)), graph);
  });

  it('leaves complex route rules in graph mode instead of simplifying them to a single case', () => {
    const graph = flow([node('s', 'start'), node('route', 'routeGateway'), node('a', 'approve'), node('end', 'end')],
      [['s', 'route'], ['route', 'a'], ['route', 'end'], ['a', 'end']]);
    graph.edges[1].conditions = [{ type: 'and', rules: [{ field: 'result', operator: 'eq', value: 'A' }, { field: 'amount', operator: 'gt', value: 100 }] }];
    graph.edges[2].isDefault = true;
    const before = structuredClone(graph);
    expect(projectWorkflowGraph(graph)).toEqual({ kind: 'graph', reason: expect.stringContaining('复杂条件') });
    expect(graph).toEqual(before);
  });

  it('keeps cyclic canonical graphs in graph mode without mutating or truncating them', () => {
    const graph = flow([node('s', 'start'), node('a', 'approve'), node('fork', 'parallelGateway'), node('b', 'approve'), node('end', 'end')],
      [['s', 'a'], ['a', 'fork'], ['fork', 'b'], ['fork', 'end'], ['b', 'a']]);
    const original = structuredClone(graph);
    expect(projectWorkflowGraph(graph)).toEqual({ kind: 'graph', reason: expect.stringContaining('回边或循环') });
    expect(graph).toEqual(original);
  });

  it('keeps exception edges and catch nodes available in graph mode', () => {
    const graph = flow([node('s', 'start'), node('a', 'approve'), node('catch', 'catchNode', { catchAction: 'toAdmin' }), node('end', 'end')],
      [['s', 'a'], ['a', 'end'], ['a', 'catch'], ['catch', 'end']]);
    graph.edges[2].isException = true;
    const original = structuredClone(graph);
    expect(projectWorkflowGraph(graph).kind).toBe('graph');
    expect(graph).toEqual(original);
  });

  it('refuses partial projections when a graph contains unreachable nodes', () => {
    const graph = flow([node('s', 'start'), node('a', 'approve'), node('unused', 'approve'), node('end', 'end')], [['s', 'a'], ['a', 'end'], ['unused', 'end']]);
    expect(projectWorkflowGraph(graph)).toEqual({ kind: 'graph', reason: expect.stringContaining('未包含') });
  });

  it('projects nodes shared by two branch regions as references and merges them back on compile', () => {
    // 两个条件网关的默认分支都指向同一个「配套失败」节点 —— 树投影显示两份引用，回编译按 id 合并且边保留。
    const graph = flow([
      node('s', 'start'), node('outer', 'exclusiveGateway'), node('a', 'approve'), node('inner', 'exclusiveGateway'),
      node('b', 'approve'), node('bad', 'approve'), node('end', 'end'),
    ], [
      ['s', 'outer'], ['outer', 'a'], ['outer', 'bad'], ['a', 'inner'], ['inner', 'b'], ['inner', 'bad'], ['b', 'end'], ['bad', 'end'],
    ]);
    graph.edges[2] = { ...graph.edges[2], isDefault: true, label: 'outer-default' };
    graph.edges[5] = { ...graph.edges[5], isDefault: true, label: 'inner-default' };
    const before = structuredClone(graph);
    const process = projected(graph);
    expect(process.sharedNodeIds).toEqual(['bad']);
    const sharedOccurrences: boolean[] = [];
    const collect = (current: typeof process.initiator | undefined): void => {
      if (!current) return;
      if (current.id === 'bad') sharedOccurrences.push(current.sharedReference ?? false);
      for (const branch of current.branches ?? []) collect(branch.children);
      collect(current.children);
    };
    collect(process.initiator);
    expect(sharedOccurrences).toEqual([false, true]);
    expectSameGraph(compileWorkflowTree(process), graph);
    expect(graph).toEqual(before);
  });

  it.each(['webhook', 'callback', 'updateData', 'deleteData'] as const)('restores %s trigger controls without losing canonical configuration', (triggerType) => {
    const config = { triggerType, webhookUrl: 'http://localhost/hook', headers: { 'X-Test': 'value' },
      bodyTemplate: '{"value":"{{form.value}}"}', httpMethod: 'PUT' as const, timeoutMs: 5000,
      onFailure: 'block' as const, maxRetries: 2, callbackSignMode: 'hmacSha256' as const,
      callbackSecret: 'test-only', connectorId: 3, fieldKeys: ['value'], fieldValues: { value: 'updated' } };
    const graph = flow([node('start', 'start'), node('trigger', 'trigger', { triggerConfig: config }), node('end', 'end')],
      [['start', 'trigger'], ['trigger', 'end']]);
    const process = projected(graph);
    expect(process.initiator.children!.props).toMatchObject(config);
    expectSameGraph(compileWorkflowTree(process), graph);
    process.initiator.children!.props.timeoutMs = 7000;
    const changed = compileWorkflowTree(process);
    expect(changed.nodes[1].data.triggerConfig).toEqual({ ...config, timeoutMs: 7000 });
    expect(changed.nodes[1].data).not.toHaveProperty('triggerType');
    expect(workflowFlowDataSchema.safeParse(changed).success).toBe(true);
    expect(graph.nodes[1].data.triggerConfig).toEqual(config);
  });

  it('keeps a newly added empty branch instead of reusing the default branch edge id', () => {
    const graph = flow([
      node('s', 'start'), node('fork', 'exclusiveGateway'), node('a', 'approve'), node('b', 'approve'), node('join', 'exclusiveGateway'), node('end', 'end'),
    ], [['s', 'fork'], ['fork', 'a'], ['fork', 'b'], ['fork', 'join'], ['a', 'join'], ['b', 'join'], ['join', 'end']]);
    graph.edges[1] = { ...graph.edges[1], conditions: [{ type: 'and', rules: [{ field: 'kind', operator: 'eq', value: 'a' }] }] };
    graph.edges[2] = { ...graph.edges[2], conditions: [{ type: 'and', rules: [{ field: 'kind', operator: 'eq', value: 'b' }] }] };
    graph.edges[3] = { ...graph.edges[3], isDefault: true, label: '默认' };
    const process = projected(graph);
    const fork = process.initiator.children!;
    // 设计器「添加分支」生成的新分支没有 graphEdge，且与默认分支的 (source,target) 相同
    fork.branches!.splice(fork.branches!.findIndex(b => b.isDefault), 0, { id: 'branch-new', name: '条件3', priority: 3 });

    const compiled = compileWorkflowTree(process);
    const outEdges = compiled.edges.filter(e => e.source === 'fork');
    expect(outEdges).toHaveLength(4);
    expect(new Set(outEdges.map(e => e.id)).size).toBe(4);
    expect(outEdges.find(e => e.isDefault)).toMatchObject({ target: 'join', label: '默认' });
    expect(outEdges.find(e => e.label === '条件3')).toBeTruthy();
  });

  it('compiles new editor-only trigger controls and rejects invalid mapping JSON', () => {
    const process: WorkflowDesignerProcess = { initiator: { id: 'initiator', key: 'start', type: 'initiator', name: '发起', props: {}, children: {
      id: 'trigger', type: 'trigger', name: '同步数据', props: { triggerType: 'http', headers: '{"X-Test":"ok"}', httpMethod: 'POST', timeoutMs: 5000 },
    } } };
    const graph = compileWorkflowTree(process);
    const trigger = graph.nodes.find((item) => item.data.type === 'trigger')!;
    expect(trigger.data.triggerConfig).toEqual({ triggerType: 'http', headers: { 'X-Test': 'ok' }, httpMethod: 'POST', timeoutMs: 5000 });
    expect(trigger.data).not.toHaveProperty('headers');
    process.initiator.children!.props.headers = '{broken';
    expect(() => compileWorkflowTree(process)).toThrow('有效的 JSON');
  });
});
