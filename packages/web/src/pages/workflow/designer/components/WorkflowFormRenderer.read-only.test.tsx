import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { copyTextWithToast } from '@/utils/clipboard';
import WorkflowFormRenderer from './WorkflowFormRenderer';

vi.mock('@/utils/clipboard', () => ({ copyTextWithToast: vi.fn().mockResolvedValue(true) }));

describe('submitted workflow values', () => {
  it('copies visible detail values and totals without revealing conditionally hidden cells', async () => {
    const field: WorkflowFormField = { key: 'expenses', label: '费用明细', type: 'detail', children: [
      { key: 'kind', label: '费用类别', type: 'select', optionItems: [{ value: 'transport', label: '交通' }, { value: 'private', label: '内部' }] },
      { key: 'amount', label: '金额', type: 'amount', precision: 2, detailSummary: true,
        visibilityCondition: { field: 'kind', operator: 'neq', value: 'private' } },
    ] };
    render(<WorkflowFormRenderer fields={[field]} readOnly readOnlyAsText initValues={{ expenses: [
      { kind: 'transport', amount: 3200.5 }, { kind: 'private', amount: 9876543 },
    ] }} />);
    expect(screen.queryByText(/9,876,543/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制明细' }));
    await waitFor(() => expect(copyTextWithToast).toHaveBeenCalled());
    const copied = vi.mocked(copyTextWithToast).mock.calls.at(-1)?.[0];
    expect(copied).toContain('交通\t3,200.50');
    expect(copied).toContain('内部\t—');
    expect(copied).not.toContain('9876543');
    expect(copied).not.toContain('9,876,543');
    expect(copied?.split('\n').at(-1)).toBe('\t3,200.50');
  });
});
