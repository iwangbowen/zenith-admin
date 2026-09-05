import type { ReportFillRecord, ReportFillTemplate } from '@zenith/shared/report';
import { reportFillContract } from '@zenith/shared/report';
import type { WorkflowFormField, WorkflowFormSchema } from '@zenith/shared/workflow';
import {
  getNextReportDatasetId,
  mockReportDatasets,
} from '@/mocks/data/report';
import {
  mockReportFillRecords,
  mockReportFillTemplates,
  mockReportFolders,
  nextReportP2Id,
} from '@/mocks/data/report-p2';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest, conflict, notFound } from '@/mocks/utils/handlers';
import { createProgressingMockTask } from './async-tasks';
import { DEMO_TENANT_ID, DEMO_USER_ID, DEMO_USER_NAME } from './report-mock-utils';

function templateView(template: ReportFillTemplate): ReportFillTemplate {
  return {
    ...template,
    folderName: mockReportFolders.find((folder) => folder.id === template.folderId)?.name ?? null,
    ownerName: template.ownerId === DEMO_USER_ID ? DEMO_USER_NAME : null,
  };
}

function recordView(record: ReportFillRecord): ReportFillRecord {
  return {
    ...record,
    templateName: mockReportFillTemplates.find((template) => template.id === record.templateId)?.name ?? record.templateName ?? null,
    submitterName: record.submitterId === DEMO_USER_ID ? DEMO_USER_NAME : record.submitterName ?? null,
  };
}

function visibleFields(schema: WorkflowFormSchema): WorkflowFormField[] {
  return schema.fields.flatMap((field) => {
    if (field.type === 'row') return field.columns?.flatMap((column) => visibleFields({ fields: column.fields })) ?? [];
    if (field.type === 'tabs' || field.type === 'steps') return field.panes?.flatMap((pane) => visibleFields({ fields: pane.fields })) ?? [];
    return [field];
  });
}

function validateRequired(schema: WorkflowFormSchema, data: Record<string, unknown>): string | null {
  const missing = visibleFields(schema).find((field) => {
    if (!field.required || field.hidden || ['description', 'divider', 'group'].includes(field.type)) return false;
    const value = data[field.key];
    return value == null || value === '' || (Array.isArray(value) && value.length === 0);
  });
  return missing ? `请填写「${missing.label}」` : null;
}

function assertRevision(record: ReportFillRecord, expectedRevision: number): Response | null {
  return record.revision === expectedRevision ? null : conflict('记录已被其他操作更新，请刷新后重试', { status: 409 });
}

function ensureGeneratedDataset(template: ReportFillTemplate) {
  if (template.generatedDatasetId) return template.generatedDatasetId;
  const source = mockReportDatasets[1] ?? mockReportDatasets[0];
  const now = mockDateTime();
  const dataset = {
    ...source,
    id: getNextReportDatasetId(),
    name: `${template.name}数据集`,
    datasourceId: 2,
    type: 'static' as const,
    content: { data: [], columns: [] },
    fields: visibleFields(template.publishedSchema ?? template.formSchema)
      .filter((field) => !['description', 'divider', 'group', 'row', 'tabs', 'steps'].includes(field.type))
      .map((field) => ({ name: field.key, label: field.label, type: field.type === 'number' || field.type === 'amount' ? 'number' as const : 'string' as const })),
    params: [],
    computedFields: [],
    cacheTtl: 0,
    folderId: null,
    ownerId: DEMO_USER_ID,
    remark: `填报模板「${template.name}」自动生成`,
    createdAt: now,
    updatedAt: now,
  };
  mockReportDatasets.push(dataset);
  template.generatedDatasetId = dataset.id;
  template.updatedAt = now;
  return dataset.id;
}

function submitSync(record: ReportFillRecord, template: ReportFillTemplate): void {
  const datasetId = ensureGeneratedDataset(template);
  const task = createProgressingMockTask({
    taskType: 'report-fill-sync',
    title: `同步填报记录 · #${record.id}`,
    payload: { recordId: record.id, templateId: template.id, datasetId },
    totalItems: 3,
  });
  record.generatedDatasetId = datasetId;
  record.syncTaskId = task.id;
  record.syncStatus = 'succeeded';
  record.syncError = null;
  record.syncedAt = mockDateTime();
}

/** 取消 / 撤回共用：提交人本人、未终结状态且修订号匹配 */
const cancelRecordHandler = (action: 'cancelRecord' | 'withdrawRecord') =>
  mock(reportFillContract[action], ({ params, body, ok }) => {
    const record = mockReportFillRecords.find((item) => item.id === params.id && item.submitterId === DEMO_USER_ID);
    if (!record) return notFound('填报记录不存在', { status: 404 });
    if (!['draft', 'rejected', 'submitted', 'in_review'].includes(record.status)) return conflict('当前状态不允许取消或撤回', { status: 409 });
    const revisionError = assertRevision(record, body.expectedRevision);
    if (revisionError) return revisionError;
    record.status = 'cancelled';
    record.reviewComment = body.reason ?? null;
    record.revision += 1;
    record.updatedAt = mockDateTime();
    return ok(recordView(record), '操作成功');
  });

export const reportFillHandlers = [
  mock(reportFillContract.templateLookup, ({ ok }) =>
    ok(mockReportFillTemplates.filter((item) => item.status === 'published').map(templateView))),

  mock(reportFillContract.templates, ({ query, ok, paginate }) => {
    const list = mockReportFillTemplates.filter((item) =>
      (!query.keyword || item.name.includes(query.keyword) || item.code.includes(query.keyword))
      && (!query.status || item.status === query.status)
      && (!query.ownerId || item.ownerId === query.ownerId)
      && (!query.folderId || item.folderId === query.folderId))
      .map(templateView);
    return ok(paginate(list));
  }),

  mock(reportFillContract.templateDetail, ({ params, ok }) => {
    const template = mockReportFillTemplates.find((item) => item.id === params.id);
    return template ? ok(templateView(template)) : notFound('填报模板不存在', { status: 404 });
  }),

  mock(reportFillContract.createTemplate, ({ body, ok }) => {
    if (mockReportFillTemplates.some((item) => item.code === body.code)) return badRequest('填报模板编码已存在', { status: 400 });
    const now = mockDateTime();
    const template: ReportFillTemplate = {
      id: nextReportP2Id('fill-template', mockReportFillTemplates),
      tenantId: DEMO_TENANT_ID,
      folderId: body.folderId ?? null,
      ownerId: body.ownerId ?? DEMO_USER_ID,
      code: body.code,
      name: body.name,
      description: body.description ?? null,
      formSchema: body.formSchema as WorkflowFormSchema,
      publishedSchema: null,
      publishedRevision: null,
      workflowDefinitionId: body.workflowDefinitionId ?? null,
      needReview: body.needReview,
      generatedDatasetId: null,
      status: 'draft',
      revision: 1,
      publishedAt: null,
      publishedBy: null,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportFillTemplates.push(template);
    return ok(templateView(template), '创建成功');
  }),

  mock(reportFillContract.updateTemplate, ({ params, body, ok }) => {
    const template = mockReportFillTemplates.find((item) => item.id === params.id);
    if (!template) return notFound('填报模板不存在', { status: 404 });
    if (template.status === 'published') return conflict('请先下线模板再编辑', { status: 409 });
    if (body.expectedRevision !== template.revision) return conflict('模板已被其他操作更新', { status: 409 });
    const { expectedRevision: _expectedRevision, ...patch } = body;
    Object.assign(template, patch, {
      revision: template.revision + 1,
      updatedBy: DEMO_USER_ID,
      updatedAt: mockDateTime(),
    });
    return ok(templateView(template), '更新成功');
  }),

  mock(reportFillContract.templateLifecycle, ({ params, body, ok }) => {
    const template = mockReportFillTemplates.find((item) => item.id === params.id);
    if (!template) return notFound('填报模板不存在', { status: 404 });
    if (body.expectedRevision !== template.revision) return conflict('模板修订号不匹配', { status: 409 });
    if (body.action === 'publish' && template.status === 'published') {
      return ok(templateView(template), '操作成功');
    }
    if (body.action === 'offline' && template.status !== 'published') {
      return conflict('仅已发布模板可以下线', { status: 409 });
    }
    template.revision += 1;
    template.updatedAt = mockDateTime();
    if (body.action === 'publish') {
      template.status = 'published';
      template.publishedSchema = JSON.parse(JSON.stringify(template.formSchema)) as WorkflowFormSchema;
      template.publishedRevision = template.revision;
      template.publishedAt = template.updatedAt;
      template.publishedBy = DEMO_USER_ID;
    } else {
      template.status = 'disabled';
    }
    return ok(templateView(template), '操作成功');
  }),

  mock(reportFillContract.cloneTemplate, ({ params, body, ok }) => {
    const source = mockReportFillTemplates.find((item) => item.id === params.id);
    if (!source) return notFound('填报模板不存在', { status: 404 });
    if (mockReportFillTemplates.some((item) => item.code === body.code)) return badRequest('填报模板编码已存在', { status: 400 });
    const now = mockDateTime();
    const copy: ReportFillTemplate = {
      ...source,
      id: nextReportP2Id('fill-template', mockReportFillTemplates),
      code: body.code,
      name: body.name,
      folderId: body.folderId ?? source.folderId,
      status: 'draft',
      revision: 1,
      publishedSchema: null,
      publishedRevision: null,
      publishedAt: null,
      publishedBy: null,
      generatedDatasetId: null,
      createdAt: now,
      updatedAt: now,
    };
    mockReportFillTemplates.push(copy);
    return ok(templateView(copy), '克隆成功');
  }),

  mock(reportFillContract.removeTemplate, ({ params, ok }) => {
    const index = mockReportFillTemplates.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('填报模板不存在', { status: 404 });
    if (mockReportFillTemplates[index].status === 'published') return conflict('请先下线模板再删除', { status: 409 });
    if (mockReportFillRecords.some((item) => item.templateId === params.id)) return conflict('已有填报记录，不能删除模板', { status: 409 });
    mockReportFillTemplates.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(reportFillContract.myRecords, ({ query, ok, paginate }) => {
    const list = mockReportFillRecords.filter((item) =>
      item.submitterId === DEMO_USER_ID
      && (!query.keyword || (item.templateName ?? '').includes(query.keyword))
      && (!query.status || item.status === query.status)
      && (!query.templateId || item.templateId === query.templateId))
      .map(recordView);
    return ok(paginate(list));
  }),

  mock(reportFillContract.adminRecords, ({ query, ok, paginate }) => {
    const list = mockReportFillRecords.filter((item) =>
      (!query.status || item.status === query.status)
      && (!query.templateId || item.templateId === query.templateId)
      && (!query.submitterId || item.submitterId === query.submitterId))
      .map(recordView);
    return ok(paginate(list));
  }),

  mock(reportFillContract.recordDetail, ({ params, ok }) => {
    const record = mockReportFillRecords.find((item) => item.id === params.id);
    if (!record) return notFound('填报记录不存在', { status: 404 });
    return ok(recordView(record));
  }),

  mock(reportFillContract.createRecord, ({ body, ok }) => {
    const template = mockReportFillTemplates.find((item) => item.id === body.templateId);
    if (!template) return notFound('填报模板不存在', { status: 404 });
    if (template.status !== 'published' || !template.publishedSchema || !template.publishedRevision) {
      return conflict('填报模板未发布或发布快照无效', { status: 409 });
    }
    const now = mockDateTime();
    const record: ReportFillRecord = {
      id: nextReportP2Id('fill-record', mockReportFillRecords),
      tenantId: DEMO_TENANT_ID,
      templateId: template.id,
      templateName: template.name,
      submitterId: DEMO_USER_ID,
      submitterName: DEMO_USER_NAME,
      status: 'draft',
      data: body.data,
      templateRevision: template.publishedRevision,
      templateSchemaSnapshot: JSON.parse(JSON.stringify(template.publishedSchema)) as WorkflowFormSchema,
      templateNeedReview: template.needReview,
      workflowDefinitionIdSnapshot: template.workflowDefinitionId ?? null,
      submitComment: null,
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      reviewComment: null,
      workflowInstanceId: null,
      generatedDatasetId: template.generatedDatasetId ?? null,
      syncStatus: 'pending',
      syncTaskId: null,
      syncError: null,
      syncedAt: null,
      revision: 1,
      createdBy: DEMO_USER_ID,
      updatedBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    mockReportFillRecords.unshift(record);
    return ok(recordView(record), '创建成功');
  }),

  mock(reportFillContract.updateRecord, ({ params, body, ok }) => {
    const record = mockReportFillRecords.find((item) => item.id === params.id && item.submitterId === DEMO_USER_ID);
    if (!record) return notFound('填报记录不存在', { status: 404 });
    if (!['draft', 'rejected'].includes(record.status)) return conflict('当前状态不允许编辑', { status: 409 });
    const revisionError = assertRevision(record, body.expectedRevision);
    if (revisionError) return revisionError;
    record.data = body.data;
    record.revision += 1;
    record.status = 'draft';
    record.updatedBy = DEMO_USER_ID;
    record.updatedAt = mockDateTime();
    return ok(recordView(record), '更新成功');
  }),

  mock(reportFillContract.submitRecord, ({ params, body, ok }) => {
    const record = mockReportFillRecords.find((item) => item.id === params.id && item.submitterId === DEMO_USER_ID);
    if (!record) return notFound('填报记录不存在', { status: 404 });
    if (!['draft', 'rejected'].includes(record.status)) return conflict('当前状态不允许提交', { status: 409 });
    const revisionError = assertRevision(record, body.expectedRevision);
    if (revisionError) return revisionError;
    const validationError = validateRequired(record.templateSchemaSnapshot, record.data);
    if (validationError) return badRequest(validationError, { status: 400 });
    const template = mockReportFillTemplates.find((item) => item.id === record.templateId);
    if (!template) return notFound('填报模板不存在', { status: 404 });
    const now = mockDateTime();
    record.status = record.templateNeedReview ? 'submitted' : 'approved';
    record.submittedAt = now;
    record.submitComment = body.comment ?? null;
    record.reviewedAt = record.templateNeedReview ? null : now;
    record.reviewedBy = record.templateNeedReview ? null : DEMO_USER_ID;
    record.revision += 1;
    record.updatedAt = now;
    if (record.workflowDefinitionIdSnapshot) {
      record.status = 'in_review';
      record.workflowInstanceId = 10_000 + record.id;
    }
    if (record.status === 'approved') submitSync(record, template);
    return ok(recordView(record), '提交成功');
  }),

  mock(reportFillContract.reviewRecord, ({ params, body, ok }) => {
    const record = mockReportFillRecords.find((item) => item.id === params.id);
    if (!record) return notFound('填报记录不存在', { status: 404 });
    if (!['submitted', 'in_review'].includes(record.status)) return conflict('当前状态不允许审核', { status: 409 });
    if (record.workflowDefinitionIdSnapshot || record.workflowInstanceId) return conflict('该记录必须通过绑定的工作流审批', { status: 409 });
    const revisionError = assertRevision(record, body.expectedRevision);
    if (revisionError) return revisionError;
    const template = mockReportFillTemplates.find((item) => item.id === record.templateId);
    if (!template) return notFound('填报模板不存在', { status: 404 });
    record.status = body.decision;
    record.reviewedAt = mockDateTime();
    record.reviewedBy = DEMO_USER_ID;
    record.reviewComment = body.comment ?? null;
    record.revision += 1;
    record.updatedAt = record.reviewedAt;
    if (record.status === 'approved') submitSync(record, template);
    return ok(recordView(record), '审核成功');
  }),

  cancelRecordHandler('cancelRecord'),
  cancelRecordHandler('withdrawRecord'),
];
