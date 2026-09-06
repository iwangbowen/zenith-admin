import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TerminalPanelButton, TerminalTabIcon } from './TerminalTabChrome';
import type { PaneLeaf } from './paneTree';

vi.mock('@iconify/react', () => ({ Icon: ({ icon, width, height }: { icon: string; width: number; height: number }) => <svg data-testid="iconify" data-icon={icon} width={width} height={height} /> }));
vi.mock('@/utils/fileIcons', () => ({ getFileIcon: (name: string) => `file:${name}`, getShellIcon: (shell?: string) => `shell:${shell ?? 'default'}` }));
vi.mock('@douyinfe/semi-ui', () => ({
  Button: ({ icon, type, onClick }: { icon?: ReactNode; type?: string; onClick?: () => void }) => <button type="button" data-button-type={type} onClick={onClick}>{icon}</button>,
  Tooltip: ({ children, content, position }: { children: ReactNode; content?: ReactNode; position?: string }) => (
    <span data-tooltip-content={typeof content === 'string' ? content : ''} data-tooltip-position={position ?? ''}>{children}</span>
  ),
}));

const terminalLeaf: PaneLeaf = { type: 'leaf', id: 'p1', stableSessionId: 's1', kind: 'terminal', title: 'PowerShell', shell: 'pwsh' };
const editorLeaf: PaneLeaf = { type: 'leaf', id: 'p2', stableSessionId: 's2', kind: 'editor', title: 'README.md', filePath: 'README.md' };

describe('TerminalPanelButton', () => {
  it('renders inactive tooltip and tertiary type', () => {
    const onToggle = vi.fn();
    const { container } = render(<TerminalPanelButton panel="ssh" activePanel={null} onToggle={onToggle} tooltipPosition="left" />);
    expect(container.querySelector('[data-tooltip-content="管理 SSH 连接"]')?.getAttribute('data-tooltip-position')).toBe('left');
    expect(screen.getByRole('button').getAttribute('data-button-type')).toBe('tertiary');
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledWith('ssh');
  });

  it('renders active tooltip and primary type', () => {
    const { container } = render(<TerminalPanelButton panel="docker" activePanel="docker" onToggle={() => {}} />);
    expect(container.querySelector('[data-tooltip-content="隐藏 Docker 容器"]')).toBeTruthy();
    expect(screen.getByRole('button').getAttribute('data-button-type')).toBe('primary');
  });
});

describe('TerminalTabIcon', () => {
  it('selects shell icons for terminal leaves', () => {
    render(<TerminalTabIcon leaf={terminalLeaf} size={13} />);
    expect(screen.getByTestId('iconify').getAttribute('data-icon')).toBe('shell:pwsh');
    expect(screen.getByTestId('iconify').getAttribute('width')).toBe('13');
  });

  it('selects file icons for editor leaves', () => {
    render(<TerminalTabIcon leaf={editorLeaf} size={14} />);
    expect(screen.getByTestId('iconify').getAttribute('data-icon')).toBe('file:README.md');
    expect(screen.getByTestId('iconify').getAttribute('height')).toBe('14');
  });
});
