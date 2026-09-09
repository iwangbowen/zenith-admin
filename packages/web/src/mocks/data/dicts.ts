import type { Dict, DictItem } from '@zenith/shared/platform';
import { SEED_DICTS, SEED_DICT_ITEMS } from '@zenith/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockDicts: Dict[] = SEED_DICTS.map((d) => ({ ...d }));

export const mockDictItems: DictItem[] = SEED_DICT_ITEMS.map((i) => ({ ...i }));

let nextDictId = nextIdFrom(SEED_DICTS);
export function getNextDictId() {
  return nextDictId++;
}

let nextDictItemId = nextIdFrom(SEED_DICT_ITEMS);
export function getNextDictItemId() {
  return nextDictItemId++;
}
