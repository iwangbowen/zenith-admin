export interface KeywordFilterOptions {
  caseInsensitive?: boolean;
}

type KeywordValue = string | number | boolean | null | undefined;

function isOptions(value: KeywordValue | KeywordFilterOptions): value is KeywordFilterOptions {
  return typeof value === 'object' && value !== null && 'caseInsensitive' in value;
}

export function includesKeyword(
  keyword: string | null | undefined,
  ...valuesAndOptions: Array<KeywordValue | KeywordFilterOptions>
): boolean {
  const options = valuesAndOptions.length > 0 && isOptions(valuesAndOptions[valuesAndOptions.length - 1])
    ? valuesAndOptions.pop() as KeywordFilterOptions
    : undefined;
  const normalizedKeyword = options?.caseInsensitive ? (keyword ?? '').toLowerCase() : (keyword ?? '');
  if (!normalizedKeyword) return true;
  return valuesAndOptions.some((value) => {
    const text = String(value ?? '');
    return (options?.caseInsensitive ? text.toLowerCase() : text).includes(normalizedKeyword);
  });
}

export function filterByKeyword<T>(
  list: readonly T[],
  keyword: string | null | undefined,
  selectors: Array<(item: T) => KeywordValue>,
  options?: KeywordFilterOptions,
): T[] {
  if (!keyword) return [...list];
  return list.filter((item) => includesKeyword(keyword, ...selectors.map((select) => select(item)), options));
}
