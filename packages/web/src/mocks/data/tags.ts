import { SEED_TAGS } from '@zenith/shared/seed';
import type { Tag } from '@zenith/shared/platform';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockTags: Tag[] = [...SEED_TAGS];

let nextTagId = nextIdFrom(mockTags);
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
