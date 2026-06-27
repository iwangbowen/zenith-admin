/**
 * 报表打印填充引擎单测（@zenith/shared 纯函数，无 DB 依赖）。
 * 覆盖：#{标量} / ${明细带纵向扩展} / ${SUM 聚合} / 混合文本、
 *      空数据保留单行空带、合并单元格（非带区整体下移 / 带内随数据克隆）、页眉页脚占位符。
 */
import { describe, it, expect } from 'vitest';
import { fillPrintGrid, resolvePrintBandText } from '@zenith/shared';
import type { ReportPrintGrid } from '@zenith/shared';

const cellAt = (g: ReportPrintGrid, r: number, c: number) => g.cells.find((x) => x.row === r && x.col === c)?.v;

describe('fillPrintGrid - 标量/明细带/聚合', () => {
  const tpl: ReportPrintGrid = {
    rows: 3,
    cols: 2,
    cells: [
      { row: 0, col: 0, v: '#{title}' },
      { row: 1, col: 0, v: '${name}' },
      { row: 1, col: 1, v: '${qty}' },
      { row: 2, col: 0, v: '合计' },
      { row: 2, col: 1, v: '${SUM(qty)}' },
    ],
  };
  const rows = [
    { title: '订单', name: 'A', qty: 2 },
    { title: '订单', name: 'B', qty: 3 },
  ];

  it('明细带按数据行纵向扩展，标量取首行，聚合求和', () => {
    const out = fillPrintGrid(tpl, rows);
    expect(out.rows).toBe(4); // 1 表头 + 2 明细 + 1 合计
    expect(cellAt(out, 0, 0)).toBe('订单');         // #{title} 标量
    expect(cellAt(out, 1, 0)).toBe('A');
    expect(cellAt(out, 1, 1)).toBe(2);              // 单一 ${qty} 保留数值类型
    expect(cellAt(out, 2, 0)).toBe('B');
    expect(cellAt(out, 2, 1)).toBe(3);
    expect(cellAt(out, 3, 0)).toBe('合计');
    expect(cellAt(out, 3, 1)).toBe(5);              // SUM(qty)
  });

  it('混合文本逐行替换', () => {
    const t: ReportPrintGrid = { rows: 1, cols: 1, cells: [{ row: 0, col: 0, v: '编号:${name}' }] };
    const out = fillPrintGrid(t, [{ name: 'X' }]);
    expect(cellAt(out, 0, 0)).toBe('编号:X');
  });

  it('空数据集保留单行空带，聚合为 0', () => {
    const out = fillPrintGrid(tpl, []);
    expect(out.rows).toBe(3); // 表头 + 1 空带 + 合计
    expect(cellAt(out, 0, 0)).toBe('');   // 无首行
    expect(cellAt(out, 1, 0)).toBe('');   // 空带
    expect(cellAt(out, 2, 1)).toBe(0);    // SUM 空集
  });
});

describe('fillPrintGrid - 合并单元格', () => {
  it('非带区纵向合并随上方带扩展整体下移', () => {
    const tpl: ReportPrintGrid = {
      rows: 3, cols: 1,
      cells: [
        { row: 0, col: 0, v: '${name}' },     // 明细带
        { row: 1, col: 0, v: '合计' },
        { row: 2, col: 0, v: '签字' },
      ],
      merges: [{ row: 1, col: 0, rowSpan: 2, colSpan: 1 }], // 非带区竖向合并
    };
    const out = fillPrintGrid(tpl, [{ name: 'A' }, { name: 'B' }]);
    // 带扩展为 2 行后，合并应下移到输出第 2 行
    expect(out.merges).toEqual([{ row: 2, col: 0, rowSpan: 2, colSpan: 1 }]);
  });

  it('带内纵向合并随每条数据克隆', () => {
    const tpl: ReportPrintGrid = {
      rows: 2, cols: 2,
      cells: [
        { row: 0, col: 0, v: '${name}' },
        { row: 1, col: 1, v: '${val}' },
      ],
      merges: [{ row: 0, col: 0, rowSpan: 2, colSpan: 1 }], // 跨整带竖向合并
    };
    const out = fillPrintGrid(tpl, [{ name: 'A', val: 1 }, { name: 'B', val: 2 }]);
    expect(out.merges).toHaveLength(2); // 每条数据各克隆一份
    expect(out.merges?.map((m) => m.row).sort((a, b) => a - b)).toEqual([0, 2]);
  });
});

describe('resolvePrintBandText', () => {
  it('解析 ${param} 与 {page}/{pages}/{date}', () => {
    expect(resolvePrintBandText('${company} 第{page}/{pages} 页 {date}', { company: 'ACME' }, { page: 1, pages: 3, date: '2026-01-01' }))
      .toBe('ACME 第1/3 页 2026-01-01');
  });
  it('空文本返回空串', () => {
    expect(resolvePrintBandText(undefined, {})).toBe('');
  });
  it('未提供的 param 替换为空', () => {
    expect(resolvePrintBandText('${x}-${y}', { x: '1' })).toBe('1-');
  });
});
