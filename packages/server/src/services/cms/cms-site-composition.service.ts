import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsHomeSectionsSchema, cmsModelDisplaysSchema, validateCmsHomeSections, validateCmsModelDisplay } from '@zenith/shared/cms';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { cmsChannels, cmsModels, cmsModelVersions } from '../../db/schema';
import { getThemeSettingsSchema } from '../../cms/themes/registry';

/** Runs inside the authorized site mutation, including its transaction and effective settings. */
export async function assertCmsSiteComposition(theme: string, settings: Record<string, unknown> | null | undefined, siteId?: number, executor: DbExecutor = db) {
  const config = settings?.themeConfig as Record<string, unknown> | undefined;
  if (!config) return;
  const declared = new Set(getThemeSettingsSchema(theme).map((field) => field.name));
  for (const key of ['homeSections', 'modelDisplays']) {
    if (config[key] !== undefined && !declared.has(key) && (!Array.isArray(config[key]) || config[key].length)) throw new HTTPException(400, { message: `当前主题不支持配置 ${key}` });
  }
  const sections = cmsHomeSectionsSchema.safeParse(config.homeSections ?? []);
  const displays = cmsModelDisplaysSchema.safeParse(config.modelDisplays ?? []);
  if (!sections.success || !displays.success) {
    const issues = [...(!sections.success ? sections.error.issues : []), ...(!displays.success ? displays.error.issues : [])];
    throw new HTTPException(400, { message: issues.map((issue) => issue.message).join('；') });
  }
  // The pre-insert check validates shape. References are checked again after assigning the new site id.
  if (siteId === undefined) return;
  const channelIds = sections.data.flatMap((row) => row.channelId ? [row.channelId] : []);
  const modelIds = displays.data.map((row) => row.modelId);
  const [channels, models] = await Promise.all([
    channelIds.length ? executor.select().from(cmsChannels).where(and(eq(cmsChannels.siteId, siteId), inArray(cmsChannels.id, channelIds))) : [],
    modelIds.length ? executor.select().from(cmsModels).where(inArray(cmsModels.id, modelIds)) : [],
  ]);
  const versionIds = models.flatMap((row) => row.publishedVersionId ? [row.publishedVersionId] : []);
  const versions = versionIds.length ? await executor.select().from(cmsModelVersions).where(inArray(cmsModelVersions.id, versionIds)) : [];
  const issues = validateCmsHomeSections(sections.data, channels, siteId);
  for (const binding of displays.data) {
    const model = models.find((row) => row.id === binding.modelId && row.status === 'enabled' && (row.ownerSiteId === null || row.ownerSiteId === siteId));
    const version = model && versions.find((row) => row.id === model.publishedVersionId && row.modelId === model.id);
    issues.push(...validateCmsModelDisplay(binding, model && version ? { id: model.id, fields: version.fields } : undefined));
  }
  if (issues.length) throw new HTTPException(400, { message: issues.join('；') });
}
