import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CmsContentCardList } from './CmsContentList';

describe('CmsContentCardList', () => {
  it('renders title and non-article content type tag', () => {
    render(
      <CmsContentCardList
        items={[{ contentId: 1, title: '视频内容', contentType: 'media', url: null }]}
        meta={() => '最近浏览 2024-01-01 00:00:00'}
      />,
    );

    expect(screen.getByText('视频内容')).toBeTruthy();
    expect(screen.getByText('音视频')).toBeTruthy();
    expect(screen.getByText('已下线')).toBeTruthy();
  });
});
