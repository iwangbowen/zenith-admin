import { describe, expect, it } from 'vitest';
import { compileWorkflowTree, projectWorkflowGraph, workflowFlowDataSchema, type WorkflowNodeConfig } from '@zenith/shared/workflow';
import { clearInactiveAssigneeProps, emptyAssigneeChoicePatch, resetAssigneePropsForType, resolveEmptyAssigneeChoice, sanitizeAssigneePropsForWrite } from './assignee-props';

describe('empty assignee strategy choice', () => {
  it('shows the effective action when node-level exception handling takes priority', () => {
    expect(resolveEmptyAssigneeChoice('autoApprove', 'terminate')).toBe('reject');
    expect(resolveEmptyAssigneeChoice('reject', 'toAdmin')).toBe('assignToAdmin');
    expect(resolveEmptyAssigneeChoice('reject', 'notify')).toBe('notify');
    expect(resolveEmptyAssigneeChoice('assignTo')).toBe('assignTo');
  });

  it.each(['autoApprove', 'reject', 'assignToAdmin', 'assignTo', 'notify'] as const)('round-trips choice %s', choice => {
    const patch = emptyAssigneeChoicePatch(choice);
    expect(resolveEmptyAssigneeChoice(patch.emptyStrategy, patch.catchAction)).toBe(choice);
  });

  it('clears an incompatible overriding action without discarding configured recipients', () => {
    const props = { emptyStrategy: 'assignTo', catchAction: 'notify', catchNotifyUserIds: [2], emptyAssignToIds: [3], emptyAssignToNames: ['成员'] };
    expect({ ...props, ...emptyAssigneeChoicePatch('reject') }).toEqual({
      emptyStrategy: 'reject', catchAction: undefined, catchNotifyUserIds: [2], emptyAssignToIds: [3], emptyAssignToNames: ['成员'],
    });
  });

  it('preserves node-level termination and administrator actions with their original priority', () => {
    expect(emptyAssigneeChoicePatch('reject', 'terminate').catchAction).toBe('terminate');
    expect(emptyAssigneeChoicePatch('assignToAdmin', 'toAdmin').catchAction).toBe('toAdmin');
    expect(emptyAssigneeChoicePatch('assignToAdmin', 'terminate').catchAction).toBeUndefined();
    expect(emptyAssigneeChoicePatch('autoApprove', 'toAdmin').catchAction).toBeUndefined();
  });

  it('retains both recipient lists across switches between all available choices', () => {
    let props: Pick<WorkflowNodeConfig, 'emptyStrategy' | 'catchAction' | 'catchNotifyUserIds' | 'emptyAssignToIds' | 'emptyAssignToNames'> = {
      emptyStrategy: 'assignTo', catchNotifyUserIds: [2, 5], emptyAssignToIds: [3, 4], emptyAssignToNames: ['甲', '乙'],
    };
    for (const choice of ['notify', 'reject', 'assignToAdmin', 'autoApprove', 'assignTo'] as const) {
      props = { ...props, ...emptyAssigneeChoicePatch(choice) };
      expect(props.catchNotifyUserIds).toEqual([2, 5]);
      expect(props.emptyAssignToIds).toEqual([3, 4]);
      expect(props.emptyAssignToNames).toEqual(['甲', '乙']);
    }
  });

  it.each(['autoApprove', 'assignToAdmin', 'reject', 'assignTo'] as const)('reads every original override for base strategy %s', emptyStrategy => {
    expect(resolveEmptyAssigneeChoice(emptyStrategy)).toBe(emptyStrategy);
    expect(resolveEmptyAssigneeChoice(emptyStrategy, 'notify')).toBe('notify');
    expect(resolveEmptyAssigneeChoice(emptyStrategy, 'toAdmin')).toBe('assignToAdmin');
    expect(resolveEmptyAssigneeChoice(emptyStrategy, 'terminate')).toBe('reject');
  });
});

describe('approval rule persistence', () => {
  const rules = {
    assigneeType: 'user', assigneeIds: [1], approveMethod: 'or', signaturePolicy: 'none', rejectStrategy: 'returnToNode', rejectToNodeKey: 'previous', returnMode: 'backToOrigin',
    emptyStrategy: 'assignTo', emptyAssignToIds: [2, 3], emptyAssignToNames: ['甲', '乙'], catchNotifyUserIds: [4, 5],
    sameInitiatorStrategy: 'toDirectManager', deduplicateStrategy: 'repeatApprove',
    timeout: { enabled: true, duration: 2, unit: 'days', action: 'remind', remindCount: 3, escalateAction: 'transferToManager', escalateManagerLevel: 2, escalateFallbackAction: 'autoReject' },
    externalApproval: { enabled: true, url: 'https://example.com/approval', secret: 'test-secret', signMode: 'hmacSha256', timeoutMs: 15000, fallbackStrategy: 'manual' },
  };

  function saveAndReopen(props: Record<string, unknown>) {
    const graph = compileWorkflowTree({ initiator: { id: 'start', key: 'start', type: 'initiator', name: '发起', props: {}, children: {
      id: 'approval', key: 'approval', type: 'approver', name: '审批', props: sanitizeAssigneePropsForWrite(props),
    } } });
    const saved = workflowFlowDataSchema.parse(JSON.parse(JSON.stringify(graph)));
    const reopened = projectWorkflowGraph(saved);
    if (reopened.kind !== 'tree') throw new Error('Expected editable workflow');
    return reopened.process.initiator.children!.props as Omit<WorkflowNodeConfig, 'key' | 'type' | 'label'>;
  }

  it.each([undefined, 'toAdmin', 'notify', 'terminate'] as const)('preserves original rule payloads including exception action %s', catchAction => {
    const props = { ...rules, catchAction };
    expect(saveAndReopen(props)).toEqual(JSON.parse(JSON.stringify(props)));
  });

  it.each(['autoApprove', 'assignToAdmin', 'reject', 'assignTo', 'notify'] as const)('persists selected action %s without changing other approval rules', choice => {
    const reopened = saveAndReopen({ ...rules, ...emptyAssigneeChoicePatch(choice, 'notify') });
    expect(resolveEmptyAssigneeChoice(reopened.emptyStrategy ?? 'autoApprove', reopened.catchAction)).toBe(choice);
    expect(reopened).toMatchObject({
      rejectStrategy: rules.rejectStrategy, rejectToNodeKey: rules.rejectToNodeKey, returnMode: rules.returnMode,
      sameInitiatorStrategy: rules.sameInitiatorStrategy, deduplicateStrategy: rules.deduplicateStrategy, timeout: rules.timeout,
      externalApproval: rules.externalApproval, emptyAssignToIds: rules.emptyAssignToIds, catchNotifyUserIds: rules.catchNotifyUserIds,
    });
  });
});

describe('workflow designer assignee props', () => {
  it('clears role fields when switching from role to user', () => {
    expect(resetAssigneePropsForType({
      assigneeType: 'role',
      roleIds: [2],
      roleNames: ['普通用户'],
      assigneeIds: [9],
      assigneeNames: ['旧成员'],
    }, 'user')).toEqual({ assigneeType: 'user' });
  });

  it('keeps the active source fields while dropping inactive sources', () => {
    expect(clearInactiveAssigneeProps({
      assigneeType: 'deptMember',
      deptMemberDeptIds: [3],
      deptMemberDeptNames: ['财务部'],
      deptMemberIncludeChildren: true,
      roleIds: [2],
      roleNames: ['普通用户'],
    }, 'deptMember')).toEqual({
      assigneeType: 'deptMember',
      deptMemberDeptIds: [3],
      deptMemberDeptNames: ['财务部'],
      deptMemberIncludeChildren: true,
    });
  });

  it('strips UI-only names before flowData is persisted', () => {
    expect(sanitizeAssigneePropsForWrite({
      assigneeType: 'role',
      roleIds: [2],
      roleNames: ['普通用户'],
      userGroupIds: [7],
      userGroupNames: ['采购组'],
    })).toEqual({ assigneeType: 'role', roleIds: [2] });
  });
});
