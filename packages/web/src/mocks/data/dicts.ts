import type { Dict, DictItem } from '@zenith/shared';
import { SEED_DICTS, SEED_DICT_ITEMS } from '@zenith/shared';

export const mockDicts: Dict[] = SEED_DICTS.map((d) => ({ ...d }));

export const mockDictItems: DictItem[] = SEED_DICT_ITEMS.map((i) => ({ ...i }));

let nextDictId = Math.max(...SEED_DICTS.map((d) => d.id)) + 1;
export function getNextDictId() {
  return nextDictId++;
}

let nextDictItemId = Math.max(...SEED_DICT_ITEMS.map((i) => i.id)) + 1;
export function getNextDictItemId() {
  return nextDictItemId++;
}
