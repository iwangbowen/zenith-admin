import { describe, expect, it, vi } from 'vitest';
import type { CmsSite, CreateCmsSiteInput } from '@zenith/shared/cms';
import { applyPreparedSiteImageUrls, saveSiteWithPreparedImages, type PreparedSiteImage } from './site-image-save';

const site = { id: 19, name: '有名称的测试站点', code: 'prepared-site', settings: {} } as CmsSite;
const payload: Partial<CreateCmsSiteInput> = { name: site.name, code: site.code, logo: null, settings: { themeConfig: { bannerLink: '/news/' }, retained: true } };

describe('新站图片随显式保存上传', () => {
  it('creates the complete site first and then associates scoped uploaded assets without persisting object URLs', async () => {
    const save = vi.fn<(id: number | undefined, payload: Partial<CreateCmsSiteInput>) => Promise<CmsSite>>().mockResolvedValue(site);
    const upload = vi.fn(async () => 'cms-res://81');
    const image = { key: 'logo', file: new File(['image'], 'logo.png'), previewUrl: 'blob:local-only' };
    const onSaved = vi.fn();
    await saveSiteWithPreparedImages({ payload, images: [image], save, upload, onSaved, onUploaded: vi.fn() });
    expect(save.mock.calls[0]).toEqual([undefined, payload]);
    expect(upload).toHaveBeenCalledWith(site.id, image.file);
    expect(save.mock.calls[1]).toEqual([site.id, { ...payload, logo: 'cms-res://81' }]);
    expect(onSaved).toHaveBeenCalledWith(site);
    expect(JSON.stringify(save.mock.calls)).not.toContain('blob:');
  });

  it('retains the created identity and successful upload across a partial failure instead of creating another site', async () => {
    const images: PreparedSiteImage[] = [
      { key: 'logo', file: new File(['logo'], 'logo.png'), previewUrl: 'blob:logo' },
      { key: 'theme:bannerImage', file: new File(['banner'], 'banner.png'), previewUrl: 'blob:banner' },
    ];
    const save = vi.fn(async (_id: number | undefined, _payload: Partial<CreateCmsSiteInput>) => site);
    let rememberedId: number | undefined;
    const uploaded = (key: string, value: string) => { images.find((image) => image.key === key)!.uploadedValue = value; };
    const upload = vi.fn<(siteId: number, file: File) => Promise<string>>()
      .mockResolvedValueOnce('cms-res://81').mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce('cms-res://82');
    const options = { payload, images, save, upload, onSaved: (record: CmsSite) => { rememberedId = record.id; }, onUploaded: uploaded };
    await expect(saveSiteWithPreparedImages(options)).rejects.toThrow('网络断开');
    expect(rememberedId).toBe(19);
    expect(images[0].uploadedValue).toBe('cms-res://81');
    await saveSiteWithPreparedImages({ ...options, siteId: rememberedId });
    expect(save.mock.calls.filter(([id]) => id === undefined)).toHaveLength(1);
    expect(upload.mock.calls.map(([id, file]) => [id, file.name])).toEqual([[19, 'logo.png'], [19, 'banner.png'], [19, 'banner.png']]);
    expect(save.mock.calls.at(-1)?.[1]).toEqual({ ...payload, logo: 'cms-res://81', settings: { retained: true, themeConfig: { bannerLink: '/news/', bannerImage: 'cms-res://82' } } });
  });

  it('does not upload anything when the user submitted site fields cannot be saved', async () => {
    const upload = vi.fn();
    const save = vi.fn(async () => { throw new Error('标识已存在'); });
    await expect(saveSiteWithPreparedImages({ payload, images: [{ key: 'favicon', file: new File(['image'], 'favicon.png'), previewUrl: 'blob:favicon' }], save, upload, onSaved: vi.fn(), onUploaded: vi.fn() })).rejects.toThrow('标识已存在');
    expect(upload).not.toHaveBeenCalled();
  });

  it('reuses uploaded values after final association failure and preserves unrelated theme settings', async () => {
    const image = { key: 'theme:bannerImage', file: new File(['image'], 'banner.png'), previewUrl: 'blob:banner', uploadedValue: 'cms-res://82' };
    const save = vi.fn(async () => site);
    const upload = vi.fn();
    await saveSiteWithPreparedImages({ siteId: 19, payload, images: [image], save, upload, onSaved: vi.fn(), onUploaded: vi.fn() });
    expect(save).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(applyPreparedSiteImageUrls(payload, [image])).toMatchObject({ settings: { retained: true, themeConfig: { bannerLink: '/news/', bannerImage: 'cms-res://82' } } });
  });
});
