import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { REPORT_MATERIALIZATION_STRATEGIES, REPORT_SNAPSHOT_STATUSES } from '../types';
import { requestReportMaterializationSchema } from '../validation';

// ─── 物化快照 ───────────────────────────────────────────────────────────────

export const reportMaterializationSnapshotSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  datasetId: z.int(),
  strategy: z.enum(REPORT_MATERIALIZATION_STRATEGIES),
  status: z.enum(REPORT_SNAPSHOT_STATUSES),
  revision: z.int(),
  keyField: z.string().nullable().optional(),
  watermark: z.string().nullable().optional(),
  deltaWindowMinutes: z.int().nullable().optional(),
  fileId: z.string().nullable().optional(),
  rowCount: z.int(),
  byteSize: z.int(),
  checksum: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportMaterializationSnapshot' });

export type ReportMaterializationSnapshot = z.infer<typeof reportMaterializationSnapshotSchema>;

export const reportMaterializationContract = defineContract('/api/report/materializations', {
  snapshots: op.get('/datasets/{id}/snapshots', { params: idParam, query: paginationQuery, response: paginated(reportMaterializationSnapshotSchema), summary: '物化快照历史' }),
  current: op.get('/datasets/{id}/current', { params: idParam, response: reportMaterializationSnapshotSchema.nullable(), summary: '当前物化快照' }),
  refresh: op.post('/datasets/{id}/refresh', { params: idParam, body: requestReportMaterializationSchema, response: asyncTaskSchema, summary: '异步刷新物化快照' }),
  purge: op.delete('/snapshots/{id}', { params: idParam, summary: '清除物化快照' }),
  purgeDataset: op.delete('/datasets/{id}/snapshots', { params: idParam, summary: '清除数据集历史快照' }),
}, { tags: ['报表物化'] });
