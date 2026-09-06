import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandOutputPanel } from './CommandOutputPanel';

describe('CommandOutputPanel', () => {
  it('renders the empty placeholder in the default pre panel', () => {
    render(<CommandOutputPanel output="" emptyText="等待输出..." />);
    expect(screen.getByText('等待输出...')).toBeTruthy();
    expect(screen.getByText('等待输出...').closest('pre')).toBeTruthy();
  });

  it('renders the running tag in the header', () => {
    render(<CommandOutputPanel output="hello" running runningText="● 实时追踪中" emptyText="空" header="输出" />);
    expect(screen.getByText('输出')).toBeTruthy();
    expect(screen.getByText('● 实时追踪中')).toBeTruthy();
  });

  it('renders custom children for formatted output', () => {
    render(
      <CommandOutputPanel output="formatted" emptyText="空">
        <div data-testid="ansi-output"><span>彩色输出</span></div>
      </CommandOutputPanel>,
    );
    expect(screen.getByTestId('ansi-output')).toBeTruthy();
    expect(screen.getByText('彩色输出')).toBeTruthy();
    expect(screen.queryByText('空')).toBeNull();
  });
});
