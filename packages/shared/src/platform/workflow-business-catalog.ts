import type { CanonicalEntityType } from './entity-catalog';

/** Canonical business identities shared by relation providers and Demo data. */
export const WORKFLOW_BUSINESS_ENTITY_TYPES = [
  { entityType: 'biz.leave', bizType: 'biz_leave', reverseRelation: 'business-leave' },
  { entityType: 'cms.content', bizType: 'cms_content', reverseRelation: 'business-content' },
  { entityType: 'payment.recon-adjustment', bizType: 'payment_recon_adjustment', reverseRelation: 'business-recon-adjustment' },
] as const satisfies readonly { entityType: CanonicalEntityType; bizType: string; reverseRelation: string }[];

export type WorkflowBusinessEntityType = (typeof WORKFLOW_BUSINESS_ENTITY_TYPES)[number]['entityType'];
