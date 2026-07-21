export function cmsCredentialWriteValue(value: unknown, clear: unknown): string | null {
  return clear === true ? null : String(value ?? '').trim();
}
