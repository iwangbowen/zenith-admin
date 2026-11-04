import { describe, expect, it } from 'vitest';
import { paymentMoneyColumn } from './payment-display';

describe('payment display helpers', () => {
  it('renders money column null and signed values', () => {
    const column = paymentMoneyColumn('金额', 'amount', { signed: true });
    expect(column.render?.(null, { amount: null }, 0)).toBe('—');
    expect(column.render?.(1200, { amount: 1200 }, 0)).toBe('+¥12.00');
  });
});
