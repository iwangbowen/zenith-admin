import { SEED_TAGS } from '@zenith/shared';
import type { Tag } from '@zenith/shared';

export const mockTags: Tag[] = [...SEED_TAGS];

let nextTagId = Math.max(...mockTags.map((t) => t.id)) + 1;
export function getNextTagId() {
  return nextTagId++;
}

export function getTagGroups(): string[] {
  const seen = new Set<string>();
  mockTags
    .filter((t) => t.status === 'enabled' && t.groupName)
    .forEach((t) => seen.add(t.groupName as string));
  return [...seen].sort((a, b) => a.localeCompare(b));
}
