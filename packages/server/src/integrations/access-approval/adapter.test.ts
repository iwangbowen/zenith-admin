import { describe, expect, it } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { workflowDesignPolicySchema, type WorkflowAdvancedSettings } from '@zenith/shared/workflow';
import { accessWorkflowBusinessAdapter } from './adapter';

describe('policy-owned access workflow definition', () => {
  it('normalizes nodes and audit settings while preserving supported presentation preferences', () => {
    const design = accessWorkflowBusinessAdapter.definitionDesign!;
    const settings: WorkflowAdvancedSettings = { allowWithdraw: false, allowResubmit: true, notifyInitiator: false, approverDedupMode: 'all', summaryFields: ['reason'], allowComment: false, notifyChannels: { email: true }, print: { watermark: true } };
    const flow = design.normalizeFlow({ nodes: [], edges: [], settings });
    expect(flow.nodes.some(node => node.data.key === 'approve_second_security')).toBe(true);
    expect(flow.nodes.filter(node => node.data.type === 'exclusiveGateway')).toHaveLength(1);
    expect(flow.settings).toMatchObject({ allowWithdraw: true, allowResubmit: false, notifyInitiator: true, approverDedupMode: 'none', allowComment: false, notifyChannels: { email: true }, print: { watermark: true } });
    expect(workflowDesignPolicySchema.parse({ description: design.description, lockedSettings: design.lockedSettings }).lockedSettings).toEqual(design.lockedSettings);
    const overwrittenSettings = (Object.keys(settings) as (keyof WorkflowAdvancedSettings)[])
      .filter(key => !isDeepStrictEqual(settings[key], flow.settings?.[key]));
    expect(new Set(design.lockedSettings)).toEqual(new Set(overwrittenSettings));
    expect(design.normalizeFlow(flow)).toEqual(flow);
  });
});
