import { createReportDqRuleSchema, createReportMetricSchema, createReportQueryQuotaSchema, grantReportResourceAclSchema, applyReportAssetTemplateSchema, reportMetricLifecycleActionSchema, updateReportMetricSchema, updateReportDqRuleSchema, updateReportQueryQuotaSchema } from '@zenith/shared/report';
import type { ApplyReportAssetTemplateInput, CreateReportMetricInput, GrantReportResourceAclInput, ReportDqRunStatus, ReportMetric, ReportResourceType, ReportWidgetType } from '@zenith/shared/report';
import type { AsyncTask } from '@zenith/shared/tasks';
import { DEFAULT_TIMEZONE } from '@/utils/timezones';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

export const METRIC_WIDGET_TYPES: readonly ReportWidgetType[] = ['kpi', 'gauge', 'flipper', 'liquid'];

export function supportsMetricBinding(type: ReportWidgetType): boolean {
  return METRIC_WIDGET_TYPES.includes(type);
}

export function parseJsonObject(value: string, fieldLabel: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel}必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

export function normalizeMetricFormValues(
  values: Record<string, unknown>,
  editing?: Pick<ReportMetric, 'revision'> | null,
): CreateReportMetricInput {
  const normalized = {
    ...values,
    folderId: values.folderId || null,
    ownerId: values.ownerId || null,
    description: values.description || null,
    sourceField: values.sourceField || null,
    formula: values.formula || null,
    aggregate: values.aggregate || null,
    dimensions: typeof values.dimensions === 'string'
      ? values.dimensions.split(',').map((item) => item.trim()).filter(Boolean)
      : (values.dimensions ?? []),
    timeField: values.timeField || null,
    unit: values.unit || null,
    format: values.format || null,
    caliber: values.caliber || null,
    ...(editing ? { expectedRevision: editing.revision } : {}),
  };
  const parsed = editing
    ? updateReportMetricSchema.safeParse(normalized)
    : createReportMetricSchema.safeParse(normalized);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || '指标配置不合法');
  return parsed.data as CreateReportMetricInput;
}

export function validateQuotaForm(values: Record<string, unknown>, editing: boolean) {
  const parsed = editing
    ? updateReportQueryQuotaSchema.safeParse(values)
    : createReportQueryQuotaSchema.safeParse(values);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || '配额配置不合法');
  return parsed.data;
}

export function normalizeDqRuleFormValues(values: Record<string, unknown>, editing: boolean) {
  const type = values.type;
  const config = type === 'range'
    ? { min: values.min ?? null, max: values.max ?? null }
    : type === 'pattern'
      ? { pattern: values.pattern || null }
      : type === 'freshness'
        ? { maxAgeMinutes: values.maxAgeMinutes ?? null }
        : type === 'row_count'
          ? { minRows: values.minRows ?? null, maxRows: values.maxRows ?? null }
          : type === 'custom_sql'
            ? { sql: values.sql || null }
            : {};
  const normalized = {
    datasetId: values.datasetId,
    name: values.name,
    type,
    field: ['row_count', 'custom_sql'].includes(String(type)) ? null : (values.field || null),
    severity: values.severity ?? 'medium',
    config,
    cron: values.cron || null,
    timezone: values.timezone || DEFAULT_TIMEZONE,
    enabled: values.enabled ?? true,
  };
  const parsed = editing
    ? updateReportDqRuleSchema.safeParse(normalized)
    : createReportDqRuleSchema.safeParse(normalized);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || '质量规则配置不合法');
  return parsed.data;
}

export function switchAlertSource(source: 'dataset' | 'metric') {
  return source === 'metric'
    ? { datasetId: null, field: null, groupByField: null }
    : { metricId: null };
}

export function isRevisionConflict(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 409;
}

export function metricLifecyclePayload(revision: number, reason?: string) {
  return reportMetricLifecycleActionSchema.parse({
    expectedRevision: revision,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
  });
}

const DQ_RUN_STATUS_LABELS: Record<ReportDqRunStatus, string> = {
  pending: '等待中',
  running: '运行中',
  succeeded: '已通过',
  failed: '失败',
  cancelled: '已取消',
};

export function dqRunStatusLabel(status: ReportDqRunStatus): string {
  return DQ_RUN_STATUS_LABELS[status];
}

export function formatDqPassRate(value: number | null | undefined): string {
  const numeric = Number(value);
  return value == null || !Number.isFinite(numeric) ? EMPTY_PLACEHOLDER : `${numeric.toFixed(2)}%`;
}

export function dqTaskSubmissionMessage(task: Pick<AsyncTask, 'id'>): string {
  return `任务 #${task.id} 已提交，可在顶部全局任务托盘查看进度`;
}

export function normalizeAclGrantValues(
  resourceType: ReportResourceType,
  resourceId: number,
  values: Record<string, unknown>,
): GrantReportResourceAclInput {
  return grantReportResourceAclSchema.parse({
    ...values,
    resourceType,
    resourceId,
    subjectId: Number(values.subjectId),
    inheritFromFolder: Boolean(values.inheritFromFolder),
    expiresAt: values.expiresAt || null,
  });
}

export function aclRevokeWarning(): string {
  return '撤销后主体将立即失去由该条 ACL 授予的访问能力。';
}

export function approvalConflictMessage(error: unknown): string | null {
  return isRevisionConflict(error) ? '审批状态或资源修订已变化，请刷新后重试' : null;
}

export function normalizeTemplateApplyValues(values: Record<string, unknown>): ApplyReportAssetTemplateInput {
  return applyReportAssetTemplateSchema.parse({
    ...values,
    ...(typeof values.name === 'string' ? { name: values.name.trim() || undefined } : {}),
  });
}
