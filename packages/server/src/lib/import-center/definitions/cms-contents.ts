import * as z from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { CMS_CONTENT_IMPORT_COLUMNS, parseCmsContentImportCells } from '@zenith/shared/cms';
import { db } from '../../../db';
import { cmsChannels, cmsTags, cmsResources } from '../../../db/schema';
import { extractCmsResourceIds } from '../../cms-resource-uri';
import { createCmsContent, ensureCmsContentTargetAccess } from '../../../services/cms/cms-contents.service';
import { listAllCmsModels, assertCmsModelUsableBySite } from '../../../services/cms/cms-models.service';
import { applyCmsModelFieldDefaults, validateCmsModelExtend } from '../../../services/cms/cms-model-extend';
import { ensureCmsLinkTargetExists } from '../../../services/cms/cms-link.service';
import { registerImport } from '../registry';

const contextSchema = z.object({
  siteId: z.coerce.number().int().positive({ message: '缺少站点参数' }),
  channelId: z.coerce.number().int().positive({ message: '缺少栏目参数' }),
});

interface Prepared {
  siteId: number;
  channelId: number;
  channels: Map<string, { id: number; modelId: number | null }>;
  tags: Map<string, number>;
  models: Map<string, number>;
}

export function registerCmsContentsImport(): void {
  registerImport<ReturnType<typeof parseCmsContentImportCells>, Prepared>({
    entity: 'cms.contents', title: 'CMS 内容', module: 'CMS内容管理', permission: 'cms:content:create',
    description: '导入图文、图集、音视频和跳转内容为草稿，支持封面、标签、模型字段、附件与 SEO；标识引用须预先存在于当前站点',
    maxRows: 2000, columns: CMS_CONTENT_IMPORT_COLUMNS, contextSchema,
    async prepare(context) {
      const { siteId, channelId } = contextSchema.parse(context);
      await ensureCmsContentTargetAccess(siteId, channelId);
      const [channels, tags, models] = await Promise.all([
        db.select({ id: cmsChannels.id, code: cmsChannels.code, modelId: cmsChannels.modelId }).from(cmsChannels)
          .where(and(eq(cmsChannels.siteId, siteId), eq(cmsChannels.type, 'list'), eq(cmsChannels.status, 'enabled'))),
        db.select({ id: cmsTags.id, slug: cmsTags.slug }).from(cmsTags).where(eq(cmsTags.siteId, siteId)),
        listAllCmsModels(siteId),
      ]);
      return { siteId, channelId, channels: new Map(channels.map((row) => [row.code, row])), tags: new Map(tags.map((row) => [row.slug, row.id])), models: new Map(models.filter((row) => row.publishedVersionId).map((row) => [row.code, row.id])) };
    },
    async parseRow(cells, prepared) {
      const channelId = cells.channelCode ? prepared.channels.get(cells.channelCode)?.id : prepared.channelId;
      if (!channelId) throw new Error(`栏目编码不存在或不可用：${cells.channelCode}`);
      const { channel } = await ensureCmsContentTargetAccess(prepared.siteId, channelId);
      const modelId = cells.modelCode ? prepared.models.get(cells.modelCode) : channel.modelId;
      if (cells.modelCode && !modelId) throw new Error(`模型不存在、未发布或不可用：${cells.modelCode}`);
      if (modelId) await assertCmsModelUsableBySite(modelId, prepared.siteId);
      const tagIds = [...new Set((cells.tagSlugs || '').split(/[,，]/).map((value) => value.trim()).filter(Boolean))].map((slug) => {
        const id = prepared.tags.get(slug);
        if (!id) throw new Error(`当前站点不存在标签：${slug}`);
        return id;
      });
      const row = parseCmsContentImportCells(cells, { siteId: prepared.siteId, channelId, modelId, tagIds });
      row.extend = await applyCmsModelFieldDefaults(modelId, row.extend);
      await validateCmsModelExtend(modelId, row.extend, 'draft');
      await ensureCmsLinkTargetExists(prepared.siteId, row.externalLink);
      const resourceIds = extractCmsResourceIds(row);
      if (resourceIds.length) {
        const resources = await db.select({ id: cmsResources.id }).from(cmsResources)
          .where(and(eq(cmsResources.siteId, prepared.siteId), inArray(cmsResources.id, resourceIds)));
        const visible = new Set(resources.map((resource) => resource.id));
        const missing = resourceIds.filter((id) => !visible.has(id));
        if (missing.length) throw new Error(`素材不存在或不属于当前站点：${missing.join('、')}`);
      }
      return row;
    },
    async insertRow(row) { await createCmsContent(row); },
    rowLabel: (row) => row.title,
  });
}
