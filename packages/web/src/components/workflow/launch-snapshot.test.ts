import { describe, expect, it } from 'vitest';
import { launchSnapshotFromState, sameLaunchValues } from './launch-snapshot';

describe('launch snapshot routing', () => {
  it('restores incomplete fields, attachments, cc and approvers only to their own definition', () => {
    const snapshot = { definitionId: 42, dirty: true,
      values: { title: '', priority: 'urgent', ccUserIds: [3, 4] },
      formData: { reason: '采购申请', requiredYetEmpty: undefined, attachments: [{ id: 9, name: '报价.pdf' }] },
      selectedInitiatorApprovers: { manager: [6] },
    };
    expect(launchSnapshotFromState({ tabTitle: '发起采购', launchSnapshot: snapshot }, 42)).toBe(snapshot);
    expect(launchSnapshotFromState({ launchSnapshot: snapshot }, 43)).toBeUndefined();
  });

  it('ignores field registration and object key order without hiding meaningful edits', () => {
    expect(sameLaunchValues({ amount: 0, proof: [], reason: undefined }, { reason: null, amount: 0 })).toBe(true);
    expect(sameLaunchValues({ amount: 0 }, { amount: 1 })).toBe(false);
    expect(sameLaunchValues({ attachments: [{ id: 9 }] }, { attachments: [{ id: 10 }] })).toBe(false);
  });
});
