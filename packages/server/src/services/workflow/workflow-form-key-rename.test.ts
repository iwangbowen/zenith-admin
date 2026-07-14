import { describe, it, expect } from 'vitest';
import { renameWorkflowFormFieldKeys } from '@zenith/shared';
import type { WorkflowFlowData } from '@zenith/shared';

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
    process: {
      initiator: {
        id: 'root',
        type: 'initiator',
        name: '发起人',
        props: { fieldPermissions: { amount: 'edit' } },
        children: {
          id: 'branch',
          type: 'conditionBranch',
          name: '条件分支',
          props: {},
          branches: [
            {
              id: 'b1',
              name: '分支1',
              conditions: [{ type: 'and', rules: [{ field: 'amount', operator: 'gt', value: 100 }] }],
              children: {
                id: 'approver',
                type: 'approver',
                name: '审批人',
                props: { formUserField: 'amount', fieldPermissions: { amount: 'read', days: 'edit' } },
              },
            },
          ],
        },
      },
    },
    settings: {
      allowWithdraw: true,
      allowResubmit: true,
      notifyInitiator: true,
      summaryFields: ['amount', 'days', 'other'],
      serialNo: { enabled: true, mode: 'template', template: 'BX-{FORM.amount}-{SEQ:4}' },
    },
  } as unknown as WorkflowFlowData;
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

  it('递归重写流程树 props 与分支条件', () => {
    const out = renameWorkflowFormFieldKeys(makeFlowData(), { amount: 'totalAmount' });
    const initiator = out.process?.initiator as {
      props: { fieldPermissions: Record<string, string> };
      children: {
        branches: Array<{
          conditions: Array<{ rules: Array<{ field: string }> }>;
          children: { props: { formUserField: string; fieldPermissions: Record<string, string> } };
        }>;
      };
    };
    expect(initiator.props.fieldPermissions).toEqual({ totalAmount: 'edit' });
    const branch = initiator.children.branches[0];
    expect(branch.conditions[0].rules[0].field).toBe('totalAmount');
    expect(branch.children.props.formUserField).toBe('totalAmount');
    expect(branch.children.props.fieldPermissions).toEqual({ totalAmount: 'read', days: 'edit' });
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
