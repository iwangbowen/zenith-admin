import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FreshnessBadge, PartialDataBanner } from './ObservabilityStatus';

describe('observability status display', () => {
  it.each([
    ['stale', '已过期 · 45 秒前更新'],
    ['not_sampled', '未采样 · 尚未采样'],
    ['unavailable', '不可用 · 不可读取'],
  ] as const)('keeps %s distinct from a healthy zero value', (status, text) => {
    render(<FreshnessBadge status={status} ageSeconds={status === 'stale' ? 45 : null} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/0 秒前更新/)).not.toBeInTheDocument();
  });

  it('only names sources that are genuinely unavailable or unsampled', () => {
    render(<PartialDataBanner partial unavailableSources={['队列深度', 'OpenTelemetry']} />);
    expect(screen.getByText(/队列深度、OpenTelemetry/)).toBeInTheDocument();
    expect(screen.getByText(/不会把缺失数据显示为 0/)).toBeInTheDocument();
  });
});
