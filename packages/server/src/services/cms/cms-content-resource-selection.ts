import { eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { collectCmsSelectedResourceIds } from '@zenith/shared/cms';
import { cmsResources } from '../../db/schema/cms';
import type { DbTransaction } from '../../db/types';
import { buildWhere } from '../../lib/where-helpers';
import { ensureCmsAssetVersion } from './cms-design-versions.service';
import { CMS_RESOURCE_OWNER_FIELDS } from './cms-resource-refs.service';

/** Freeze only the caller's explicit re-selections; full autosave payloads never refresh other pins. */
export async function refreshCmsContentResourcePins(tx: DbTransaction, siteId: number, pins: Record<string, number>, patch: Record<string, unknown>, refreshResourceIds: readonly number[] = []) {
  const ids = [...new Set(refreshResourceIds)];
  if (!ids.length) return pins;
  const fields = Object.fromEntries(CMS_RESOURCE_OWNER_FIELDS.content.map((key) => [key, patch[key]]));
  const referenced = new Set(collectCmsSelectedResourceIds(fields));
  if (ids.some((id) => !referenced.has(id))) throw new HTTPException(400, { message: '重新选择的素材必须在本次保存字段中引用' });
  const resources = await tx.select({ id: cmsResources.id }).from(cmsResources).where(buildWhere(eq(cmsResources.siteId, siteId), inArray(cmsResources.id, ids)));
  if (resources.length !== ids.length) throw new HTTPException(404, { message: '重新选择的素材不存在或不属于本站' });
  const next = { ...pins };
  for (const id of ids) next[String(id)] = (await ensureCmsAssetVersion(tx, id, siteId)).id;
  return next;
}
