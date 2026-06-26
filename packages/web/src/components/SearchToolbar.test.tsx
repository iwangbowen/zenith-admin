import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SearchToolbar } from './SearchToolbar';

describe('SearchToolbar', () => {
  it('renders without crashing without any props', () => {
    const { container } = render(<SearchToolbar />);
    expect(container.querySelector('.search-area')).not.toBeNull();
    expect(container.querySelector('.responsive-toolbar')).not.toBeNull();
  });

  it('renders children as toolbar content', () => {
    render(
      <SearchToolbar>
        <span>SearchContent</span>
      </SearchToolbar>
    );
    expect(screen.getByText('SearchContent')).toBeTruthy();
  });

  it('applies custom className to toolbar', () => {
    render(<SearchToolbar className="custom-class" />);
    expect(document.querySelector('.custom-class')).not.toBeNull();
    expect(document.querySelector('.responsive-toolbar.custom-class')).not.toBeNull();
  });

  it('renders multiple children inside toolbar', () => {
    render(
      <SearchToolbar>
        <span>Button1</span>
        <span>Button2</span>
        <span>Button3</span>
      </SearchToolbar>
    );
    expect(screen.getByText('Button1')).toBeTruthy();
    expect(screen.getByText('Button2')).toBeTruthy();
    expect(screen.getByText('Button3')).toBeTruthy();
  });
});
