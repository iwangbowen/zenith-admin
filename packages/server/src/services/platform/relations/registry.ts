import { HTTPException } from 'hono/http-exception';
import { entityRelationPageSchema, entityRelationSummaryStateSchema, entityRelationsResponseSchema, type CanonicalEntityType, type EntityRelationsResponse, type EntityRelationPage, type EntityRelationSummaryState } from '@zenith/shared/platform';
import { isLicenseFeatureKey } from '@zenith/shared/licensing';
import { hasPermission, runWithCurrentUser } from '../../../lib/context';
import { isFeatureEnabled } from '../../../lib/licensing';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from './types';
import { paymentAnchorResolvers, paymentRelationProviders } from './providers/payment-order.provider';
import { identityAnchorResolvers, identityRelationProviders } from './providers/identity.provider';
import { iotContentAnchorResolvers, iotContentRelationProviders } from './providers/iot-content.provider';
import { workflowFileAnchorResolvers, workflowFileRelationProviders } from './providers/workflow-file.provider';
import { subjectAnchorResolvers, subjectProviders } from './providers/subjects.provider';
import { readRelationCursor, signRelationCursor } from './cursor';
import { assertRelationBudget, isStatementTimeout, withRelationRead } from './runtime';
import { manualLinksProvider } from './edges.service';
import { paymentFinancialAnchorResolvers, paymentFinancialRelationProviders } from '../../payment/payment-financial-relations.service';
import { reverseSubjectProviders } from './providers/reverse-subjects.provider';
import { workflowBusinessAnchorResolvers, createWorkflowBusinessRelationProviders } from '../../workflow/workflow-business-relations.service';
import { workflowArchiveAnchorResolvers, workflowArchiveRelationProviders } from '../../workflow/workflow-archive-relations.service';
import { workflowAttachmentAnchorResolvers, workflowAttachmentRelationProviders } from '../../workflow/workflow-attachment-relations.service';

/** Each module contributes a manifest; registration validates it once at assembly. */
export interface EntityRelationManifest {
  readonly anchors: readonly EntityAnchorResolver[];
  readonly relations: readonly RelationProvider[];
}
export function createEntityRelationRegistry(manifests: readonly EntityRelationManifest[]) {
  const anchors = new Map<CanonicalEntityType, EntityAnchorResolver>();
  const relations = new Map<string, RelationProvider>();
  for (const manifest of manifests) {
    for (const anchor of manifest.anchors) {
      if (anchors.has(anchor.type)) throw new Error(`Duplicate entity resolver: ${anchor.type}`);
      anchors.set(anchor.type, anchor);
    }
    for (const relation of manifest.relations) {
      if (relations.has(relation.key)) throw new Error(`Duplicate relation: ${relation.key}`);
      if (relation.key !== relation.descriptor.key) throw new Error(`Mismatched relation descriptor: ${relation.key}`);
      relations.set(relation.key, relation);
    }
  }
  for (const relation of relations.values()) {
    if (!anchors.has(relation.sourceType)) throw new Error(`Missing anchor resolver: ${relation.sourceType}`);
    for (const type of relation.descriptor.targetTypes) {
      if (!anchors.has(type)) throw new Error(`Missing target resolver: ${type}`);
    }
  }
  return { anchors, relations };
}
const manifests: EntityRelationManifest[] = [
  { anchors: paymentAnchorResolvers, relations: paymentRelationProviders },
  { anchors: paymentFinancialAnchorResolvers, relations: paymentFinancialRelationProviders },
  { anchors: identityAnchorResolvers, relations: identityRelationProviders.filter((item) => !item.key.endsWith('.audit')) },
  { anchors: iotContentAnchorResolvers, relations: iotContentRelationProviders },
  { anchors: workflowFileAnchorResolvers, relations: workflowFileRelationProviders },
  { anchors: subjectAnchorResolvers, relations: [] },
  { anchors: workflowBusinessAnchorResolvers, relations: createWorkflowBusinessRelationProviders(resolveVisibleEntityAnchor) },
  { anchors: workflowArchiveAnchorResolvers, relations: workflowArchiveRelationProviders },
  { anchors: workflowAttachmentAnchorResolvers, relations: workflowAttachmentRelationProviders },
];
const supportedTypes = manifests.flatMap((manifest) => manifest.anchors.map((anchor) => anchor.type));
manifests.push({ anchors: [], relations: supportedTypes.flatMap(subjectProviders) });
manifests.push({ anchors: [], relations: reverseSubjectProviders(supportedTypes, resolveVisibleEntityAnchor) });
manifests.push({ anchors: [], relations: supportedTypes.map((type) => manualLinksProvider(type, supportedTypes)) });
export const entityRelationRegistry = createEntityRelationRegistry(manifests);
export const relationProviders = [...entityRelationRegistry.relations.values()];

export async function canUseEntityType(type: CanonicalEntityType): Promise<boolean> {
  const domain = type.split('.')[0];
  return !isLicenseFeatureKey(domain) || isFeatureEnabled(domain);
}
export async function resolveVisibleEntityAnchor(type: CanonicalEntityType, key: string, access: RelationAccessContext): Promise<VisibleEntityAnchor> {
  assertRelationBudget(access);
  const resolver = entityRelationRegistry.anchors.get(type);
  if (!resolver || !(await canUseEntityType(type))) throw new HTTPException(404, { message: '对象不存在或无权查看' });
  const anchor = await runWithCurrentUser(access.user, () => resolver.resolve({ type, key }, access));
  if (!anchor) throw new HTTPException(404, { message: '对象不存在或无权查看' });
  return { ...anchor, title: anchor.title.slice(0, 160) };
}
export async function canDiscover(provider: RelationProvider): Promise<boolean> {
  if (provider.permissions !== 'authenticated' && !(await hasPermission(...provider.permissions))) return false;
  for (const permission of provider.allPermissions ?? []) if (!(await hasPermission(permission))) return false;
  // Polymorphic groups authorize each returned target; an unrelated disabled domain must not hide the whole group.
  if (!provider.key.endsWith('.links') && !provider.key.endsWith('.subjects')) {
    for (const type of provider.descriptor.targetTypes) if (!(await canUseEntityType(type))) return false;
  }
  return true;
}
export function relationCursorScope(anchor: VisibleEntityAnchor, operation: string, access: RelationAccessContext): string {
  return JSON.stringify([anchor.ref.type, anchor.ref.key, anchor.tenantId, operation, access.user.userId, access.user.tenantId,
    access.user.viewingTenantId, access.user.impersonation]);
}

/**
 * Resolve a qualitative section state without exposing a count. Providers can
 * supply an indexed `exists`/`summarize` implementation; the bounded list
 * fallback keeps older providers useful while preserving their exact list
 * authorization, tenant and data-scope predicates.
 */
async function summarizeRelationProvider(provider: RelationProvider, anchor: VisibleEntityAnchor, access: RelationAccessContext): Promise<EntityRelationSummaryState> {
  try {
    assertRelationBudget(access);
    if (provider.summarize) return entityRelationSummaryStateSchema.parse(await provider.summarize(anchor, { access }));
    if (provider.exists) return (await provider.exists(anchor, { access })) ? 'has-data' : 'empty';
    const page = await provider.list(anchor, { cursor: undefined, limit: 1, access });
    if (page.degraded) return 'unavailable';
    return page.items.length > 0 ? 'has-data' : 'empty';
  } catch {
    // A summary is advisory. A timeout, revoked target, or provider-specific
    // failure must not hide the authorized section or turn it into "empty".
    return 'unavailable';
  }
}

const RELATION_SUMMARY_CONCURRENCY = 3;

async function summarizeRelationProviders(providers: readonly RelationProvider[], anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  const sections = [];
  for (let start = 0; start < providers.length; start += RELATION_SUMMARY_CONCURRENCY) {
    assertRelationBudget(access);
    const batch = providers.slice(start, start + RELATION_SUMMARY_CONCURRENCY);
    sections.push(...await Promise.all(batch.map(async (provider) => ({
      ...provider.descriptor,
      summaryState: await summarizeRelationProvider(provider, anchor, access),
    }))));
  }
  return sections;
}

export async function describeEntityRelations(input: { type: CanonicalEntityType; key: string }, caller: Pick<RelationAccessContext, 'user'>): Promise<EntityRelationsResponse> {
  return withRelationRead('describe', caller, async (access) => {
    const anchor = await resolveVisibleEntityAnchor(input.type, input.key, access);
    const providers = [];
    for (const provider of relationProviders) {
      if (provider.sourceType !== input.type || (provider.appliesTo && !provider.appliesTo(anchor)) || !(await canDiscover(provider))) continue;
      providers.push(provider);
    }
    const sections = await summarizeRelationProviders(providers, anchor, access);
    return entityRelationsResponseSchema.parse({ anchor: { ref: anchor.ref, title: anchor.title }, sections, canManageLinks: await hasPermission('system:relation:manage') });
  }).catch((error: unknown) => {
    if (isStatementTimeout(error)) throw new HTTPException(503, { message: '对象查询超时，请稍后重试' });
    throw error;
  });
}
export async function listEntityRelation(input: { type: CanonicalEntityType; key: string; sectionKey: string; cursor?: string; limit: number }, caller: Pick<RelationAccessContext, 'user'>): Promise<EntityRelationPage> {
  let authorized = false;
  try {
    return await withRelationRead('section', caller, async (access) => {
      const anchor = await resolveVisibleEntityAnchor(input.type, input.key, access);
      const provider = entityRelationRegistry.relations.get(input.sectionKey);
      if (!provider || provider.sourceType !== anchor.ref.type || (provider.appliesTo && !provider.appliesTo(anchor)) || !(await canDiscover(provider))) throw new HTTPException(404, { message: '关联分组不存在或无权查看' });
      const scope = relationCursorScope(anchor, provider.key, access);
      const cursor = readRelationCursor(input.cursor, scope);
      authorized = true;
      const result = await provider.list(anchor, { cursor, limit: input.limit, access });
      return entityRelationPageSchema.parse({ ...result, items: result.items.map((item) => ({ ...item,
        title: item.title.slice(0, 160), subtitle: item.subtitle?.slice(0, 240), description: item.description?.slice(0, 500),
        origin: { ...item.origin, kind: provider.descriptor.kind },
      })),
        nextCursor: result.nextCursor ? signRelationCursor(result.nextCursor, scope) : null });
    });
  } catch (error) {
    if (authorized && isStatementTimeout(error)) return { items: [], nextCursor: null, hasMore: false, degraded: 'timeout' };
    if (isStatementTimeout(error)) throw new HTTPException(503, { message: '对象查询超时，请稍后重试' });
    throw error;
  }
}
