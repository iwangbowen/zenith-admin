import { createHash } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsModelFieldViewSchema, type CmsModelField } from '@zenith/shared/cms';
import { cmsAssetVersions, cmsModelVersions } from '../../db/schema/cms-design';
import { cmsModels, cmsModelFields, cmsResources } from '../../db/schema/cms';
import { dictItems, dicts } from '../../db/schema/core';
import type { DbExecutor } from '../../db/types';
import { requireRow } from '../../lib/db-assert';
import { pickEntity } from '../../lib/entity-map';
import { retainManagedFiles } from '../files/file-gc.service';

export const cmsSnapshotHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function captureCmsModelVersion(tx: DbExecutor, modelId: number) {
  const [model] = await tx.select().from(cmsModels).where(eq(cmsModels.id, modelId)).for('update').limit(1);
  requireRow(model, '内容模型不存在');
  const rows = await tx.select().from(cmsModelFields).where(eq(cmsModelFields.modelId, modelId)).orderBy(asc(cmsModelFields.sort), asc(cmsModelFields.id));
  const fields: CmsModelField[] = [];
  for (const row of rows) {
    const resolvedOptions = row.optionSource === 'dict'
      ? await tx.select({ label: dictItems.label, value: dictItems.value }).from(dictItems).innerJoin(dicts, eq(dictItems.dictId, dicts.id))
          .where(and(eq(dicts.code, row.dictCode ?? ''), eq(dicts.status, 'enabled'), eq(dictItems.status, 'enabled'))).orderBy(asc(dictItems.sort), asc(dictItems.id))
      : row.options ?? [];
    if (['select', 'radio', 'checkbox'].includes(row.fieldType) && !resolvedOptions.length) throw new HTTPException(400, { message: `字段「${row.label}」没有有效选项，无法发布模型` });
    if (['object', 'array'].includes(row.fieldType) && !row.configuration?.fields?.length) throw new HTTPException(400, { message: `字段「${row.label}」必须定义组件子字段` });
    if (row.fieldType === 'blocks' && !row.configuration?.blockTypes?.length) throw new HTTPException(400, { message: `字段「${row.label}」必须定义允许的区块` });
    fields.push(pickEntity(cmsModelFieldViewSchema, row, { resolvedOptions }));
  }
  const [previous] = await tx.select({ version: cmsModelVersions.version }).from(cmsModelVersions).where(eq(cmsModelVersions.modelId, modelId)).orderBy(desc(cmsModelVersions.version)).limit(1);
  const [version] = await tx.insert(cmsModelVersions).values({ modelId, version: (previous?.version ?? 0) + 1, fields, contentHash: cmsSnapshotHash(fields) }).returning();
  await tx.update(cmsModels).set({ publishedVersionId: version.id, hasUnpublishedChanges: false }).where(eq(cmsModels.id, modelId));
  return version;
}

export async function ensureCmsAssetVersion(tx: DbExecutor, resourceId: number, siteId: number) {
  const [resource] = await tx.select().from(cmsResources).where(and(eq(cmsResources.id, resourceId), eq(cmsResources.siteId, siteId))).for('update').limit(1);
  requireRow(resource, '素材不存在或不属于当前站点');
  const value = { url: resource.url, thumbUrl: resource.thumbUrl, fileId: resource.fileId, mimeType: resource.mimeType, width: resource.width, height: resource.height, size: resource.size };
  const hash = cmsSnapshotHash(value);
  const [previous] = await tx.select().from(cmsAssetVersions).where(eq(cmsAssetVersions.resourceId, resourceId)).orderBy(desc(cmsAssetVersions.version)).limit(1);
  if (previous?.contentHash === hash) return previous;
  const [version] = await tx.insert(cmsAssetVersions).values({ ...value, resourceId, siteId, version: (previous?.version ?? 0) + 1, contentHash: hash }).returning();
  if (version.fileId) await retainManagedFiles(tx, [version.fileId]);
  return version;
}
