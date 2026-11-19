import { describe, expect, it } from 'vitest';
import { saveWorkflowSimulationCaseSchema, simulateWorkflowSchema, workflowSimulationDecisionSchema } from './validation';

describe('memory simulation command contract', () => {
  it('preserves explicit task identity, execution path and candidate decisions', () => {
    const command = { nodeKey: 'finance', taskId: 13, executionPath: 'root/contract-8/0', action: 'approve', selectedNextApprovers: { manager: [2] }, requirementsConfirmed: true };
    expect(workflowSimulationDecisionSchema.parse(command)).toEqual(command);
  });
  it('preserves deterministic time, random seed and initial candidate selections in saved cases', () => {
    const saved = saveWorkflowSimulationCaseSchema.parse({ definitionId: 1, name: '采购会签', formData: { amount: 28000 }, decisions: [{ nodeKey: 'clock', action: 'advanceTime', minutes: 120 }],
      runtimeConfig: { now: 1795050000000, seed: 42, selectedInitiatorApprovers: { legal: [3, 4] } } });
    expect(JSON.parse(JSON.stringify(saved)).runtimeConfig).toEqual(saved.runtimeConfig);
  });
  it('bounds virtual time and refuses incomplete simulation case contexts', () => {
    expect(workflowSimulationDecisionSchema.safeParse({ nodeKey: 'clock', action: 'advanceTime', minutes: -1 }).success).toBe(false);
    expect(saveWorkflowSimulationCaseSchema.safeParse({ definitionId: 1, name: 'missing runtime context' }).success).toBe(false);
    expect(simulateWorkflowSchema.safeParse({ definitionId: 1, options: { maxSteps: 501 } }).success).toBe(false);
  });
});
