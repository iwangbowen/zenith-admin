/**
 * 工作流节点超时截止时间计算单测（纯函数）。
 *
 * 覆盖：未配置/禁用/非法 duration → null，minutes/hours/days 单位换算，
 * 默认单位 hours，自定义起始时间。
 */
import { describe, it, expect } from 'vitest';
import { computeTimeoutAt } from './workflow-timeout';

const FROM = new Date('2026-07-05T12:00:00');

describe('computeTimeoutAt', () => {
  it('未配置 / null / 未启用 → null', () => {
    expect(computeTimeoutAt(undefined)).toBeNull();
    expect(computeTimeoutAt(null)).toBeNull();
    expect(computeTimeoutAt({ enabled: false, duration: 2, unit: 'hours' })).toBeNull();
  });

  it.each([0, -5, NaN])('非法 duration %p → null', (duration) => {
    expect(computeTimeoutAt({ enabled: true, duration, unit: 'hours' })).toBeNull();
  });

  it('minutes 换算', () => {
    expect(computeTimeoutAt({ enabled: true, duration: 30, unit: 'minutes' }, FROM)).toEqual(
      new Date('2026-07-05T12:30:00'),
    );
  });

  it('hours 换算', () => {
    expect(computeTimeoutAt({ enabled: true, duration: 2, unit: 'hours' }, FROM)).toEqual(
      new Date('2026-07-05T14:00:00'),
    );
  });

  it('days 换算', () => {
    expect(computeTimeoutAt({ enabled: true, duration: 3, unit: 'days' }, FROM)).toEqual(
      new Date('2026-07-08T12:00:00'),
    );
  });

  it('缺省单位按 hours 处理', () => {
    expect(computeTimeoutAt({ enabled: true, duration: 1 }, FROM)).toEqual(new Date('2026-07-05T13:00:00'));
  });

  it('duration 为数字字符串时可正常换算（表单入参兼容）', () => {
    expect(computeTimeoutAt({ enabled: true, duration: '45' as unknown as number, unit: 'minutes' }, FROM)).toEqual(
      new Date('2026-07-05T12:45:00'),
    );
  });
});
