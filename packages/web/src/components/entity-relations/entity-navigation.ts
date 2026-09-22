import { createContext } from 'react';
import type { CanonicalEntityRef } from '@zenith/shared/platform';

/** One sheet owns navigation history so following relations does not stack drawers. */
export const EntityNavigationContext = createContext<((ref: CanonicalEntityRef) => void) | null>(null);

export type EntityRelationNavigationFrame = Readonly<{
  pathname: string;
  search: string;
  hash: string;
  scrollTop: number;
}>;

export type EntityRelationNavigationState = Readonly<{
  entityRelation?: Readonly<{ stack: readonly EntityRelationNavigationFrame[] }>;
}>;

const MAX_ENTITY_RELATION_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFrame(value: unknown): value is EntityRelationNavigationFrame {
  if (!isRecord(value)) return false;
  return typeof value.pathname === 'string' && value.pathname.startsWith('/')
    && typeof value.search === 'string' && typeof value.hash === 'string'
    && typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop);
}

export function readEntityRelationStack(state: unknown): readonly EntityRelationNavigationFrame[] {
  if (!isRecord(state) || !isRecord(state.entityRelation) || !Array.isArray(state.entityRelation.stack)) return [];
  return state.entityRelation.stack.filter(isFrame).slice(-MAX_ENTITY_RELATION_DEPTH);
}

export function appendEntityRelationFrame(
  location: Pick<Location, 'pathname' | 'search' | 'hash' | 'state'>,
  scrollTop = document.querySelector<HTMLElement>('.admin-content')?.scrollTop ?? 0,
): EntityRelationNavigationState {
  const stack = readEntityRelationStack(location.state);
  const frame: EntityRelationNavigationFrame = {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    scrollTop: Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0,
  };
  return { entityRelation: { stack: [...stack, frame].slice(-MAX_ENTITY_RELATION_DEPTH) } };
}

export function entityRelationFrameUrl(frame: EntityRelationNavigationFrame): string {
  return `${frame.pathname}${frame.search}${frame.hash}`;
}
