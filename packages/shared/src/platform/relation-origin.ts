import type { EntityRelationSectionDescriptor } from './contracts/entity-relations';

/** Public explanations of the registered relation predicates, shared with Demo. */
export function explainEntityRelation(section: Pick<EntityRelationSectionDescriptor, 'key' | 'kind' | 'labelKey'>): string {
  if (section.labelKey === 'relation.common.related') return '由有权限的用户手动建立，同一租户的双方对象互相关联';
  if (section.labelKey === 'relation.common.subjects') return '该通知、任务或操作记录保存的来源业务对象引用';
  const suffix = section.key.split('.').at(-1);
  const explanations: Record<string, string> = {
    audit: '操作日志记录的业务主体与当前对象一致',
    tasks: '后台任务记录的业务主体与当前对象一致',
    notifications: '通知事件记录的业务主体与当前对象一致',
    'workflow-instances': '通过业务类型、业务主键和租户找到实际审批轮次',
    'business-history': '与当前流程属于同一业务单据的其他审批轮次',
    attachments: '沿实际审批轮次及附件绑定查找，已过滤不可见字段',
    archives: '沿实际审批实例的归档文件引用查找',
    'approval-tasks': '沿任务与审批实例或附件绑定的明确引用查找',
    'notify-logs': '支付单号、应用及渠道范围匹配，且回调已验签并处理成功',
    journals: '沿实际记账来源或入账凭证引用查找，同时匹配财务作用域',
    'recon-cases': '对账案件持有当前业务记录的明确引用',
    'recon-adjustments': '沿对账案件或实际入账凭证找到调整单',
    'settlement-batches': '沿结算认领的逐笔分录及结算自身凭证查找',
    'sharing-orders': '沿订单、接收方、冲正或记账来源的明确引用查找分账单',
    'sharing-reversals': '沿分账或记账来源的明确引用查找冲正记录',
    reversals: '冲正记录明确引用当前分账单',
    receiver: '分账单明确引用的分账接收方',
    'risk-hits': '风控记录在落单后已明确绑定当前支付订单',
    'risk-reviews': '审核记录明确绑定当前支付订单',
  };
  if (suffix && explanations[suffix]) return explanations[suffix];
  if (section.key === 'payment.order.refunds') return '退款单明确引用当前支付订单';
  if (section.key === 'payment.order.disputes') return '投诉记录与当前支付订单的订单号和应用范围匹配';
  if (section.key === 'member.member.payment-orders') return '会员钱包充值或续费履约记录明确引用支付订单';
  if (section.key === 'identity.user.payment-orders') return '支付订单记录的后台用户归属与当前用户一致';
  if (section.key === 'iot.device.alarms') return '告警记录明确引用当前设备';
  if (section.key === 'cms.content.related') return '同一站点内容显式配置的相关文章';
  return {
    direct: '通过已保存的对象引用直接关联',
    derived: '按领域规则和明确业务引用查询关联对象',
    causal: '通过流程或事件保存的业务引用确定关联',
    activity: '通过操作活动保存的业务主体引用确定关联',
  }[section.kind];
}
