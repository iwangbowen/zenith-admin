import type { EntityRelationItem, EntityRelationPage, EntityRelationSectionDescriptor, EntityRelationSummaryState } from '@zenith/shared/platform';
import type { CanonicalEntityType } from '@zenith/shared/platform';
import type { EntityRef, RelationKey } from '@zenith/shared/core';
import type { Permission } from '@zenith/shared/core';
import type { JwtPayload } from '../../../middleware/auth';
import type { DbTransaction } from '../../../db/types';
import type { SQL } from 'drizzle-orm';

export interface RelationAccessContext {
  readonly user: JwtPayload;
  readonly db: DbTransaction;
  readonly deadlineAt?: number;
}

export interface EntityAnchorResolver {
  readonly type: CanonicalEntityType;
  readonly resolve: (ref: EntityRef, access: RelationAccessContext) => Promise<VisibleEntityAnchor | null>;
}

export interface VisibleEntityAnchor {
  readonly ref: EntityRef & { readonly type: CanonicalEntityType };
  readonly title: string;
  readonly tenantId: number | null;
  /** Domain-specific values kept server-side for relation queries. */
  readonly metadata?: Readonly<Record<string, string | number | null>>;
}

export interface RelationProvider {
  readonly sourceType: CanonicalEntityType;
  readonly key: RelationKey;
  readonly permissions: 'authenticated' | readonly [Permission, ...Permission[]];
  readonly allPermissions?: readonly Permission[];
  /** Pure domain applicability over an already authorized anchor; performs no I/O. */
  readonly appliesTo?: (anchor: VisibleEntityAnchor) => boolean;
  readonly descriptor: EntityRelationSectionDescriptor;
  readonly list: (
    anchor: VisibleEntityAnchor,
    input: { readonly cursor?: string; readonly limit: number; readonly access: RelationAccessContext },
  ) => Promise<EntityRelationPage>;
  /**
   * An existence/attention SQL expression over the complete visible set. The
   * registry batches authorized expressions into one statement. This builder
   * is pure: no I/O, ordering, pagination or payload projection.
   */
  readonly summaryQuery?: (
    anchor: VisibleEntityAnchor,
    input: { readonly access: RelationAccessContext },
  ) => SQL<EntityRelationSummaryState>;
  /** Visibility preparation needing I/O runs in an isolated savepoint. */
  readonly prepareSummaryQuery?: (
    anchor: VisibleEntityAnchor,
    input: { readonly access: RelationAccessContext },
  ) => Promise<SQL<EntityRelationSummaryState>>;
  /**
   * Optional cheap qualitative summary. It must use the same authorization,
   * tenant and data-scope predicates as list(). The response deliberately
   * contains no count or other cardinality signal.
   */
  readonly summarize?: (
    anchor: VisibleEntityAnchor,
    input: { readonly access: RelationAccessContext },
  ) => Promise<EntityRelationSummaryState>;
  /**
   * Optional existence-only fast path for providers that can answer with an
   * indexed EXISTS query. `true` maps to has-data and `false` to empty.
   */
  readonly exists?: (
    anchor: VisibleEntityAnchor,
    input: { readonly access: RelationAccessContext },
  ) => Promise<boolean>;
}

export type RelationItemMapper = (item: EntityRelationItem) => EntityRelationItem;
