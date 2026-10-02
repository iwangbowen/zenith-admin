import { describe, expect, it } from 'vitest';
import type { WorkflowNodeActivation, WorkflowApprovalSlot } from './contracts/approval-state';
import { evaluateWorkflowApprovalActivation } from './approval-runtime';

function activation(method: 'and' | 'or' | 'sequential' | 'ratio', position: 'before' | 'after' | 'parallel', signMode: 'and' | 'or'): WorkflowNodeActivation {
  const slot = (id: number, origin: 'base' | 'addSign'): WorkflowApprovalSlot => ({
    id, activationId: 'round-one', origin, groupId: origin === 'base' ? null : 100,
    originalAssigneeId: id, currentAssigneeId: id, assigneeName: `处理人${id}`,
    status: 'pending', order: origin === 'base' ? id - 1 : null, mandatory: false, currentTaskId: id,
  });
  const slots = [1, 2, 3].map((id) => slot(id, 'base')).concat([4, 5].map((id) => slot(id, 'addSign')));
  return { id: 'round-one', nodeKey: 'review', nodeName: '联合审批', tokenId: 1, status: 'active',
    approveMethod: method, approveRatio: method === 'ratio' ? 66 : null,
    baseTotal: 3, baseRequired: method === 'or' ? 1 : method === 'ratio' ? 2 : 3,
    baseApproved: 0, baseRejected: 0, baseSatisfied: false, slots,
    signGroups: [{ id: 100, activationId: 'round-one', anchorSlotId: 1, position, signMode,
      status: position === 'after' ? 'waiting' : 'active', createdBy: 1, createdAt: '2026-10-02 08:00:00', canReduce: true, slots: slots.filter((item) => item.origin === 'addSign') }],
  };
}

function decide(input: WorkflowNodeActivation, id: number, status: 'approved' | 'rejected' | 'cancelled') {
  return evaluateWorkflowApprovalActivation({ ...input, slots: input.slots.map((slot) => slot.id === id ? { ...slot, status } : slot) });
}

describe('formal approval seats and supplemental groups', () => {
  for (const method of ['and', 'or', 'sequential', 'ratio'] as const) {
    for (const position of ['before', 'after', 'parallel'] as const) {
      for (const signMode of ['and', 'or'] as const) {
        it(`${method}: ${position} group ${signMode} preserves base votes and completes through ready seats`, () => {
          let state = evaluateWorkflowApprovalActivation(activation(method, position, signMode));
          if (position === 'before') expect(state.waitReasons[1]).toBe('beforeSign');
          if (position === 'after') expect(state.waitReasons[4]).toBe('afterSign');
          for (let step = 0; step < 10 && !state.completed; step++) {
            const eligible = state.activation.slots.filter((slot) => slot.status === 'pending' && state.waitReasons[slot.id] === null);
            const next = eligible.find((slot) => slot.origin === 'addSign') ?? eligible.find((slot) => slot.id === 1) ?? eligible[0];
            expect(next).toBeDefined();
            if (!next) throw new Error('No legal next seat');
            state = decide(state.activation, next.id, 'approved');
            expect(state.activation.baseTotal).toBe(3);
            expect(state.activation.baseRequired).toBe(method === 'or' ? 1 : method === 'ratio' ? 2 : 3);
          }
          expect(state.failed).toBe(false);
          expect(state.completed).toBe(true);
          expect(state.activation.signGroups[0].status).toBe('approved');
          if (position !== 'parallel') expect(state.activation.slots.find((slot) => slot.id === 1)?.status).toBe('approved');
        });
      }
    }
  }

  it('does not unlock a sequential successor while the previous after group is unfinished', () => {
    const approvedAnchor = decide(activation('sequential', 'after', 'and'), 1, 'approved');
    expect(approvedAnchor.waitReasons[4]).toBeNull();
    expect(approvedAnchor.waitReasons[2]).toBe('sequence');
    const partial = decide(approvedAnchor.activation, 4, 'approved');
    expect(partial.waitReasons[2]).toBe('sequence');
    expect(decide(partial.activation, 5, 'approved').waitReasons[2]).toBeNull();
  });

  it('keeps an after anchor mandatory when an unrelated OR vote already satisfies the base rule', () => {
    const state = decide(activation('or', 'after', 'and'), 2, 'approved');
    expect(state.activation.baseSatisfied).toBe(true);
    expect(state.completed).toBe(false);
    expect(state.activation.slots.find((slot) => slot.id === 1)).toMatchObject({ status: 'pending', mandatory: true });
    expect(state.waitReasons[4]).toBe('afterSign');
    expect(decide(state.activation, 1, 'rejected').failed).toBe(true);
  });

  it('allows a supplemental OR group to collect another opinion after a partial refusal', () => {
    const partial = decide(activation('and', 'before', 'or'), 4, 'rejected');
    expect(partial.failed).toBe(false);
    expect(partial.waitReasons[1]).toBe('beforeSign');
    const resolved = decide(partial.activation, 5, 'approved');
    expect(resolved.failed).toBe(false);
    expect(resolved.activation.signGroups[0].status).toBe('approved');
    expect(resolved.waitReasons[1]).toBeNull();
    expect(resolved.activation.baseApproved).toBe(0);
  });

  it('releases a fully reduced group without adding any vote or retaining the mandatory flag', () => {
    const first = decide(activation('or', 'before', 'and'), 4, 'cancelled');
    const result = decide(first.activation, 5, 'cancelled');
    expect(result.activation.signGroups[0].status).toBe('cancelled');
    expect(result.activation.slots.find((slot) => slot.id === 1)?.mandatory).toBe(false);
    expect(result.waitReasons[1]).toBeNull();
    expect(result.activation.baseApproved).toBe(0);
    expect(result.completed).toBe(false);
  });

  it('fails a ratio only when the frozen number of base votes can no longer be reached', () => {
    const first = decide(activation('ratio', 'parallel', 'and'), 1, 'rejected');
    expect(first.failed).toBe(false);
    expect(decide(first.activation, 2, 'rejected').failed).toBe(true);
  });
});
