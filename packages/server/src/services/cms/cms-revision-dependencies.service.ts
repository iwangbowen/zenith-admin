import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { validateCmsStructuredFields, type CmsContentRevisionSnapshot } from '@zenith/shared/cms';
import { cmsModelVersions, cmsAssetVersions, cmsAssetRights, cmsModelUniqueValues } from '../../db/schema/cms-design';
import { cmsModels, cmsContents } from '../../db/schema/cms';
import type { DbExecutor } from '../../db/types';
import { requireRow } from '../../lib/db-assert';
import { extractCmsResourceIds, resolveCmsResourceUris } from '../../lib/cms-resource-uri';
import { cmsSnapshotHash, ensureCmsAssetVersion } from './cms-design-versions.service';
import { normalizeCmsContentDocument, renderCmsContentDocument, sanitizeCmsModelValues } from './cms-document.service';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

/** Freeze definitions and binary identities before the immutable revision is inserted. */
export async function freezeCmsRevisionDependencies(tx: DbExecutor, siteId: number, modelId: number | null, snapshot: CmsContentRevisionSnapshot, options: { strict?: boolean } = {}) {
  let schemaVersionId: number | null = null;
  if (modelId) {
    const [model] = await tx.select().from(cmsModels).where(eq(cmsModels.id, modelId)).limit(1);
    requireRow(model, '内容模型不存在');
    if (model.ownerSiteId != null && model.ownerSiteId !== siteId) throw new HTTPException(400, { message: '内容模型不属于本站' });
    schemaVersionId = snapshot.modelVersionId ?? model.publishedVersionId;
    if (!schemaVersionId) throw new HTTPException(400, { message: '请先发布内容模型版本' });
    const [version] = await tx.select().from(cmsModelVersions).where(and(eq(cmsModelVersions.id, schemaVersionId), eq(cmsModelVersions.modelId, modelId))).limit(1);
    requireRow(version, '模型版本不存在');
    const issues = validateCmsStructuredFields(version.fields, snapshot.extend ?? {}, options.strict ?? false);
    if (issues.length) throw new HTTPException(400, { message: issues.map((issue) => `${issue.fieldPath}: ${issue.message}`).join('；') });
    snapshot = { ...snapshot, extend: sanitizeCmsModelValues(version.fields, snapshot.extend ?? {}) };
    for (const field of version.fields.filter((field) => field.fieldType === 'reference' || field.fieldType === 'references')) {
      const value = snapshot.extend?.[field.name];
      const ids = typeof value === 'number' ? [value] : Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : [];
      if (!ids.length) continue;
      const targets = await tx.select({ id: cmsContents.id, modelId: cmsContents.modelId }).from(cmsContents).where(and(eq(cmsContents.siteId, siteId), inArray(cmsContents.id, ids)));
      if (targets.length !== new Set(ids).size || targets.some((target) => field.configuration?.referenceModelIds?.length && (!target.modelId || !field.configuration.referenceModelIds.includes(target.modelId)))) {
        throw new HTTPException(400, { message: `引用字段「${field.label}」目标不存在、不属于本站或类型不符合约束` });
      }
    }
  }
  const ids = [...new Set([...extractCmsResourceIds(snapshot), ...Object.keys(snapshot.assetVersions).map(Number)])].sort((a, b) => a - b);
  const assetVersions: Record<string, number> = { ...snapshot.assetVersions };
  const urls = new Map<number, string>();
  for (const id of ids) {
    const [rights] = await tx.select().from(cmsAssetRights).where(eq(cmsAssetRights.resourceId, id)).limit(1);
    if (rights?.revoked || (rights?.expiresAt && rights.expiresAt <= new Date())) throw new HTTPException(400, { message: `素材 #${id} 已撤权或授权过期` });
    const pinned = assetVersions[String(id)];
    const version = pinned
      ? (await tx.select().from(cmsAssetVersions).where(and(eq(cmsAssetVersions.id, pinned), eq(cmsAssetVersions.resourceId, id), eq(cmsAssetVersions.siteId, siteId))).limit(1))[0]
      : await ensureCmsAssetVersion(tx, id, siteId);
    requireRow(version, '素材修订不存在');
    assetVersions[String(id)] = version.id;
    urls.set(id, version.url);
  }
  const frozen = resolveCmsResourceUris(snapshot, (id) => urls.get(id) ?? null);
  const bodyDocument = normalizeCmsContentDocument(frozen.body ?? '', frozen.bodyDocument ?? undefined);
  return { schemaVersionId, assetVersions, snapshot: { ...frozen, modelVersionId: schemaVersionId, assetVersions, bodyDocument, body: renderCmsContentDocument(bodyDocument) } };
}

export async function claimCmsUniqueModelValues(tx: DbExecutor, siteId: number, contentId: number, snapshot: CmsContentRevisionSnapshot) {
  await tx.delete(cmsModelUniqueValues).where(eq(cmsModelUniqueValues.contentId, contentId));
  if (!snapshot.modelVersionId || !snapshot.modelId) return;
  const [version] = await tx.select().from(cmsModelVersions).where(eq(cmsModelVersions.id, snapshot.modelVersionId)).limit(1);
  if (!version) return;
  const values = version.fields.filter((field) => field.configuration?.unique && snapshot.extend?.[field.name] != null)
    .map((field) => ({ siteId, contentId, modelId: snapshot.modelId!, field: field.name, valueHash: cmsSnapshotHash(snapshot.extend![field.name]) }));
  try { if (values.length) await tx.insert(cmsModelUniqueValues).values(values); }
  catch (error) { rethrowPgUniqueViolation(error, '模型唯一字段值已被其他内容使用'); }
}
