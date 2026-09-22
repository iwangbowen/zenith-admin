import { COMMON_STATUS_OPTIONS } from '../core/constants';
import {
  PAYMENT_ORDER_STATUS_OPTIONS, PAYMENT_REFUND_STATUS_OPTIONS, PAYMENT_DISPUTE_STATUS_OPTIONS,
  PAYMENT_RISK_ACTION_OPTIONS, PAYMENT_RISK_REVIEW_STATUS_OPTIONS, PAYMENT_RECON_CASE_STATUS_OPTIONS,
  PAYMENT_RECON_ADJUSTMENT_STATUS_OPTIONS, PAYMENT_SHARING_ORDER_STATUS_OPTIONS,
  PAYMENT_SHARING_REVERSAL_STATUS_OPTIONS, PAYMENT_SETTLEMENT_STATUS_OPTIONS,
} from '../payment/constants';
import { WORKFLOW_INSTANCE_STATUS_OPTIONS, WORKFLOW_TASK_STATUSES, WORKFLOW_TASK_STATUS_LABELS } from '../workflow/constants';
import { IOT_ALARM_STATUS_OPTIONS } from '../iot/constants';
import { CMS_CONTENT_STATUSES, CMS_CONTENT_STATUS_LABELS } from '../cms/constants';
import { WIKI_DOC_STATUS_OPTIONS } from '../wiki/constants';
import { NOTIFICATION_OUTBOX_STATUS_OPTIONS } from '../messaging/constants';
import { ASYNC_TASK_STATUS_OPTIONS } from '../tasks/constants';
import type { CanonicalEntityType } from './entity-registry';
import type { EntityRelationFilterCapabilities, EntityRelationFilters } from './contracts/entity-relations';

const statuses: Partial<Record<CanonicalEntityType, EntityRelationFilterCapabilities['statusOptions']>> = {
  'payment.order': PAYMENT_ORDER_STATUS_OPTIONS,
  'payment.refund': PAYMENT_REFUND_STATUS_OPTIONS,
  'payment.dispute': PAYMENT_DISPUTE_STATUS_OPTIONS,
  'payment.risk-hit': PAYMENT_RISK_ACTION_OPTIONS,
  'payment.risk-review': PAYMENT_RISK_REVIEW_STATUS_OPTIONS,
  'payment.recon-case': PAYMENT_RECON_CASE_STATUS_OPTIONS,
  'payment.recon-adjustment': PAYMENT_RECON_ADJUSTMENT_STATUS_OPTIONS,
  'payment.sharing-order': PAYMENT_SHARING_ORDER_STATUS_OPTIONS,
  'payment.sharing-reversal': PAYMENT_SHARING_REVERSAL_STATUS_OPTIONS,
  'payment.sharing-receiver': COMMON_STATUS_OPTIONS,
  'payment.settlement-batch': PAYMENT_SETTLEMENT_STATUS_OPTIONS,
  'workflow.instance': WORKFLOW_INSTANCE_STATUS_OPTIONS,
  'workflow.task': WORKFLOW_TASK_STATUSES.map((value) => ({ value, label: WORKFLOW_TASK_STATUS_LABELS[value] })),
  'notification.outbox': NOTIFICATION_OUTBOX_STATUS_OPTIONS,
  'tasks.async': ASYNC_TASK_STATUS_OPTIONS,
  'iot.alarm': IOT_ALARM_STATUS_OPTIONS,
  'iot.device': COMMON_STATUS_OPTIONS,
  'cms.content': CMS_CONTENT_STATUSES.map((value) => ({ value, label: CMS_CONTENT_STATUS_LABELS[value] })),
  'wiki.document': WIKI_DOC_STATUS_OPTIONS,
};

/** Standard homogeneous record filters; providers opt in only after implementing SQL predicates. */
export function entityRelationRecordFilters(target: CanonicalEntityType, attentionOnly = false): EntityRelationFilterCapabilities {
  return { keyword: true, dateRange: true, statusOptions: statuses[target], ...(attentionOnly ? { attentionOnly: true } : {}) };
}

export function normalizeEntityRelationFilters(filters: EntityRelationFilters): EntityRelationFilters {
  return { keyword: filters.keyword?.trim() || undefined, status: filters.status?.trim() || undefined,
    startTime: filters.startTime || undefined, endTime: filters.endTime || undefined, attentionOnly: filters.attentionOnly || undefined };
}

export function supportsEntityRelationFilters(filters: EntityRelationFilters, capabilities?: EntityRelationFilterCapabilities): boolean {
  return !(filters.keyword && !capabilities?.keyword)
    && !(filters.status && !capabilities?.statusOptions?.some((option) => option.value === filters.status))
    && !((filters.startTime || filters.endTime) && !capabilities?.dateRange)
    && !(filters.attentionOnly && !capabilities?.attentionOnly);
}
