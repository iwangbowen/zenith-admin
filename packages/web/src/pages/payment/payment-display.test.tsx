import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaymentChannelTag, paymentMoneyColumn } from './payment-display';

describe('payment display helpers', () => {
  it('renders channel tag in text-only mode', () => {
    render(<PaymentChannelTag channel="wechat" textOnly />);
    expect(screen.getByText('微信支付')).toBeInTheDocument();
  });

  it('renders money column null and signed values', () => {
    const column = paymentMoneyColumn('金额', 'amount', { signed: true });
    expect(column.render?.(null, { amount: null }, 0)).toBe('-');
    expect(column.render?.(1200, { amount: 1200 }, 0)).toBe('+¥12.00');
  });
});
