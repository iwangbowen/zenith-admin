import { requireRow } from '../../lib/db-assert';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  reportDatasets,
  reportDatasources,
  reportFillRecords,
  reportFillTemplates,
  users,
} from '../../db/schema';
import { config } from '../../config';
import redis from '../../lib/redis';
import { runWithCurrentUser } from '../../lib/context';
import { exactTenantCondition } from '../../lib/tenant';
import { registerTaskHandler, submitAsyncTask } from '../../lib/task-center';
import type { JwtPayload } from '../../middleware/auth';
import type { ReportField, ReportFieldType } from '@zenith/shared/report';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { createDatasource } from './report-datasource.service';
import { createDataset, updateDataset } from './report-dataset.service';
import { declaredReportFillFields } from './report-fill-validation';

export const REPORT_FILL_SYNC_TASK = 'report-fill-sync';
const MAX_STATIC_FILL_ROWS = 50_000;

export function reportFillSyncIdempotencyKey(
  recordId: number,
  revision: number,
  suffix?: string,
): string {
  return `${REPORT_FILL_SYNC_TASK}:${recordId}:${suffix ?? revision}`;
}

export function isApprovedFillRecordConsumable(status: string): boolean {
  return status === 'approved';
}

function fieldType(field: WorkflowFormField): ReportFieldType {
  if (['number', 'amount', 'slider', 'rate'].includes(field.type)) return 'number';
  if (field.type === 'switch') return 'boolean';
  if (field.type === 'date') return 'date';
  return 'string';
}

function buildDatasetShape(
  template: typeof reportFillTemplates.$inferSelect,
  records: Array<typeof reportFillRecords.$inferSelect>,
) {
  const schema = template.publishedSchema ?? template.formSchema;
  const declared = declaredReportFillFields(schema);
  const fields: ReportField[] = declared.map((field) => ({
    name: field.key,
    label: field.label,
    type: fieldType(field),
  }));
  const columns = fields.map((field) => field.name);
  const data = records.map((record) => Object.fromEntries(
    columns.map((column) => [column, record.data[column] ?? null]),
  ));
  return { fields, columns, data };
}

export async function loadReportFillUserPayload(userId: number): Promise<JwtPayload> {
  const userOrUndefined = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, username: true, tenantId: true },
    with: { userRoles: { columns: {}, with: { role: { columns: { code: true } } } } },
  });
  const user = requireRow(userOrUndefined, '填报模板负责人不存在，无法同步数据集', 409);
  return {
    userId: user.id,
    username: user.username,
    tenantId: user.tenantId,
    roles: user.userRoles.map((item) => item.role.code),
  };
}

async function acquireTemplateLock(templateId: number) {
  const key = `${config.redis.keyPrefix}report:fill:sync:${templateId}`;
  const token = randomUUID();
  if (!await redis.set(key, token, 'EX', 120, 'NX')) {
    throw new HTTPException(409, { message: '同一填报模板正在同步，请稍后重试' });
  }
  return async () => {
    await redis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      key,
      token,
    );
  };
}

export async function synchronizeApprovedFillRecords(input: {
  recordId: number;
  isCancelled?: () => Promise<boolean>;
}) {
  const recordOrUndefined = await db.query.reportFillRecords.findFirst({
    where: eq(reportFillRecords.id, input.recordId),
  });
  const record = requireRow(recordOrUndefined, '填报记录不存在');
  if (!isApprovedFillRecordConsumable(record.status)) {
    return { skipped: true, reason: '记录未批准，不进入消费数据集' };
  }
  const templateOrUndefined = await db.query.reportFillTemplates.findFirst({
    where: eq(reportFillTemplates.id, record.templateId),
  });
  const template = requireRow(templateOrUndefined, '填报模板不存在');
  const ownerId = template.ownerId ?? template.createdBy ?? record.submitterId;
  const owner = await loadReportFillUserPayload(ownerId);
  const release = await acquireTemplateLock(template.id);
  try {
    if (await input.isCancelled?.()) return { skipped: true, reason: '任务已取消' };
    const approved = await db.select().from(reportFillRecords).where(and(
      eq(reportFillRecords.templateId, template.id),
      eq(reportFillRecords.status, 'approved'),
    )).orderBy(reportFillRecords.id).limit(MAX_STATIC_FILL_ROWS + 1);
    if (approved.length > MAX_STATIC_FILL_ROWS) {
      throw new HTTPException(409, { message: `已批准填报记录超过静态消费数据集上限（${MAX_STATIC_FILL_ROWS}）` });
    }
    if (await input.isCancelled?.()) return { skipped: true, reason: '任务已取消' };
    const shape = buildDatasetShape(template, approved);
    const marker = `report-fill-template:${template.id}`;
    const tenantWhere = exactTenantCondition(reportDatasources.tenantId, template.tenantId);
    let datasource = await db.query.reportDatasources.findFirst({
      where: and(tenantWhere, eq(reportDatasources.type, 'static'), eq(reportDatasources.remark, marker)),
    });
    let datasetId = template.generatedDatasetId;
    await runWithCurrentUser(owner, async () => {
      if (!datasource) {
        const created = await createDatasource({
          name: `填报数据源 · ${template.code}`,
          type: 'static',
          config: {},
          ownerId,
          status: 'enabled',
          remark: marker,
        });
        datasource = await db.query.reportDatasources.findFirst({
          where: eq(reportDatasources.id, created.id),
        });
      }
      if (!datasource) throw new HTTPException(500, { message: '填报数据源创建失败' });
      const currentDataset = datasetId
        ? await db.query.reportDatasets.findFirst({ where: eq(reportDatasets.id, datasetId) })
        : null;
      if (currentDataset) {
        await updateDataset(currentDataset.id, {
          content: { columns: shape.columns, data: shape.data },
          fields: shape.fields,
        });
      } else {
        const created = await createDataset({
          name: `填报数据 · ${template.name}`,
          datasourceId: datasource.id,
          content: { columns: shape.columns, data: shape.data },
          fields: shape.fields,
          params: [],
          computedFields: [],
          rowRules: [],
          cacheTtl: 0,
          ownerId,
          status: 'enabled',
          remark: marker,
        });
        datasetId = created.id;
      }
    });
    if (!datasetId) throw new HTTPException(500, { message: '填报消费数据集创建失败' });
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(reportFillTemplates).set({ generatedDatasetId: datasetId })
        .where(eq(reportFillTemplates.id, template.id));
      await tx.update(reportFillRecords).set({
        generatedDatasetId: datasetId,
        syncStatus: 'succeeded',
        syncError: null,
        syncedAt: now,
      }).where(and(
        eq(reportFillRecords.templateId, template.id),
        eq(reportFillRecords.status, 'approved'),
      ));
    });
    return { skipped: false, datasetId, approvedRecords: approved.length };
  } finally {
    await release();
  }
}

export async function submitReportFillSyncTask(recordId: number, idempotencySuffix?: string) {
  const record = await db.query.reportFillRecords.findFirst({
    where: eq(reportFillRecords.id, recordId),
  });
  if (!record || record.status !== 'approved') {
    throw new HTTPException(409, { message: '仅已批准填报记录可以提交消费同步任务' });
  }
  const task = await submitAsyncTask({
    taskType: REPORT_FILL_SYNC_TASK,
    title: `同步填报消费数据 #${record.id}`,
    payload: { recordId: record.id, templateId: record.templateId },
    idempotencyKey: reportFillSyncIdempotencyKey(record.id, record.revision, idempotencySuffix),
  });
  await db.update(reportFillRecords).set({
    syncStatus: task.status === 'success' ? 'succeeded' : 'pending',
    syncTaskId: task.id,
    syncError: null,
  }).where(eq(reportFillRecords.id, record.id));
  return task;
}

export async function submitReportFillSyncTaskAsUser(
  recordId: number,
  userId: number,
  idempotencySuffix?: string,
) {
  const user = await loadReportFillUserPayload(userId);
  return runWithCurrentUser(user, () => submitReportFillSyncTask(recordId, idempotencySuffix));
}

export async function submitReportFillSyncForWorkflowInstance(workflowInstanceId: number) {
  const record = await db.query.reportFillRecords.findFirst({
    where: and(
      eq(reportFillRecords.workflowInstanceId, workflowInstanceId),
      eq(reportFillRecords.status, 'approved'),
    ),
  });
  if (!record) return null;
  return submitReportFillSyncTask(record.id);
}

export function registerReportFillTasks(): void {
  registerTaskHandler({
    taskType: REPORT_FILL_SYNC_TASK,
    title: '同步填报消费数据',
    module: '报表填报',
    description: '将已批准填报记录同步到模板唯一的受治理静态数据集',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
    run: async (ctx) => {
      const recordId = Number(ctx.payload.recordId);
      if (!Number.isInteger(recordId) || recordId <= 0) throw new Error('任务参数 recordId 无效');
      await db.update(reportFillRecords).set({ syncStatus: 'running', syncError: null })
        .where(and(eq(reportFillRecords.id, recordId), eq(reportFillRecords.status, 'approved')));
      let completed = false;
      try {
        const start = await ctx.progress({
          processed: 0,
          total: 1,
          note: '正在读取已批准记录',
          checkpoint: { stage: 'load', recordId },
        });
        if (start.cancelRequested) {
          completed = true;
          await db.update(reportFillRecords).set({ syncStatus: 'pending' }).where(eq(reportFillRecords.id, recordId));
          return { cancelled: true };
        }
        const result = await synchronizeApprovedFillRecords({
          recordId,
          isCancelled: ctx.isCancelRequested,
        });
        if (result.skipped) {
          completed = true;
          await db.update(reportFillRecords).set({ syncStatus: 'pending' }).where(eq(reportFillRecords.id, recordId));
          return { skipped: true, reason: result.reason };
        }
        await ctx.progress({
          processed: 1,
          total: 1,
          note: '填报消费数据同步完成',
          checkpoint: { stage: 'done', recordId, datasetId: result.datasetId },
        });
        completed = true;
        return { datasetId: result.datasetId, approvedRecords: result.approvedRecords };
      } finally {
        if (!completed) {
          await db.update(reportFillRecords).set({
            syncStatus: 'failed',
            syncError: '填报消费数据同步任务失败，请在任务中心查看详情',
          }).where(eq(reportFillRecords.id, recordId));
        }
      }
    },
  });
}
