const RELATION_LABELS: Record<string, string> = {
  'relation.payment.order.refunds': '关联退款',
  'relation.payment.order.workflow': '关联流程',
  'relation.payment.order.audit': '操作审计',
  'relation.payment.order.notifications': '通知记录',
  'relation.payment.order.tasks': '异步任务',
};

export function entityRelationLabel(labelKey: string): string {
  return RELATION_LABELS[labelKey] ?? labelKey;
}
