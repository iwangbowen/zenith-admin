import { createContext, useSyncExternalStore } from 'react';
import type { CanonicalEntityRef } from '@zenith/shared/platform/entity-catalog';

export const EntityNavigationContext = createContext<((ref: CanonicalEntityRef) => void) | null>(null);

export const EntityRelationViewStateContext = createContext<{
  expandedGroups: string[];
  setExpandedGroups: (keys: string[]) => void;
} | null>(null);

export type EntityRelationViewSnapshot = Readonly<{
  tab: string;
  expandedGroups: readonly string[];
  /** Ancestor offsets, relative to the context root, include the detail sheet body. */
  scroll: readonly { depth: number; top: number; left: number }[];
}>;

export type EntityRelationNavigationFrame = Readonly<{
  url: string;
  locationKey: string;
  state?: unknown;
  ref?: CanonicalEntityRef;
  kind: 'detail' | 'sheet' | 'page';
  view?: EntityRelationViewSnapshot;
  sheetHistory?: readonly CanonicalEntityRef[];
  pageScrollTop: number;
  lists?: Readonly<Record<string, RelationListSnapshot<unknown>>>;
}>;

export type RelationListSnapshot<T> = Readonly<{ draft: T; submitted: T; page: number; pageSize: number }>;
const listReaders = new Map<string, Map<string, () => RelationListSnapshot<unknown>>>();
export function registerRelationList(path: string, key: string, read: () => RelationListSnapshot<unknown>) {
  const readers = listReaders.get(path) ?? new Map<string, () => RelationListSnapshot<unknown>>();
  readers.set(key, read); listReaders.set(path, readers);
  return () => { if (readers.get(key) === read) readers.delete(key); if (!readers.size) listReaders.delete(path); };
}
export function readRelationListSnapshot<T>(path: string | undefined, key: string): RelationListSnapshot<T> | undefined {
  const frame = session?.restore;
  if (!path || !frame || new URL(frame.url, 'https://zenith.invalid').pathname !== path) return undefined;
  return frame.lists?.[key] as RelationListSnapshot<T> | undefined;
}

export type EntityRelationNavigationSession = Readonly<{
  accessKey: string;
  stack: readonly EntityRelationNavigationFrame[];
  destinationPath: string;
  departingPath: string;
  arrived: boolean;
  revision: number;
  restore?: EntityRelationNavigationFrame;
}>;

const MAX_DEPTH = 12;
let session: EntityRelationNavigationSession | null = null;
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getEntityRelationNavigation = () => session;

function updateSession(value: EntityRelationNavigationSession | null) {
  session = value;
  for (const listener of listeners) listener();
}

/** A small session store survives query consumption without importing relation queries into the shell. */
export function useEntityRelationNavigationSession() {
  return useSyncExternalStore(subscribe, getEntityRelationNavigation, getEntityRelationNavigation);
}

export function clearEntityRelationNavigation() { if (session) updateSession(null); }

export function sameEntity(a: CanonicalEntityRef | undefined, b: CanonicalEntityRef | undefined) {
  return Boolean(a && b && a.type === b.type && a.key === b.key);
}

/** Exact detail parameters are reconstructed even when their one-shot URL was consumed. */
export function entityRelationSourceUrl(
  location: { pathname: string; search: string; hash: string },
  detailRoute?: string,
) {
  if (!detailRoute) return `${location.pathname}${location.search}${location.hash}`;
  const detail = new URL(detailRoute, 'https://zenith.invalid');
  if (detail.pathname !== location.pathname) return `${detail.pathname}${detail.search}${detail.hash}`;
  const search = new URLSearchParams(location.search);
  for (const [key, value] of detail.searchParams) search.set(key, value);
  const query = search.toString();
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

export function beginEntityRelationNavigation(
  source: EntityRelationNavigationFrame,
  destinationRoute: string,
  accessKey: string,
  currentPathname: string,
) {
  const previous = session?.accessKey === accessKey && session.destinationPath === currentPathname ? session.stack : [];
  const lists = Object.fromEntries([...(listReaders.get(currentPathname) ?? [])].map(([key, read]) => [key, structuredClone(read())]));
  updateSession({
    accessKey, stack: [...previous, { ...source, lists }].slice(-MAX_DEPTH),
    destinationPath: new URL(destinationRoute, 'https://zenith.invalid').pathname,
    departingPath: currentPathname, arrived: false, revision: ++revision,
  });
}

export function popEntityRelationNavigation(index = (session?.stack.length ?? 0) - 1): EntityRelationNavigationFrame | undefined {
  const current = session;
  const frame = index >= 0 ? current?.stack[index] : undefined;
  if (!current || !frame) return undefined;
  updateSession({
    ...current, stack: current.stack.slice(0, index), restore: frame,
    departingPath: current.destinationPath,
    destinationPath: new URL(frame.url, 'https://zenith.invalid').pathname,
    arrived: false, revision: ++revision,
  });
  return frame;
}

/** Unrelated menu navigation ends the relation trail; URL cleanup on the same page does not. */
export function observeEntityRelationLocation(pathname: string, accessKey: string) {
  const current = session;
  if (!current) return;
  if (current.accessKey !== accessKey) { clearEntityRelationNavigation(); return; }
  if (pathname === current.destinationPath) {
    if (!current.arrived) updateSession({ ...current, arrived: true });
  } else if (current.arrived || pathname !== current.departingPath) clearEntityRelationNavigation();
}

export function captureEntityRelationScroll(root: HTMLElement | null): EntityRelationViewSnapshot['scroll'] {
  const result: { depth: number; top: number; left: number }[] = [];
  let element = root;
  let depth = 0;
  while (element && element !== document.body) {
    if (element.scrollTop || element.scrollLeft) result.push({ depth, top: element.scrollTop, left: element.scrollLeft });
    element = element.parentElement;
    depth += 1;
  }
  return result;
}

/** Wait for lazy groups/query content to make the saved offset reachable; user input cancels restoration. */
export function restoreEntityRelationScroll(root: HTMLElement, scroll: EntityRelationViewSnapshot['scroll']) {
  let stopped = false;
  let animationFrame = 0;
  const targets = scroll.flatMap((position) => {
    let element: HTMLElement | null = root;
    for (let depth = 0; depth < position.depth; depth += 1) element = element?.parentElement ?? null;
    return element ? [{ ...position, element }] : [];
  });
  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(animationFrame);
    observer?.disconnect();
    clearTimeout(timeout);
    document.removeEventListener('pointerdown', cleanup, true);
    document.removeEventListener('wheel', cleanup, true);
    document.removeEventListener('keydown', cleanup, true);
  };
  const attempt = () => {
    if (stopped) return;
    let reached = true;
    for (const { element, top, left } of targets) {
      element.scrollTop = top;
      element.scrollLeft = left;
      reached &&= Math.abs(element.scrollTop - top) <= 1 && Math.abs(element.scrollLeft - left) <= 1;
    }
    if (reached) cleanup();
  };
  const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => {
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(attempt);
  });
  observer?.observe(root.closest('.semi-sidesheet-body, .semi-modal-body') ?? root, { childList: true, subtree: true, attributes: true });
  const timeout = setTimeout(cleanup, 4000);
  document.addEventListener('pointerdown', cleanup, true);
  document.addEventListener('wheel', cleanup, true);
  document.addEventListener('keydown', cleanup, true);
  animationFrame = requestAnimationFrame(attempt);
  return cleanup;
}
