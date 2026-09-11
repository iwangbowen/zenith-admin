/**
 * 审批单归档 / 来源选择 / 批量合并 / 验真令牌：mock 文件与队列边界，验证
 * - source 选择：auto 优先归档件、脱敏查看者回退实时、archive 显式请求的 404 / 403、live 强制重渲
 * - 归档件 SHA-256 校验
 * - 归档作业的幂等跳过条件与成功落库
 * - 终态事件 → 队列投递（仅开启自动归档的流程）
 * - 验真令牌签发 / 解码与公开视图字段
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowInstance } from '@zenith/shared/workflow';

const mocks = vi.hoisted(() => ({
  getInstanceDetail: vi.fn(),
  loadEntityPrintTemplate: vi.fn(),
  listDictItemsByCode: vi.fn(),
  loadWorkflowUserDisplays: vi.fn(),
  resolveMaskDecisions: vi.fn(),
  runWithCurrentUser: vi.fn(),
  getRestrictedFileForRead: vi.fn(),
  saveGeneratedManagedFile: vi.fn(),
  readStoredFile: vi.fn(),
  retainManagedFiles: vi.fn(),
  registerSystemQueueWorker: vi.fn(),
  sendSystemJob: vi.fn(),
  eventHandlers: new Map<string, (event: unknown) => Promise<void> | void>(),
  /** db.select().from().where().limit() 依次返回的行（队列耗尽后回落 definitionRow） */
  selectQueue: [] as unknown[][],
  definitionRow: { printTemplateId: null as number | null, flowData: null as unknown },
  updateReturning: vi.fn(),
  findFirstUser: vi.fn(),
  findFirstInstance: vi.fn(),
}));

vi.mock('./instances/queries', () => ({ getInstanceDetail: mocks.getInstanceDetail }));
vi.mock('../report/report-print.service', () => ({ loadEntityPrintTemplate: mocks.loadEntityPrintTemplate }));
vi.mock('../platform/dicts.service', () => ({ listDictItemsByCode: mocks.listDictItemsByCode }));
vi.mock('./workflow-user-helpers', () => ({ loadWorkflowUserDisplays: mocks.loadWorkflowUserDisplays }));
vi.mock('../../lib/data-mask/policies', () => ({ resolveMaskDecisions: mocks.resolveMaskDecisions }));
vi.mock('../../lib/context', () => ({
  currentUser: () => ({ userId: 9, username: 'printer', roles: [], tenantId: null }),
  runWithCurrentUser: mocks.runWithCurrentUser,
}));
vi.mock('../files/files.service', () => ({
  getRestrictedFileForRead: mocks.getRestrictedFileForRead,
  saveGeneratedManagedFile: mocks.saveGeneratedManagedFile,
}));
vi.mock('../../lib/file-storage', () => ({ readStoredFile: mocks.readStoredFile }));
vi.mock('../files/file-gc.service', () => ({ retainManagedFiles: mocks.retainManagedFiles }));
vi.mock('../../lib/pg-boss-scheduler', () => ({
  registerSystemQueueWorker: mocks.registerSystemQueueWorker,
  sendSystemJob: mocks.sendSystemJob,
}));
vi.mock('../../lib/workflow-event-bus', () => ({
  workflowEventBus: { on: (type: string, handler: (event: unknown) => Promise<void> | void) => mocks.eventHandlers.set(type, handler) },
}));
vi.mock('../../db', () => {
  const limit = vi.fn(async () => mocks.selectQueue.shift() ?? [mocks.definitionRow]);
  const tx = {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: mocks.updateReturning })) })) })),
  };
  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })),
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
      query: {
        users: { findFirst: mocks.findFirstUser },
        workflowInstances: { findFirst: mocks.findFirstInstance },
      },
    },
  };
});

import {
  archiveWorkflowInstancePrint,
  createPrintVerifyToken,
  decodePrintVerifyToken,
  loadPrintVerifyView,
  printVerifyUrl,
  renderWorkflowInstancePdf,
  renderWorkflowInstancesBatchPdf,
} from './workflow-print.service';
import { registerWorkflowPrintArchiveSubscriber, registerWorkflowPrintArchiveWorker } from './workflow-print-archive';

const ARCHIVE_PDF = Buffer.from('%PDF-1.7 archived bytes');
const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE_PDF).digest('hex');

const baseInstance: WorkflowInstance = {
  id: 42,
  definitionId: 3,
  definitionName: '报销申请',
  title: '张三的报销申请',
  serialNo: 'BX/2026-0042',
  formData: { amount: 1280.5, phone: '13812345678' },
  formSnapshot: {
    formType: 'designer', formId: 1, formName: '报销单', settings: null, customForm: null,
    fields: [
      { key: 'amount', label: '报销金额', type: 'amount', unit: '元' },
      { key: 'phone', label: '联系电话', type: 'phone' },
    ],
  },
  status: 'approved',
  currentNodeKey: null,
  initiatorId: 1,
  initiatorName: '张三',
  tenantId: null,
  tasks: [],
  comments: [],
  createdAt: '2026-09-11 09:00:00',
  updatedAt: '2026-09-11 10:00:00',
};

const archivedInstance: WorkflowInstance = {
  ...baseInstance,
  archive: { fileId: 'file-1', sha256: ARCHIVE_SHA, templateId: null, archivedAt: '2026-09-11 10:00:05' },
};

function storedStream(bytes: Buffer) {
  return { stream: new Blob([bytes]).stream(), contentType: 'application/pdf' };
}

beforeEach(() => {
  mocks.getInstanceDetail.mockReset().mockResolvedValue(baseInstance);
  mocks.loadEntityPrintTemplate.mockReset();
  mocks.listDictItemsByCode.mockReset().mockResolvedValue([]);
  mocks.loadWorkflowUserDisplays.mockReset().mockImplementation(async (ids: number[]) => new Map(ids.map((id) => [id, { name: `用户${id}`, avatar: null }])));
  mocks.resolveMaskDecisions.mockReset().mockResolvedValue([]);
  mocks.runWithCurrentUser.mockReset().mockImplementation(async (_user: unknown, fn: () => Promise<unknown>) => fn());
  mocks.getRestrictedFileForRead.mockReset().mockResolvedValue({ file: { id: 'file-1' }, storageConfig: null });
  mocks.readStoredFile.mockReset().mockResolvedValue(storedStream(ARCHIVE_PDF));
  mocks.saveGeneratedManagedFile.mockReset().mockResolvedValue({ id: 'file-new' });
  mocks.retainManagedFiles.mockReset().mockResolvedValue(undefined);
  mocks.registerSystemQueueWorker.mockReset();
  mocks.sendSystemJob.mockReset().mockResolvedValue('job-1');
  mocks.eventHandlers.clear();
  mocks.selectQueue.length = 0;
  mocks.definitionRow.printTemplateId = null;
  mocks.definitionRow.flowData = null;
  mocks.updateReturning.mockReset().mockResolvedValue([{ id: 42 }]);
  mocks.findFirstUser.mockReset().mockResolvedValue({ id: 1, department: { name: '销售部' } });
  mocks.findFirstInstance.mockReset();
});

describe('renderWorkflowInstancePdf · 来源选择', () => {
  it('auto：有归档件且查看者无脱敏字段时直接返回归档原件（不重渲）', async () => {
    mocks.getInstanceDetail.mockResolvedValue(archivedInstance);
    const result = await renderWorkflowInstancePdf(42);
    expect(result.source).toBe('archive');
    expect(result.buffer.equals(ARCHIVE_PDF)).toBe(true);
    expect(result.filename).toBe('BX_2026-0042.pdf');
    expect(mocks.getRestrictedFileForRead).toHaveBeenCalledWith('file-1');
  });

  it('归档件校验值不匹配时报 500，不静默下发可疑文件', async () => {
    mocks.getInstanceDetail.mockResolvedValue(archivedInstance);
    mocks.readStoredFile.mockResolvedValue(storedStream(Buffer.from('%PDF-1.7 tampered')));
    await expect(renderWorkflowInstancePdf(42)).rejects.toMatchObject({ status: 500 });
  });

  it('查看者对表单存在脱敏字段：auto 回退实时打码渲染，显式 archive 拒绝 403', async () => {
    mocks.getInstanceDetail.mockResolvedValue(archivedInstance);
    mocks.resolveMaskDecisions.mockResolvedValue([{ ref: { field: 'phone' }, decision: { maskType: 'phone' } }]);
    const live = await renderWorkflowInstancePdf(42);
    expect(live.source).toBe('live');
    expect(live.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mocks.getRestrictedFileForRead).not.toHaveBeenCalled();
    await expect(renderWorkflowInstancePdf(42, { source: 'archive' })).rejects.toMatchObject({ status: 403 });
  });

  it('脱敏决策命中的字段类型不在表单里时不影响归档件下发', async () => {
    mocks.getInstanceDetail.mockResolvedValue(archivedInstance);
    mocks.resolveMaskDecisions.mockResolvedValue([{ ref: { field: 'idCard' }, decision: { maskType: 'id_card' } }]);
    expect((await renderWorkflowInstancePdf(42)).source).toBe('archive');
  });

  it('显式 archive 但尚未归档时 404', async () => {
    await expect(renderWorkflowInstancePdf(42, { source: 'archive' })).rejects.toMatchObject({ status: 404 });
  });

  it('live 或临时指定模板时忽略归档件、实时渲染', async () => {
    mocks.getInstanceDetail.mockResolvedValue(archivedInstance);
    expect((await renderWorkflowInstancePdf(42, { source: 'live' })).source).toBe('live');
    mocks.loadEntityPrintTemplate.mockResolvedValue({
      id: 11, name: '专用单', content: { sheets: [{ id: 's', name: '单', grid: { rows: 1, cols: 1, cells: [{ row: 0, col: 0, v: '${printTitle}' }] } }] }, pageConfig: {},
    });
    expect((await renderWorkflowInstancePdf(42, { templateId: 11 })).source).toBe('live');
    expect(mocks.getRestrictedFileForRead).not.toHaveBeenCalled();
  });
});

describe('renderWorkflowInstancesBatchPdf', () => {
  it('多份审批单合并为一个 PDF，页数累加', async () => {
    const { buffer, count } = await renderWorkflowInstancesBatchPdf([42, 42, 42]);
    expect(count).toBe(3);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const pageObjects = buffer.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? [];
    expect(pageObjects.length).toBeGreaterThanOrEqual(3);
    expect(mocks.getInstanceDetail).toHaveBeenCalledTimes(3);
  });
});

describe('archiveWorkflowInstancePrint', () => {
  const row = { id: 42, initiatorId: 1, tenantId: null, status: 'approved', archiveFileId: null as string | null, definitionId: 3 };

  it('实例不存在 / 已归档 / 非终态 / 未开启自动归档 时幂等跳过', async () => {
    mocks.selectQueue.push([]);
    expect(await archiveWorkflowInstancePrint(42)).toMatchObject({ archived: false, reason: '实例不存在' });

    mocks.selectQueue.push([{ ...row, archiveFileId: 'file-1' }]);
    expect(await archiveWorkflowInstancePrint(42)).toMatchObject({ archived: false, reason: '已归档' });

    mocks.selectQueue.push([{ ...row, status: 'running' }]);
    expect((await archiveWorkflowInstancePrint(42)).reason).toContain('不归档');

    mocks.selectQueue.push([row]);
    mocks.definitionRow.flowData = { settings: { print: { autoArchive: false } } };
    expect(await archiveWorkflowInstancePrint(42)).toMatchObject({ archived: false, reason: '流程未开启自动归档' });
    expect(mocks.saveGeneratedManagedFile).not.toHaveBeenCalled();
  });

  it('开启自动归档：以超管身份渲染、落受限托管文件、记录 SHA-256 并保留文件', async () => {
    mocks.selectQueue.push([row]);
    mocks.definitionRow.flowData = { settings: { print: { autoArchive: true, watermark: true, onlyWhenApproved: true } } };
    const outcome = await archiveWorkflowInstancePrint(42);
    expect(outcome).toEqual({ archived: true });

    const [actor] = mocks.runWithCurrentUser.mock.calls[0] as [{ userId: number; roles: string[]; tenantId: number | null }];
    expect(actor).toMatchObject({ userId: 1, roles: ['super_admin'], tenantId: null });

    const saved = mocks.saveGeneratedManagedFile.mock.calls[0][0] as { buffer: Buffer; mimeType: string; visibility: string; createdBy: number };
    expect(saved.mimeType).toBe('application/pdf');
    expect(saved.visibility).toBe('restricted');
    expect(saved.createdBy).toBe(1);
    expect(saved.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mocks.retainManagedFiles).toHaveBeenCalledWith(expect.anything(), ['file-new']);
  });

  it('并发重复归档：条件更新未命中时不保留第二份文件（交给 GC）', async () => {
    mocks.selectQueue.push([row]);
    mocks.definitionRow.flowData = { settings: { print: { autoArchive: true } } };
    mocks.updateReturning.mockResolvedValue([]);
    await archiveWorkflowInstancePrint(42);
    expect(mocks.retainManagedFiles).not.toHaveBeenCalled();
  });
});

describe('registerWorkflowPrintArchiveSubscriber / Worker', () => {
  it('worker 只声明队列元数据，处理器按需加载渲染模块后执行归档', async () => {
    await registerWorkflowPrintArchiveWorker();
    expect(mocks.registerSystemQueueWorker).toHaveBeenCalledTimes(1);
    const spec = mocks.registerSystemQueueWorker.mock.calls[0][0] as { name: string; handler: (job: { instanceId: number }) => Promise<string> };
    expect(spec.name).toBe('workflow-print-archive');
    mocks.selectQueue.push([]);
    expect(await spec.handler({ instanceId: 404 })).toContain('跳过：实例不存在');
  });

  it('通过 / 驳回终态事件按流程设置投递归档作业（singletonKey 去重）', async () => {
    registerWorkflowPrintArchiveSubscriber();
    expect([...mocks.eventHandlers.keys()].sort()).toEqual(['instance.approved', 'instance.rejected']);

    mocks.definitionRow.flowData = { settings: { print: { autoArchive: true } } };
    await mocks.eventHandlers.get('instance.approved')!({ type: 'instance.approved', instance: { id: 42, definitionId: 3 } });
    expect(mocks.sendSystemJob).toHaveBeenCalledWith('workflow-print-archive', { instanceId: 42 }, expect.objectContaining({ singletonKey: 'archive:42' }));

    mocks.sendSystemJob.mockClear();
    mocks.definitionRow.flowData = null;
    await mocks.eventHandlers.get('instance.rejected')!({ type: 'instance.rejected', instance: { id: 43, definitionId: 3 } });
    expect(mocks.sendSystemJob).not.toHaveBeenCalled();
  });
});

describe('验真令牌与公开视图', () => {
  it('令牌可往返解码，篡改后无效', () => {
    const token = createPrintVerifyToken(42);
    expect(decodePrintVerifyToken(token)).toMatchObject({ i: 42 });
    expect(decodePrintVerifyToken(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(decodePrintVerifyToken('garbage')).toBeNull();
    expect(printVerifyUrl(42)).toMatch(/\/api\/workflows\/print-verify\/[^/]+$/);
  });

  it('公开视图只含单据身份与终态事实', async () => {
    mocks.findFirstInstance.mockResolvedValue({
      id: 42, title: '张三的报销申请', serialNo: 'BX/2026-0042', status: 'approved',
      createdAt: new Date('2026-09-11T01:00:00Z'), updatedAt: new Date('2026-09-11T02:00:00Z'),
      archiveSha256: ARCHIVE_SHA, archivedAt: new Date('2026-09-11T02:00:05Z'),
      definition: { name: '报销申请' },
    });
    const view = await loadPrintVerifyView(createPrintVerifyToken(42));
    expect(view).toMatchObject({ valid: true, title: '张三的报销申请', serialNo: 'BX/2026-0042', definitionName: '报销申请', statusText: '已通过' });
    expect(view.finishedAt).toBeTruthy();
    expect(view.archive?.sha256).toBe(ARCHIVE_SHA);
    expect(Object.keys(view)).not.toContain('formData');

    expect(await loadPrintVerifyView('bad-token')).toEqual({ valid: false });
    mocks.findFirstInstance.mockResolvedValue(undefined);
    expect(await loadPrintVerifyView(createPrintVerifyToken(999))).toEqual({ valid: false });
  });
});
