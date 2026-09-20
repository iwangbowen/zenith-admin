interface RelationCursor {
  readonly offset: number;
}

export function encodeRelationCursor(offset: number): string | null {
  if (!Number.isInteger(offset) || offset < 0) return null;
  return Buffer.from(JSON.stringify({ offset } satisfies RelationCursor), 'utf8').toString('base64url');
}

export function decodeRelationCursor(value: string | undefined): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<RelationCursor>;
    return Number.isInteger(parsed.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}
