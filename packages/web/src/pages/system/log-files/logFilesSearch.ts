export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function findMatchRanges(line: string, keyword: string) {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return [];

  const regex = new RegExp(escapeRegExp(normalizedKeyword), 'gi');
  return Array.from(line.matchAll(regex), (match) => {
    const start = match.index ?? 0;
    return { start, end: start + match[0].length };
  });
}

export function buildSearchMatchMap(lines: string[], keyword: string) {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return [];

  return lines.flatMap((line, lineIndex) =>
    findMatchRanges(line, normalizedKeyword).map((match, matchIndex) => ({
      lineIndex,
      matchIndex,
      ...match,
    })),
  );
}
