import type { EntityRelationItem, EntityRelationPage, EntityRelationSection } from '@zenith/shared/platform';
import type { CanonicalEntityType } from '@zenith/shared/platform';
import type { EntityRef, RelationKey } from '@zenith/shared/core';
import type { Permission } from '@zenith/shared/core';
import type { JwtPayload } from '../../../middleware/auth';
import type { DbTransaction } from '../../../db/types';

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
  readonly descriptor: EntityRelationSection;
  readonly list: (
    anchor: VisibleEntityAnchor,
    input: { readonly cursor?: string; readonly limit: number; readonly access: RelationAccessContext },
  ) => Promise<EntityRelationPage>;
}

export type RelationItemMapper = (item: EntityRelationItem) => EntityRelationItem;
