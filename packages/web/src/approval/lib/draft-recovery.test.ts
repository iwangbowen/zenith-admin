import { describe, expect, it } from 'vitest';
import { safeRecoveryValues } from './draft-recovery';

describe('approval local recovery', () => {
  it('keeps business values but never restores credentials or signatures', () => {
    const fields = [{ key: 'amount', type: 'number', label: '金额' }, { key: 'sign', type: 'signature', label: '签名' }, { key: 'secret', type: 'password', label: '密码' }] as const;
    expect(safeRecoveryValues(fields, { amount: 12, sign: 'png', secret: 'password' })).toEqual({ amount: 12 });
  });
});
