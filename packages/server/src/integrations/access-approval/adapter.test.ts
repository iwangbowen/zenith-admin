import { describe, expect, it } from 'vitest';
import { accessWorkflowBusinessAdapter } from './adapter';

describe('policy-owned access workflow definition', () => {
  it('normalizes nodes and audit settings while preserving supported presentation preferences', () => {
    const design = accessWorkflowBusinessAdapter.definitionDesign!;
    const flow = design.normalizeFlow({ nodes: [], edges: [], settings: { allowWithdraw: false, allowResubmit: true, notifyInitiator: false, approverDedupMode: 'all', allowComment: false, notifyChannels: { email: true }, print: { watermark: true } } });
    expect(flow.nodes.some(node => node.data.key === 'approve_second_security')).toBe(true);
    expect(flow.nodes.filter(node => node.data.type === 'exclusiveGateway')).toHaveLength(1);
    expect(flow.settings).toMatchObject({ allowWithdraw: true, allowResubmit: false, notifyInitiator: true, approverDedupMode: 'none', allowComment: false, notifyChannels: { email: true }, print: { watermark: true } });
    expect(design.lockedSettings).toEqual(expect.arrayContaining(['allowResubmit', 'notifyInitiator', 'approverDedupMode']));
    expect(design.normalizeFlow(flow)).toEqual(flow);
  });
});
