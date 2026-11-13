import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsMediaProcessing, CmsResource } from '@zenith/shared/cms';
import CmsMediaProcessingSheet from './CmsMediaProcessingSheet';

const state = vi.hoisted(() => ({ process: vi.fn(), cancel: vi.fn(), editable: true, processing: null as CmsMediaProcessing | null }));
vi.mock('@/hooks/queries/cms-resources', () => ({
  useCmsMedia: () => ({ data: { assetVersionId: 20, processing: state.processing }, isSuccess: true, isLoading: false, isError: false, refetch: vi.fn() }),
  useCmsMediaTask: () => ({ data: undefined }),
  useProcessCmsMedia: () => ({ mutateAsync: state.process, isPending: false }),
}));
vi.mock('@/hooks/queries/async-tasks', () => ({ useAsyncTaskAction: () => ({ mutateAsync: state.cancel, isPending: false }) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => state.editable }) }));
vi.mock('@/components/AsyncTaskProgress', () => ({ default: () => null }));
vi.mock('./CmsResourcePicker', () => ({
  CmsResourcePreview: () => <div>媒体预览</div>,
  CmsResourcePicker: ({ visible, onSelect }: { visible: boolean; onSelect: (resource: CmsResource) => void }) => visible ? <button type="button" onClick={() => onSelect({ id: 30, name: '字幕.vtt', fileId: 'subtitle', siteId: 1 } as CmsResource)}>字幕.vtt</button> : null,
}));
const video = { id: 2, siteId: 1, type: 'video', name: '城市.mp4', url: '/video.mp4', fileId: 'source' } as CmsResource;

beforeEach(() => { state.process.mockReset().mockResolvedValue({ id: 9 }); state.cancel.mockReset(); state.editable = true; state.processing = null; });

describe('CMS media processing sheet', () => {
  it('submits the pinned binary version with an existing site subtitle selection', async () => {
    render(<CmsMediaProcessingSheet resource={video} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '选择本站 VTT 字幕' }));
    fireEvent.click(screen.getByRole('button', { name: '字幕.vtt' }));
    fireEvent.click(screen.getByRole('button', { name: '开始处理' }));
    await waitFor(() => expect(state.process).toHaveBeenCalledWith({ params: { id: 2 }, body: expect.objectContaining({ assetVersionId: 20, subtitleResourceId: 30, subtitleLanguage: 'zh', posterTime: 0 }) }));
  });

  it('shows the failure reason and retries the same version and focal point', async () => {
    state.processing = { id: 1, taskId: null, status: 'failed', errorMessage: '服务器未配置 ffmpeg 可执行程序', focalPoint: { x: 0.2, y: 0.8 }, posterTime: 3 } as CmsMediaProcessing;
    render(<CmsMediaProcessingSheet resource={video} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '重新处理' }));
    await waitFor(() => expect(state.process).toHaveBeenCalledWith({ params: { id: 2 }, body: expect.objectContaining({ assetVersionId: 20, posterTime: 3, focalPoint: { x: 0.2, y: 0.8 } }) }));
  });

  it('prevents a second task while processing and disables writes for read-only users', () => {
    state.processing = { id: 1, taskId: 9, status: 'running' } as CmsMediaProcessing;
    const rendered = render(<CmsMediaProcessingSheet resource={video} onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: '应用设置并重新处理' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消处理' }));
    expect(state.cancel).toHaveBeenCalledWith({ params: { id: 9 } });
    rendered.unmount();
    state.processing = null; state.editable = false;
    render(<CmsMediaProcessingSheet resource={video} onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: '开始处理' })).toBeDisabled();
  });
});
