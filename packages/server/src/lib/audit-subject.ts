/** Audit identity shares the same validation and bounds as notifications and tasks. */
export {
  normalizeSubjectRefs as normalizeAuditSubjects,
  SUBJECT_REF_LIMIT as AUDIT_SUBJECT_LIMIT,
  SUBJECT_REF_ROLES as AUDIT_SUBJECT_ROLES,
  type SubjectRefInput as AuditSubjectRef,
  type SubjectRef as NormalizedAuditSubjectRef,
  type SubjectRefRole as AuditSubjectRole,
} from '@zenith/shared/core';
