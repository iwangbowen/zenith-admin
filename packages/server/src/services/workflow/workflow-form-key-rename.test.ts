import { describe, it, expect } from 'vitest';
import { renameWorkflowFormFieldKeys } from '@zenith/shared/workflow';
import type { WorkflowFlowData } from '@zenith/shared/workflow';

/** 构造一个覆盖各引用位置的 flowData 样例 */
function makeFlowData(): WorkflowFlowData {
  return {
    nodes: [
      {
        id: 'n1',
        position: { x: 0, y: 0 },
        data: {
          key: 'start',
          type: 'start',
          label: '发起人',
          fieldPermissions: { amount: 'edit', days: 'read', other: 'hidden' },
        },
      },
      {
        id: 'n2',
        position: { x: 0, y: 100 },
        data: {
          key: 'approve_1',
          type: 'approve',
          label: '审批',
          assigneeType: 'formUser',
          formUserField: 'amount',
          formDeptField: 'days',
          fieldPermissions: { amount: 'read' },
        },
      },
      {
        id: 'n3',
        position: { x: 0, y: 200 },
        data: {
          key: 'trigger_1',
          type: 'trigger',
          label: '触发器',
          triggerConfig: {
            triggerType: 'webhook',
            bodyTemplate: '{"total": "{{form.amount}}", "d": "{{ form.days }}"}',
            fieldKeys: ['amount', 'other'],
            fieldValues: { amount: '{{form.days}}', other: 'static' },
          },
        },
      },
      {
        id: 'n4',
        position: { x: 0, y: 300 },
        data: {
          key: 'sub_1',
          type: 'subProcess',
          label: '子流程',
          subProcessMultiSource: 'amount',
          subProcessInitiatorField: 'days',
          subProcessFieldMapping: { childAmount: '{{form.amount}}', childNote: 'fixed' },
          subProcessOutputMapping: { amount: 'childResult' },
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        condition: { field: 'amount', operator: 'gt', value: 100 },
        conditions: [
          {
            type: 'and',
            rules: [
              { field: 'amount', operator: 'gt', value: 100, aggregate: 'sum', aggregateField: 'amount' },
              { field: 'user', operator: 'eq', value: 1, source: 'starter' },
            ],
          },
        ],
      },
    ],
    settings: {
      allowWithdraw: true,
      allowResubmit: true,
      notifyInitiator: true,
      summaryFields: ['amount', 'days', 'other'],
      serialNo: { enabled: true, mode: 'template', template: 'BX-{FORM.amount}-{SEQ:4}' },
    },
  };
}

describe('renameWorkflowFormFieldKeys', () => {
  it('renames 为空或旧新相同时原样返回', () => {
    const fd = makeFlowData();
    expect(renameWorkflowFormFieldKeys(fd, {})).toBe(fd);
    expect(renameWorkflowFormFieldKeys(fd, { amount: 'amount' })).toBe(fd);
  });

  it('重写节点字段权限键与审批人字段引用', () => {
    const out = renameWorkflowFormFieldKeys(makeFlowData(), { amount: 'totalAmount' });
    expect(out.nodes[0].data.fieldPermissions).toEqual({ totalAmount: 'edit', days: 'read', other: 'hidden' });
    expect(out.nodes[1].data.formUserField).toBe('totalAmount');
    expect(out.nodes[1].data.formDeptField).toBe('days');
  });

  it('重写触发器模板占位、字段列表与更新映射', () => {
    const out = renameWorkflowFormFieldKeys(makeFlowData(), { amount: 'totalAmount', days: 'dayCount' });
    const tc = out.nodes[2].data.triggerConfig;
    expect(tc?.bodyTemplate).toBe('{"total": "{{form.totalAmount}}", "d": "{{form.dayCount}}"}');
    expect(tc?.fieldKeys).toEqual(['totalAmount', 'other']);
    expect(tc?.fieldValues).toEqual({ totalAmount: '{{form.dayCount}}', other: 'static' });
  });

  it('重写子流程来源字段、入参模板与出参映射键', () => {
    const out = renameWorkflowFormFieldKeys(makeFlowData(), { amount: 'totalAmount', days: 'dayCount' });
    const sub = out.nodes[3].data;
    expect(sub.subProcessMultiSource).toBe('totalAmount');
    expect(sub.subProcessInitiatorField).toBe('dayCount');
    expect(sub.subProcessFieldMapping).toEqual({ childAmount: '{{form.totalAmount}}', childNote: 'fixed' });
    expect(sub.subProcessOutputMapping).toEqual({ totalAmount: 'childResult' });
  });

  it('重写边条件（含聚合列），发起人维度规则不动', () => {
    const out = renameWorkflowFormFieldKeys(makeFlowData(), { amount: 'totalAmount' });
    const edge = out.edges[0];
    expect(edge.condition?.field).toBe('totalAmount');
    const rules = edge.conditions?.[0].rules ?? [];
    expect(rules[0].field).toBe('totalAmount');
    expect(rules[0].aggregateField).toBe('totalAmount');
    expect(rules[1].field).toBe('user');
  });

  it('字段改名保留图节点与连线身份，不生成第二份流程结构', () => {
    const original = makeFlowData();
    const out = renameWorkflowFormFieldKeys(original, { amount: 'totalAmount' });
    expect(out.nodes.map(node => ({ id: node.id, key: node.data.key, position: node.position })))
      .toEqual(original.nodes.map(node => ({ id: node.id, key: node.data.key, position: node.position })));
    expect(out.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })))
      .toEqual(original.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })));
    expect(out).not.toHaveProperty('process');
  });

  it('重写摘要字段与业务编号模板 {FORM.key} 占位', () => {
    const out = renameWorkflowFormFieldKeys(makeFlowData(), { amount: 'totalAmount' });
    expect(out.settings?.summaryFields).toEqual(['totalAmount', 'days', 'other']);
    expect(out.settings?.serialNo?.template).toBe('BX-{FORM.totalAmount}-{SEQ:4}');
  });

  it('不修改入参对象（返回新对象）', () => {
    const fd = makeFlowData();
    const snapshot = JSON.parse(JSON.stringify(fd));
    renameWorkflowFormFieldKeys(fd, { amount: 'totalAmount' });
    expect(fd).toEqual(snapshot);
  });
});
