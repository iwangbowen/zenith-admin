import { describe, expect, it } from 'vitest';
import { cmsMediaDurationFromMetadata, formatCmsMediaDuration, isExternalCmsMediaUrl } from './cms-media';

describe('CMS 音视频时长', () => {
  it('formats finite browser metadata and leaves live or unavailable durations unset', () => {
    expect(formatCmsMediaDuration(10)).toBe('00:10');
    expect(formatCmsMediaDuration(65.6)).toBe('01:06');
    expect(formatCmsMediaDuration(3661)).toBe('1:01:01');
    for (const value of [0, -1, NaN, Infinity]) expect(formatCmsMediaDuration(value)).toBeNull();
  });

  it('keeps a manual duration and ignores metadata arriving after another file was chosen', () => {
    expect(cmsMediaDurationFromMetadata(45, 'cms-res://1', 'cms-res://2', '')).toBeNull();
    expect(cmsMediaDurationFromMetadata(45, 'cms-res://2', 'cms-res://2', '00:44')).toBeNull();
    expect(cmsMediaDurationFromMetadata(45, 'cms-res://2', 'cms-res://2', '')).toBe('00:45');
  });

  it('keeps external addresses separate from resource identities and rejects executable schemes', () => {
    expect(isExternalCmsMediaUrl('https://media.example/audio.mp3')).toBe(true);
    expect(isExternalCmsMediaUrl('cms-res://4')).toBe(false);
    expect(isExternalCmsMediaUrl('/api/files/example/content')).toBe(false);
    expect(isExternalCmsMediaUrl('javascript:alert(1)')).toBe(false);
  });
});
