interface CachedRegionItem {
  label: string;
  value: string;
  children?: CachedRegionItem[];
}

let cachedRegions: CachedRegionItem[] | null = null;

export function getCachedRegions() {
  return cachedRegions;
}

export function setCachedRegions(regions: CachedRegionItem[]) {
  cachedRegions = regions;
}

export function resetRegionSelectCacheForTest() {
  cachedRegions = null;
}
