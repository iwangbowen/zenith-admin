import type { CmsSite, CreateCmsSiteInput } from '@zenith/shared/cms';

export interface PreparedSiteImage {
  key: string;
  file: File;
  previewUrl: string;
  uploadedValue?: string;
}
type SitePayload = Partial<CreateCmsSiteInput>;

/** 本地 objectURL 不进 payload；只有已上传的资产句柄才能覆盖站点字段。 */
export function applyPreparedSiteImageUrls(payload: SitePayload, images: readonly { key: string; uploadedValue?: string }[]): SitePayload {
  const next = { ...payload, settings: { ...payload.settings } };
  const themeConfig = { ...(next.settings.themeConfig as Record<string, unknown> ?? {}) };
  let themeChanged = false;
  for (const image of images) {
    if (!image.uploadedValue) continue;
    if (image.key === 'logo' || image.key === 'favicon') next[image.key] = image.uploadedValue;
    else if (image.key.startsWith('theme:')) { themeConfig[image.key.slice(6)] = image.uploadedValue; themeChanged = true; }
  }
  if (themeChanged) next.settings.themeConfig = themeConfig;
  return next;
}

/** 用户提交后才创建站点；成功 ID 和上传结果逐步记住，使部分失败后的重试不重复创建/上传。 */
export async function saveSiteWithPreparedImages({ siteId, payload, images, save, upload, onSaved, onUploaded }: {
  siteId?: number;
  payload: SitePayload;
  images: readonly PreparedSiteImage[];
  save: (id: number | undefined, payload: SitePayload) => Promise<CmsSite>;
  upload: (siteId: number, file: File) => Promise<string>;
  onSaved: (site: CmsSite) => void;
  onUploaded: (key: string, value: string) => void;
}): Promise<CmsSite> {
  const resolved = images.map((image) => ({ ...image }));
  let saved = await save(siteId, applyPreparedSiteImageUrls(payload, resolved));
  onSaved(saved);
  let changed = false;
  for (const image of resolved) {
    if (image.uploadedValue) continue;
    image.uploadedValue = await upload(saved.id, image.file);
    onUploaded(image.key, image.uploadedValue);
    changed = true;
  }
  if (changed) {
    saved = await save(saved.id, applyPreparedSiteImageUrls(payload, resolved));
    onSaved(saved);
  }
  return saved;
}
