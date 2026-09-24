import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsResource } from '@zenith/shared/cms';
import { CmsAssetField } from './CmsAssetField';

const state = vi.hoisted(() => ({ resolved: null as CmsResource | null, success: false, upload: vi.fn() }));
const audio = { id: 41, siteId: 3, type: 'audio', name: '雨声.wav', url: '/audio-retained.wav', thumbUrl: null, size: 100 } as CmsResource;
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => true }) }));
vi.mock('@/hooks/queries/cms-resources', () => ({
  useCmsResourceSelection: () => ({ data: state.resolved, isSuccess: state.success, isFetching: false, isError: false }),
  useRememberCmsResourceSelection: () => () => undefined,
  useUploadCmsResource: () => ({ mutateAsync: state.upload, isPending: false }),
}));
vi.mock('./CmsResourcePicker', () => ({
  CMS_ASSET_LABELS: { audio: '音频', video: '视频', image: '图片', other: '文件' },
  CmsResourcePreview: ({ resource }: { resource: CmsResource }) => <audio aria-label={resource.name} src={resource.url} />,
  CmsResourcePicker: ({ visible, onSelect }: { visible: boolean; onSelect: (resource: CmsResource) => void }) => visible ? <>
    <button onClick={() => onSelect(audio)}>本站雨声</button>
    <button onClick={() => onSelect({ ...audio, id: 42, siteId: 9 })}>其他站素材</button>
  </> : null,
}));

beforeEach(() => { state.resolved = null; state.success = false; state.upload.mockReset(); });

describe('CMS 素材字段', () => {
  it('stores a site-local resource identity while previewing its playable URL and name', () => {
    const change = vi.fn();
    function Field() {
      const [value, setValue] = useState('');
      return <CmsAssetField siteId={3} type="audio" value={value} onChange={(next) => { change(next); setValue(next); }} />;
    }
    render(<Field />);
    fireEvent.click(screen.getByRole('button', { name: '选择音频' }));
    fireEvent.click(screen.getByRole('button', { name: '其他站素材' }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '本站雨声' }));
    expect(change).toHaveBeenLastCalledWith('cms-res://41');
    expect(screen.getByLabelText('雨声.wav')).toHaveAttribute('src', '/audio-retained.wav');
    expect(screen.getByText('雨声.wav')).toBeInTheDocument();
  });

  it('shows unavailable retained references without sending a cms-res URI to the browser player', () => {
    state.success = true;
    render(<CmsAssetField siteId={3} type="audio" value="cms-res://999" />);
    expect(screen.getByText(/素材不可用/)).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('prefers an explicit re-selection over a cached lookup of the same resource id', () => {
    state.success = true;
    state.resolved = { ...audio, url: '/previous-binary.wav' };
    render(<CmsAssetField siteId={3} type="audio" value="cms-res://41" onChange={() => undefined} />);
    expect(screen.getByLabelText('雨声.wav')).toHaveAttribute('src', '/previous-binary.wav');
    fireEvent.click(screen.getByRole('button', { name: '选择音频' }));
    fireEvent.click(screen.getByRole('button', { name: '本站雨声' }));
    expect(screen.getByLabelText('雨声.wav')).toHaveAttribute('src', '/audio-retained.wav');
  });

  it('uses the retained version URL returned by selection and keeps disabled values immutable', () => {
    state.success = true;
    state.resolved = audio;
    const change = vi.fn();
    render(<CmsAssetField siteId={3} type="audio" value="/audio-retained.wav" disabled onChange={change} />);
    expect(screen.getByLabelText('雨声.wav')).toHaveAttribute('src', '/audio-retained.wav');
    expect(screen.getByRole('button', { name: '选择音频' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清除音频' })).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
  });
});
