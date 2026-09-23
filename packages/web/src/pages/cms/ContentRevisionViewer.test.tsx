import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockCmsContents, mockCmsModels } from '@/mocks/data/cms';
import { ContentRevisionViewer } from './ContentRevisionViewer';

describe('完整内容修订查看器', () => {
  it('shows frozen media, attachments, model fields and scheduling data needed by an approver', () => {
    const field = mockCmsModels.flatMap((model) => model.fields ?? [])[0];
    const content = {
      ...structuredClone(mockCmsContents[0]),
      revisionId: 71,
      title: '送审图集',
      contentType: 'album' as const,
      body: '<p>送审正文</p>',
      mediaData: { images: [{ url: '/frozen-image.png', caption: '修订中的图片说明' }] },
      attachments: [{ name: '审查材料.pdf', url: '/frozen-file.pdf', size: 1024, ext: 'pdf', sort: 0 }],
      extend: { approval_note: '<p>固定字段内容</p>' },
      modelFields: [{ ...field, id: 99, modelId: 1, name: 'approval_note', label: '审批依据', fieldType: 'richtext' as const }],
      scheduledAt: '2026-10-01 09:00:00',
      dueAt: '2026-09-30 17:00:00',
    };
    render(<ContentRevisionViewer content={content} heading="送审固定稿" />);
    expect(screen.getByText('固定修订 #71')).toBeInTheDocument();
    expect(screen.getByText('修订中的图片说明')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /审查材料.pdf/ })).toHaveAttribute('href', '/frozen-file.pdf');
    expect(screen.getByText('审批依据')).toBeInTheDocument();
    expect(screen.getByText('固定字段内容')).toBeInTheDocument();
    expect(screen.getByText('2026-10-01 09:00:00')).toBeInTheDocument();
    expect(screen.getByText('2026-09-30 17:00:00')).toBeInTheDocument();
  });

  it('renders audio/video and an external target while removing executable HTML from previews', () => {
    const content = { ...structuredClone(mockCmsContents[0]), contentType: 'media' as const, externalLink: 'https://example.com/review', body: '<p>可阅读正文</p><script>window.pwned=true</script>', mediaData: { mediaType: 'video' as const, mediaUrl: '/frozen-video.mp4', poster: '/frozen-poster.png' } };
    const view = render(<ContentRevisionViewer content={content} />);
    expect(view.container.querySelector('video')).toHaveAttribute('src', '/frozen-video.mp4');
    expect(view.container.querySelector('script')).toBeNull();
    expect(screen.getByRole('link', { name: 'https://example.com/review' })).toHaveAttribute('href', 'https://example.com/review');
    view.rerender(<ContentRevisionViewer content={{ ...content, mediaData: { mediaType: 'audio', mediaUrl: '/frozen-audio.mp3' } }} />);
    expect(view.container.querySelector('audio')).toHaveAttribute('src', '/frozen-audio.mp3');
  });
});
