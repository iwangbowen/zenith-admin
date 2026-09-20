/**
 * Structured object identity attached to an operation audit record.
 *
 * `type` and `key` are deliberately opaque to the audit layer. Domain code
 * owns the entity registry and authorization checks; this helper only keeps
 * the persisted shape bounded and deduplicated.
 */
export const AUDIT_SUBJECT_ROLES = ['primary', 'related', 'source', 'target'] as const;
export type AuditSubjectRole = (typeof AUDIT_SUBJECT_ROLES)[number];

export interface AuditSubjectRef {
  readonly type: string;
  readonly key: string;
  readonly role?: AuditSubjectRole;
}

export interface NormalizedAuditSubjectRef {
  readonly type: string;
  readonly key: string;
  readonly role: AuditSubjectRole;
}

const MAX_TYPE_LENGTH = 96;
const MAX_KEY_LENGTH = 512;
const MAX_SUBJECTS_PER_OPERATION = 128;

/**
 * Normalize refs before they enter request context or the database.
 * Empty and overlong values are rejected so a malformed caller cannot create
 * an unqueryable subject row. Duplicate refs are collapsed by role/type/key.
 */
export function normalizeAuditSubjects(refs: readonly AuditSubjectRef[]): NormalizedAuditSubjectRef[] {
  const result: NormalizedAuditSubjectRef[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const type = ref.type.trim();
    const key = ref.key.trim();
    if (type.length === 0 || type.length > MAX_TYPE_LENGTH || key.length === 0 || key.length > MAX_KEY_LENGTH) {
      throw new Error('Invalid audit subject reference');
    }
    const role = ref.role ?? 'primary';
    const dedupeKey = `${role}\u0000${type}\u0000${key}`;
    if (seen.has(dedupeKey)) continue;
    if (result.length >= MAX_SUBJECTS_PER_OPERATION) {
      throw new Error(`Too many audit subject references (maximum ${MAX_SUBJECTS_PER_OPERATION})`);
    }
    seen.add(dedupeKey);
    result.push({ type, key, role });
  }

  return result;
}

export const AUDIT_SUBJECT_LIMIT = MAX_SUBJECTS_PER_OPERATION;
