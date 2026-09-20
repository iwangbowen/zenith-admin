import { HTTPException } from 'hono/http-exception';
import { hasPermission } from '../../../lib/context';
import { canonicalEntityTypeSchema, type CanonicalEntityType, type EntityRelationsResponse, type EntityRelationPage } from '@zenith/shared/platform';
import type { RelationAccessContext, RelationProvider, VisibleEntityAnchor } from './types';
import { paymentOrderAuditProvider, paymentOrderRefundsProvider, paymentOrderWorkflowProvider } from './providers/payment-order.provider';
import { identityRelationProviders } from './providers/identity.provider';
import { cmsContentRelatedProvider, iotDeviceAlarmsProvider } from './providers/iot-content.provider';

export const relationProviders: readonly RelationProvider[] = [
  paymentOrderRefundsProvider,
  paymentOrderWorkflowProvider,
  paymentOrderAuditProvider,
  ...identityRelationProviders,
  iotDeviceAlarmsProvider,
  cmsContentRelatedProvider,
];

function providersFor(type: CanonicalEntityType): RelationProvider[] {
  return relationProviders.filter((provider) => provider.sourceType === type);
}

export async function resolveVisibleEntityAnchor(type: CanonicalEntityType, key: string, access: RelationAccessContext): Promise<VisibleEntityAnchor> {
  const providers = providersFor(type);
  for (const provider of providers) {
    const anchor = await provider.resolveAnchor({ type, key }, access);
    if (anchor) return anchor;
  }
  throw new HTTPException(404, { message: '对象不存在或无权查看' });
}

async function canDiscover(provider: RelationProvider): Promise<boolean> {
  if (provider.permissions === 'authenticated') return true;
  return hasPermission(...provider.permissions);
}

export async function describeEntityRelations(
  input: { readonly type: CanonicalEntityType; readonly key: string },
  access: RelationAccessContext,
): Promise<EntityRelationsResponse> {
  const anchor = await resolveVisibleEntityAnchor(input.type, input.key, access);
  const sections = [];
  for (const provider of providersFor(input.type)) {
    if (await canDiscover(provider)) sections.push(provider.descriptor);
  }
  return { anchor: { ref: anchor.ref, title: anchor.title }, sections };
}

export async function listEntityRelation(
  input: { readonly type: CanonicalEntityType; readonly key: string; readonly sectionKey: string; readonly cursor?: string; readonly limit: number },
  access: RelationAccessContext,
): Promise<EntityRelationPage> {
  const anchor = await resolveVisibleEntityAnchor(input.type, input.key, access);
  const provider = providersFor(input.type).find((candidate) => candidate.key === input.sectionKey);
  if (!provider || !(await canDiscover(provider))) throw new HTTPException(404, { message: '关联分组不存在或无权查看' });
  return provider.list(anchor, { cursor: input.cursor, limit: input.limit, access });
}

export function isCanonicalRelationType(value: string): value is CanonicalEntityType {
  return canonicalEntityTypeSchema.safeParse(value).success;
}
