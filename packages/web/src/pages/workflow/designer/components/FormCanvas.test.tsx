import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import FormCanvas from './FormCanvas';

const rowField: WorkflowFormField = {
  key: 'row1',
  label: '分栏',
  type: 'row',
  columns: [
    { span: 12, fields: [{ key: 'a', label: '甲', type: 'text' }] },
    { span: 12, fields: [] },
  ],
};

function renderCanvas(onUpdateField = vi.fn()) {
  const utils = render(
    <FormCanvas
      fields={[rowField]}
      selectedKeys={[]}
      onSelect={vi.fn()}
      onMoveField={vi.fn()}
      onRemove={vi.fn()}
      onCopy={vi.fn()}
      onDropNew={vi.fn()}
      onUpdateField={onUpdateField}
    />,
  );
  const resizer = utils.container.querySelector<HTMLElement>('.fd-form-canvas__col-resizer');
  if (!resizer) throw new Error('column resizer not rendered');
  const labels = () => Array.from(utils.container.querySelectorAll('.fd-form-canvas__row-col-label')).map((el) => el.textContent);
  return { ...utils, resizer, labels, onUpdateField };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FormCanvas column resize', () => {
  it('drags against the whole row width, only shows live spans while moving and commits once on release', () => {
    // 整行 240px = 24 栅格 → 10px / span；分隔线挂在列元素内部，列宽（120px）不能作为换算基准
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('fd-form-canvas__row-preview') ? 240 : 120;
      return { width, height: 40, top: 0, left: 0, right: width, bottom: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const { resizer, labels, onUpdateField } = renderCanvas();
    expect(labels()).toEqual(['12/24', '12/24']);

    fireEvent.mouseDown(resizer, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 130 });
    fireEvent.mouseMove(window, { clientX: 133 });
    fireEvent.mouseMove(window, { clientX: 129 });
    // 拖动期间：画布即时反映列宽（+3 span），但字段树 / 历史栈一次都不提交
    expect(labels()).toEqual(['15/24', '9/24']);
    expect(onUpdateField).not.toHaveBeenCalled();

    fireEvent.mouseUp(window, { clientX: 129 });
    expect(onUpdateField).toHaveBeenCalledTimes(1);
    expect(onUpdateField).toHaveBeenCalledWith('row1', {
      columns: [
        { span: 15, fields: rowField.columns![0].fields },
        { span: 9, fields: [] },
      ],
    });
  });

  it('clamps each column to at least 4 spans and skips the commit when the width did not change', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 240, height: 40, top: 0, left: 0, right: 240, bottom: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const { resizer, labels, onUpdateField } = renderCanvas();

    fireEvent.mouseDown(resizer, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(labels()).toEqual(['20/24', '4/24']);
    fireEvent.mouseMove(window, { clientX: 100 });
    expect(labels()).toEqual(['12/24', '12/24']);
    fireEvent.mouseUp(window, { clientX: 100 });
    expect(onUpdateField).not.toHaveBeenCalled();
  });

  it('ends the gesture when the window loses focus', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 240, height: 40, top: 0, left: 0, right: 240, bottom: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const { resizer, labels, onUpdateField } = renderCanvas();

    fireEvent.mouseDown(resizer, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 120 });
    fireEvent.blur(window);
    expect(onUpdateField).toHaveBeenCalledTimes(1);
    // 手势结束后不再响应后续 mousemove
    fireEvent.mouseMove(window, { clientX: 160 });
    expect(labels()).toEqual(['12/24', '12/24']);
    expect(onUpdateField).toHaveBeenCalledTimes(1);
  });
});
