import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiMessageSnippet, AiUserCell } from './ai-display';

describe('ai-display', () => {
  it('renders nickname and username in the shared user cell', () => {
    render(<AiUserCell username="alice" nickname="Alice" />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('renders an empty marker for missing snippets', () => {
    render(<AiMessageSnippet text={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
