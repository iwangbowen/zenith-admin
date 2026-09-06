import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Toast } from '@douyinfe/semi-ui';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStatusToggle, type UseStatusToggleOptions } from './useStatusToggle';

// Modal.confirm 依赖 createRoot 命令式渲染，jsdom 下改为记录配置、由测试手动触发 onOk / onCancel
const confirmCalls = vi.hoisted(() => [] as ModalReactProps[]);
vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  Object.assign(actual.Modal, { confirm: (config: ModalReactProps) => { confirmCalls.push(config); return { destroy() {}, update() {} }; } });
  return actual;
});

interface Row { id: number; name: string; status: 'enabled' | 'disabled' }

function Harness({ rows, options }: Readonly<{ rows: Row[]; options: UseStatusToggleOptions<Row> }>) {
  const status = useStatusToggle<Row>(options);
  const column = status.column();
  return (
    <div>
      <span data-testid="title">{String(column.title)}</span>
      <span data-testid="fixed">{String(column.fixed)}</span>
      <span data-testid="width">{String(column.width)}</span>
      <span data-testid="pending">{String(status.pendingKey)}</span>
      {rows.map((row) => <div key={row.id} data-testid={`row-${row.id}`}>{status.renderSwitch(row)}</div>)}
    </div>
  );
}

const rows: Row[] = [{ id: 1, name: '模板 A', status: 'enabled' }, { id: 2, name: '模板 B', status: 'disabled' }];
const switchIn = (id: number) => screen.getByTestId(`row-${id}`).querySelector('.semi-switch') as HTMLElement;
const clickSwitch = (id: number) => fireEvent.click(screen.getByTestId(`row-${id}`).querySelector('.semi-switch-native-control') as HTMLElement);
const lastConfirm = () => confirmCalls.at(-1)!;

beforeEach(() => { confirmCalls.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('useStatusToggle', () => {
  it('列默认：状态 / 80 / 固定右侧，开关按 status 反映启用态', () => {
    render(<Harness rows={rows} options={{ toggle: () => Promise.resolve() }} />);
    expect(screen.getByTestId('title').textContent).toBe('状态');
    expect(screen.getByTestId('fixed').textContent).toBe('right');
    expect(screen.getByTestId('width').textContent).toBe('80');
    expect(switchIn(1).classList.contains('semi-switch-checked')).toBe(true);
    expect(switchIn(2).classList.contains('semi-switch-checked')).toBe(false);
  });

  it('无确认时直接执行 toggle，成功后提示默认文案并清除行内 loading', async () => {
    const success = vi.spyOn(Toast, 'success');
    let resolve!: () => void;
    const toggle = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<Harness rows={rows} options={{ toggle }} />);
    clickSwitch(2);
    expect(toggle).toHaveBeenCalledWith(rows[1], true);
    expect(confirmCalls).toHaveLength(0);
    expect(screen.getByTestId('pending').textContent).toBe('2');
    await act(async () => { resolve(); });
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('null'));
    expect(success).toHaveBeenCalledWith('已启用');
  });

  it('停用前弹确认（普通样式）；取消不执行，确认后执行并提示「已停用」', async () => {
    const success = vi.spyOn(Toast, 'success');
    const toggle = vi.fn(() => Promise.resolve());
    render(<Harness rows={rows} options={{ toggle, confirmDisable: (r) => ({ title: '确认停用', content: `停用后「${r.name}」不可用` }) }} />);
    clickSwitch(1);
    expect(confirmCalls).toHaveLength(1);
    expect(lastConfirm()).toMatchObject({ title: '确认停用', content: '停用后「模板 A」不可用' });
    expect(lastConfirm().okButtonProps).toBeUndefined();
    expect(toggle).not.toHaveBeenCalled();
    lastConfirm().onCancel?.({} as never);
    expect(toggle).not.toHaveBeenCalled();

    clickSwitch(1);
    await act(async () => { await lastConfirm().onOk?.({} as never); });
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(rows[0], false));
    await waitFor(() => expect(success).toHaveBeenCalledWith('已停用'));
  });

  it('danger 确认注入红色实心确认按钮；自定义与函数式成功文案生效', async () => {
    const success = vi.spyOn(Toast, 'success');
    const toggle = vi.fn(() => Promise.resolve());
    render(<Harness rows={rows} options={{
      toggle,
      confirmDisable: () => ({ title: '确认禁用', danger: true, okText: '确认禁用' }),
      messages: { disabled: (r) => `${r.name} 已禁用` },
    }} />);
    clickSwitch(1);
    expect(lastConfirm()).toMatchObject({ title: '确认禁用', okText: '确认禁用', okButtonProps: { type: 'danger', theme: 'solid' } });
    expect((lastConfirm() as { danger?: boolean }).danger).toBeUndefined();
    await act(async () => { await lastConfirm().onOk?.({} as never); });
    await waitFor(() => expect(success).toHaveBeenCalledWith('模板 A 已禁用'));
  });

  it('禁用态开关不可点击；toggle 失败不提示成功且清除 loading', async () => {
    const success = vi.spyOn(Toast, 'success');
    const toggle = vi.fn(() => Promise.reject(new Error('boom')));
    render(<Harness rows={rows} options={{ toggle, disabled: (r) => r.id === 1 }} />);
    expect(switchIn(1).classList.contains('semi-switch-disabled')).toBe(true);
    expect((screen.getByTestId('row-1').querySelector('.semi-switch-native-control') as HTMLInputElement).disabled).toBe(true);
    clickSwitch(2);
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('null'));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });
});
