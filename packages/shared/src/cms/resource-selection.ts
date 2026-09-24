/** Explicit resource handles, including handles embedded in rich text; numeric metadata is not a selection. */
export function collectCmsSelectedResourceIds(value: unknown): number[] {
  const ids = new Set<number>();
  const walk = (item: unknown): void => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/cms-res:\/\/([1-9]\d*)(?![\dA-Za-z_-])/g)) {
        const id = Number(match[1]);
        if (Number.isSafeInteger(id)) ids.add(id);
      }
    } else if (Array.isArray(item)) item.forEach(walk);
    else if (item && typeof item === 'object') Object.values(item).forEach(walk);
  };
  walk(value);
  return [...ids];
}
