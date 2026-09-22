import { describe, it, expect } from 'vitest';
import { LOGIN_TREND_SERIES, loginLogsDrillUrl, operationLogsDrillUrl } from './dashboard-drilldown';

/** 目标页用 useListDeepLink 消费这些参数，因此断言按查询参数而非整串比对 */
function paramsOf(url: string): { pathname: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://localhost');
  return { pathname: parsed.pathname, params: parsed.searchParams };
}

describe('loginLogsDrillUrl', () => {
  it('按某天与系列名落到登录日志的当天区间', () => {
    const { pathname, params } = paramsOf(loginLogsDrillUrl('2026-09-20', '失败'));
    expect(pathname).toBe('/system/login-logs');
    expect(params.get('status')).toBe('fail');
    expect(params.get('startTime')).toBe('2026-09-20 00:00:00');
    expect(params.get('endTime')).toBe('2026-09-20 23:59:59');
  });

  it('成功系列映射为 success', () => {
    expect(paramsOf(loginLogsDrillUrl('2026-09-20', '成功')).params.get('status')).toBe('success');
  });

  it('系列名认不出时只带时间范围，不误筛状态', () => {
    const { params } = paramsOf(loginLogsDrillUrl('2026-09-20', '未知'));
    expect(params.get('status')).toBeNull();
    expect(params.get('startTime')).toBe('2026-09-20 00:00:00');
  });

  it('系列选项自身带着下钻状态，两者不会各写一份映射', () => {
    expect(LOGIN_TREND_SERIES.map((s) => s.name)).toEqual(['成功', '失败']);
    expect(LOGIN_TREND_SERIES.map((s) => s.status)).toEqual(['success', 'fail']);
  });
});

describe('operationLogsDrillUrl', () => {
  it('按模块名落到操作日志', () => {
    const { pathname, params } = paramsOf(operationLogsDrillUrl('用户管理'));
    expect(pathname).toBe('/system/operation-logs');
    expect(params.get('module')).toBe('用户管理');
  });
});
