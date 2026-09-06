import type { AnalyticsQualityIssueType } from '@zenith/shared/analytics';

/** 数据质量问题类型标签色（调试与质量 Tab 共用） */
export const ANALYTICS_ISSUE_TAG_COLOR: Record<AnalyticsQualityIssueType, 'red' | 'orange' | 'amber' | 'grey'> = {
  missing_required: 'orange',
  type_mismatch: 'amber',
  invalid_enum: 'red',
  event_disabled: 'grey',
  origin_rejected: 'red',
  quota_exceeded: 'orange',
};