import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SearchToolbar } from './SearchToolbar';

describe('SearchToolbar', () => {
  it('renders without crashing without any props', () => {
    const { container } = render(<SearchToolbar />);
    expect(container.querySelector('.search-area')).toBeInTheDocument();
    expect(container.querySelector('.responsive-toolbar')).toBeInTheDocument();
  });

  it('renders left block', () => {
    render(<SearchToolbar left={<span>LeftContent</span>} />);
    expect(screen.getByText('LeftContent')).toBeInTheDocument();
    expect(document.querySelector('.responsive-toolbar__left')).toBeInTheDocument();
  });

  it('renders right block', () => {
    render(<SearchToolbar right={<span>RightContent</span>} />);
    expect(screen.getByText('RightContent')).toBeInTheDocument();
    expect(document.querySelector('.responsive-toolbar__right')).toBeInTheDocument();
  });

  it('renders children below toolbar', () => {
    render(
      <SearchToolbar>
        <div>ChildContent</div>
      </SearchToolbar>
    );
    expect(screen.getByText('ChildContent')).toBeInTheDocument();
  });

  it('applies custom className to toolbar', () => {
    render(<SearchToolbar className="custom-class" />);
    expect(document.querySelector('.custom-class')).toBeInTheDocument();
    expect(document.querySelector('.responsive-toolbar.custom-class')).toBeInTheDocument();
  });

  it('applies custom className to left area', () => {
    render(<SearchToolbar left={<span />} className="custom-class" />);
    expect(document.querySelector('.responsive-toolbar__left.custom-class__left')).toBeInTheDocument();
  });

  it('applies custom className to right area', () => {
    render(<SearchToolbar right={<span />} className="custom-class" />);
    expect(document.querySelector('.responsive-toolbar__right.custom-class__right')).toBeInTheDocument();
  });

  it('renders all parts at once', () => {
    render(
      <SearchToolbar left={<span>Left</span>} right={<span>Right</span>}>
        <span>Bottom</span>
      </SearchToolbar>
    );
    expect(screen.getByText('Left')).toBeInTheDocument();
    expect(screen.getByText('Right')).toBeInTheDocument();
    expect(screen.getByText('Bottom')).toBeInTheDocument();
  });
});
