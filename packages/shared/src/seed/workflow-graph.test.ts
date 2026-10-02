import { describe, expect, it } from 'vitest';
import { workflowFlowDataSchema } from '../workflow/graph-schema';
import { SEED_WORKFLOW_DEFINITIONS, SEED_WORKFLOW_TEMPLATES } from './workflow';

describe('workflow seed graphs', () => {
  it('all official definitions and templates satisfy the canonical contract', () => {
    for (const item of [...SEED_WORKFLOW_DEFINITIONS, ...SEED_WORKFLOW_TEMPLATES]) {
      const parsed = workflowFlowDataSchema.safeParse(item.flowData);
      expect(parsed.success, item.name + ': ' + JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
});
