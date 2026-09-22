export const MANUAL_RELATION_TYPES = ['related', 'supplement', 'reference', 'followup'] as const;
export type ManualRelationType = typeof MANUAL_RELATION_TYPES[number];
export const MANUAL_RELATION_CATALOG = {
  related: { key: 'platform.related', label: '相关对象', reverseLabel: '相关对象', symmetric: true },
  supplement: { key: 'platform.manual.supplement', label: '补充材料', reverseLabel: '材料用于', symmetric: false },
  reference: { key: 'platform.manual.reference', label: '参考依据', reverseLabel: '被引用于', symmetric: false },
  followup: { key: 'platform.manual.followup', label: '后续处理', reverseLabel: '前置事项', symmetric: false },
} as const;
export const MANUAL_RELATION_OPTIONS = MANUAL_RELATION_TYPES.map((value) => ({ value, label: MANUAL_RELATION_CATALOG[value].label }));
