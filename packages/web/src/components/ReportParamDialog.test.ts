import { describe, expect, it } from 'vitest';
import { buildReportParamInitialValues, normalizeReportParamValues } from './report-param-utils';

describe('ReportParamDialog helpers', () => {
  it('按字段类型生成默认值', () => {
    const values = buildReportParamInitialValues([
      { name: 'keyword', label: '关键词', type: 'string', defaultValue: 'abc', required: false },
      { name: 'amount', label: '金额', type: 'number', defaultValue: '12.5', required: false },
      { name: 'enabled', label: '启用', type: 'boolean', defaultValue: 'true', required: false },
      { name: 'bizDate', label: '日期', type: 'date', defaultValue: '2026-07-10', required: false },
    ]);

    expect(values.keyword).toBe('abc');
    expect(values.amount).toBe(12.5);
    expect(values.enabled).toBe(true);
    expect(values.bizDate).toBe('2026-07-10');
  });

  it('提交前做类型归一化与空值裁剪', () => {
    const output = normalizeReportParamValues(
      [
        { name: 'keyword', label: '关键词', type: 'string', required: false },
        { name: 'amount', label: '金额', type: 'number', required: false },
        { name: 'enabled', label: '启用', type: 'boolean', required: false },
        { name: 'bizDate', label: '日期', type: 'date', required: false },
      ],
      {
        keyword: ' test ',
        amount: '8',
        enabled: false,
        bizDate: new Date('2026-07-10T00:00:00'),
      },
    );

    expect(output).toEqual({
      keyword: ' test ',
      amount: 8,
      enabled: false,
      bizDate: '2026-07-10',
    });
  });
});
