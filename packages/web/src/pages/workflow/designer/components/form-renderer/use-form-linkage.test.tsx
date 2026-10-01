import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { useFormLinkage } from './use-form-linkage';

vi.mock('@/hooks/queries/workflow-designer', () => ({ fetchWorkflowDataSourceRecord: vi.fn() }));
const fields: WorkflowFormField[] = [
  { key: 'amount', type: 'amount', label: '金额', defaultValue: 100 },
  { key: 'total', type: 'formula', label: '合计', formula: '{amount} * 2' },
];

describe('form linkage initialization and submitted snapshots', () => {
  it('normalizes mounted values and sends the same derived value to the form and consumer', () => {
    const setValue = vi.fn();
    const onValueChange = vi.fn();
    const { result } = renderHook(() => useFormLinkage({ fields, all: fields,
      initValues: { amount: 80, total: 0 }, formApiRef: { current: { setValue } as unknown as FormApi }, onValueChange,
    }));
    expect(result.current.enrichedInitValues).toEqual({ amount: 80, total: 160 });
    act(() => result.current.handleValueChange({ amount: 90, total: 160 }));
    expect(setValue).toHaveBeenCalledWith('total', 180);
    expect(onValueChange).toHaveBeenLastCalledWith({ amount: 90, total: 180 });
  });

  it('does not recalculate or overwrite stored formula values in read-only views', () => {
    const setValue = vi.fn();
    const snapshot = { amount: 80, total: 123 };
    const { result } = renderHook(() => useFormLinkage({ fields, all: fields, initValues: snapshot,
      readOnly: true, formApiRef: { current: { setValue } as unknown as FormApi },
    }));
    expect(result.current.enrichedInitValues).toBe(snapshot);
    act(() => result.current.handleValueChange(snapshot));
    expect(result.current.valuesState).toEqual(snapshot);
    expect(setValue).not.toHaveBeenCalled();
  });
});
