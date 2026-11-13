import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';

const confirmCalls = vi.hoisted(() => [] as ModalReactProps[]);
vi.mock('@douyinfe/semi-ui', () => ({
  Modal: { confirm: (config: ModalReactProps) => { confirmCalls.push(config); } },
  Switch: () => null,
  Toast: { success: vi.fn() },
}));

import { useStatusToggle } from './useStatusToggle';

interface Row { id: number; name: string; status: 'enabled' | 'disabled' }
const row: Row = { id: 1, name: '模板 A', status: 'enabled' };

beforeEach(() => { confirmCalls.length = 0; });
afterEach(() => { vi.clearAllMocks(); });

describe('status change commands', () => {
  it('executes an unguarded change with the exact record and target status', async () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useStatusToggle<Row>({ toggle }));
    await act(async () => { result.current.request(row, true); });
    expect(toggle).toHaveBeenCalledExactlyOnceWith(row, true);
    expect(confirmCalls).toHaveLength(0);
  });

  it('does not perform a guarded disable until confirmation', async () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useStatusToggle<Row>({ toggle, confirmDisable: () => ({ title: '停用确认' }) }));
    act(() => { result.current.request(row, false); });
    expect(toggle).not.toHaveBeenCalled();
    expect(confirmCalls).toHaveLength(1);
    await act(async () => { await confirmCalls[0].onOk?.({} as never); });
    await waitFor(() => expect(toggle).toHaveBeenCalledExactlyOnceWith(row, false));
  });
});
