import { describe, expect, expectTypeOf, it } from 'vitest';
import { WORKFLOW_DESIGN_LOCKABLE_SETTINGS, type WorkflowDesignLockableSetting } from './constants';
import { workflowDefinitionSchema, workflowDesignPolicySchema, type WorkflowDesignPolicy } from './contracts/definitions';

describe('workflow design policy contract', () => {
  const policy = { description: '由业务策略生成流程图', lockedSettings: [...WORKFLOW_DESIGN_LOCKABLE_SETTINGS] };
  const definitionSchema = workflowDefinitionSchema.pick({ designPolicy: true });

  it('infers the supported setting keys from the response contract', () => {
    expectTypeOf<WorkflowDesignPolicy['lockedSettings'][number]>().toEqualTypeOf<WorkflowDesignLockableSetting>();
    expectTypeOf<WorkflowDesignLockableSetting>().toEqualTypeOf<'allowWithdraw' | 'allowResubmit' | 'notifyInitiator' | 'approverDedupMode' | 'summaryFields'>();
  });

  it('allows omitted policy metadata and an explicitly empty setting lock list', () => {
    expect(definitionSchema.parse({})).toEqual({});
    expect(definitionSchema.parse({ designPolicy: { ...policy, lockedSettings: [] } })).toEqual({
      designPolicy: { ...policy, lockedSettings: [] },
    });
    expect(definitionSchema.safeParse({ designPolicy: null }).success).toBe(false);
  });

  it.each(WORKFLOW_DESIGN_LOCKABLE_SETTINGS)('accepts supported setting %s', setting => {
    expect(workflowDesignPolicySchema.parse({ ...policy, lockedSettings: [setting] }).lockedSettings).toEqual([setting]);
  });

  it.each(['allowWithdaw', 'allowComment', 'numbering', 'notifyChannels', 'print'])('rejects unsupported setting %s', setting => {
    expect(workflowDesignPolicySchema.safeParse({ ...policy, lockedSettings: [setting] }).success).toBe(false);
  });

  it('requires a nonempty explanation and a setting lock list', () => {
    for (const description of ['', '   ', undefined, null]) {
      expect(workflowDesignPolicySchema.safeParse({ ...policy, description }).success).toBe(false);
    }
    expect(workflowDesignPolicySchema.safeParse({ description: policy.description }).success).toBe(false);
  });

  it('rejects undeclared policy metadata', () => {
    expect(workflowDesignPolicySchema.safeParse({ ...policy, readOnly: false }).success).toBe(false);
  });
});
