import { decryptField, encryptField } from '../../lib/encryption';

export const REPORT_SECRET_MASK = '******';

export function isSensitiveReportHeader(name: string): boolean {
  return /(authorization|cookie|token|secret|api[-_]?key|access[-_]?key|credential|signature)/i.test(name);
}

export function maskReportSecret(value: string | null | undefined): string | null {
  return value ? REPORT_SECRET_MASK : null;
}

export function prepareReportSecret(
  input: string | null | undefined,
  current: string | null | undefined,
): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || input === '') return null;
  if (input === REPORT_SECRET_MASK) {
    if (!current) return null;
    return decryptField(current) === null ? encryptField(current) : current;
  }
  return encryptField(input);
}

export function resolveReportSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return decryptField(value) ?? value;
}
