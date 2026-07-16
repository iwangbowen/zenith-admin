/**
 * 三种表单类型（designer / custom / external）门禁与引用收集的单元测试：
 * - collectReferencedFormFieldKeys：发布前「引用了表单字段但未绑定表单」门禁的字段收集
 * - assertLaunchMatchesFormType：发起时表单类型匹配校验（含 external 审批人路由变量软校验）
 */
import { describe, expect, it } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { collectReferencedFormFieldKeys } from '@zenith/shared';
import type { WorkflowFlowData } from '@zenith/shared';
import { assertLaunchMatchesFormType } from './instances/mapping';
import type { workflowDefinitions } from '../../db/schema';

type DefinitionRow = typeof workflowDefinitions.$inferSelect;

function flow(partial: Partial<WorkflowFlowData>): WorkflowFlowData {
  return { nodes: [], edges: [], ...partial } as WorkflowFlowData;
}

function makeDef(overrides: Partial<DefinitionRow>): DefinitionRow {
  return {
    id: 1,
    name: '测试流程',
    formId: null,
    formType: 'designer',
    customForm: null,
    flowData: flow({}),
    status: 'published',
    version: 1,
    tenantId: null,
    ...overrides,
  } as unknown as DefinitionRow;
}

describe('collectReferencedFormFieldKeys', () => {
  it('收集分支条件 / formUser / formDept / 表达式 / 延迟日期 / 子流程字段引用', () => {
    const flowData = flow({
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'a1', label: '审批1', type: 'approve', assigneeType: 'formUser', formUserField: 'managerId' } },
        { id: 'n2', position: { x: 0, y: 0 }, data: { key: 'a2', label: '审批2', type: 'approve', assigneeType: 'formDepartment', formDeptField: 'deptId' } },
        { id: 'n3', position: { x: 0, y: 0 }, data: { key: 'a3', label: '审批3', type: 'approve', assigneeType: 'expression', assigneeExpression: 'form.leaderId + form.backupId' } },
        { id: 'n4', position: { x: 0, y: 0 }, data: { key: 'd1', label: '延迟', type: 'delay', delayType: 'toDate', targetDate: 'deadline' } },
        { id: 'n5', position: { x: 0, y: 0 }, data: { key: 's1', label: '子流程', type: 'subProcess', subProcessMultiSource: 'items', subProcessInitiator: 'formField', subProcessInitiatorField: 'ownerId' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', condition: { field: 'amount', operator: 'gt', value: 100 } },
        { id: 'e2', source: 'n2', target: 'n3', conditions: [{ type: 'and', rules: [{ field: 'days', operator: 'gte', value: 3 }] }] },
        // starter 维度条件不算表单字段引用
        { id: 'e3', source: 'n3', target: 'n4', condition: { field: 'dept', operator: 'eq', value: 1, source: 'starter' } },
      ],
    });
    const keys = collectReferencedFormFieldKeys(flowData);
    expect([...keys].sort()).toEqual(
      ['amount', 'backupId', 'days', 'deadline', 'deptId', 'items', 'leaderId', 'managerId', 'ownerId'].sort(),
    );
  });

  it('无引用时返回空集合；空 flowData 安全', () => {
    expect(collectReferencedFormFieldKeys(flow({})).size).toBe(0);
    expect(collectReferencedFormFieldKeys(null).size).toBe(0);
  });
});

describe('assertLaunchMatchesFormType', () => {
  const externalDef = (flowData: WorkflowFlowData) => makeDef({
    formType: 'external',
    customForm: { createComponent: '', viewComponent: 'biz/leave/LeaveApprovalView', icon: null, variables: [] },
    flowData,
  } as unknown as Partial<DefinitionRow>);

  it('designer 携带 bizKey 被拒绝', () => {
    expect(() => assertLaunchMatchesFormType(makeDef({}), { bizType: 'biz_leave', bizId: '1' })).toThrow(HTTPException);
  });

  it('external 缺 bizKey / 存草稿 / 缺查看组件均被拒绝', () => {
    const def = externalDef(flow({}));
    expect(() => assertLaunchMatchesFormType(def, {})).toThrow(/bizType 与 bizId/);
    expect(() => assertLaunchMatchesFormType(def, { bizType: 'biz_leave', bizId: '1', asDraft: true })).toThrow(/草稿/);
    const noView = makeDef({ formType: 'external', customForm: { createComponent: '', viewComponent: null, icon: null, variables: [] }, flowData: flow({}) } as unknown as Partial<DefinitionRow>);
    expect(() => assertLaunchMatchesFormType(noView, { bizType: 'biz_leave', bizId: '1' })).toThrow(/查看页组件/);
  });

  it('external：formUser 节点无兜底策略且路由变量缺失 → 明确报错', () => {
    const def = externalDef(flow({
      nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { key: 'a1', label: '主管审批', type: 'approve', assigneeType: 'formUser', formUserField: 'managerId' } }],
    }));
    expect(() => assertLaunchMatchesFormType(def, { bizType: 'biz_leave', bizId: '1', formData: {} }))
      .toThrow(/managerId/);
    // 传入变量后放行
    expect(() => assertLaunchMatchesFormType(def, { bizType: 'biz_leave', bizId: '1', formData: { managerId: 5 } }))
      .not.toThrow();
  });

  it('external：节点已配置空审批人兜底策略时允许变量缺省', () => {
    const def = externalDef(flow({
      nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { key: 'a1', label: '主管审批', type: 'approve', assigneeType: 'formUser', formUserField: 'managerId', emptyStrategy: 'assignToAdmin' } }],
    }));
    expect(() => assertLaunchMatchesFormType(def, { bizType: 'biz_leave', bizId: '1', formData: {} })).not.toThrow();
  });

  it('custom 缺创建组件被拒绝；配置齐全放行', () => {
    const noCreate = makeDef({ formType: 'custom', customForm: { createComponent: '', viewComponent: null, icon: null, variables: [] } } as unknown as Partial<DefinitionRow>);
    expect(() => assertLaunchMatchesFormType(noCreate, {})).toThrow(/创建页组件/);
    const ok = makeDef({ formType: 'custom', customForm: { createComponent: 'biz/demo/DemoBusinessForm', viewComponent: null, icon: null, variables: [] } } as unknown as Partial<DefinitionRow>);
    expect(() => assertLaunchMatchesFormType(ok, {})).not.toThrow();
  });
});
