/**
 * 审批单 PDF 服务：mock 数据访问，验证「详情 → 数据集 → 版式（绑定模板 / 自动生成）→ pdfkit」全链路真实产出 PDF，
 * 以及模板选择优先级（请求指定 > 流程绑定 > 自动生成）与文件名。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowInstance } from '@zenith/shared/workflow';

const mocks = vi.hoisted(() => ({
  getInstanceDetail: vi.fn(),
  loadEntityPrintTemplate: vi.fn(),
  listDictItemsByCode: vi.fn(),
  loadWorkflowUserDisplays: vi.fn(),
  resolveMaskDecisions: vi.fn(),
  definitionRow: { printTemplateId: null as number | null, flowData: null as unknown },
  findFirstUser: vi.fn(),
}));

vi.mock('./instances/queries', () => ({ getInstanceDetail: mocks.getInstanceDetail }));
vi.mock('../report/report-print.service', () => ({ loadEntityPrintTemplate: mocks.loadEntityPrintTemplate }));
vi.mock('../platform/dicts.service', () => ({ listDictItemsByCode: mocks.listDictItemsByCode }));
vi.mock('./workflow-user-helpers', () => ({ loadWorkflowUserDisplays: mocks.loadWorkflowUserDisplays }));
vi.mock('../../lib/data-mask/policies', () => ({ resolveMaskDecisions: mocks.resolveMaskDecisions }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 9, username: 'printer', roles: [], tenantId: null }) }));
vi.mock('../../db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([mocks.definitionRow]) })),
      })),
    })),
    query: { users: { findFirst: mocks.findFirstUser } },
  },
}));

import { renderWorkflowInstancePdf } from './workflow-print.service';

const instance: WorkflowInstance = {
  id: 42,
  definitionId: 3,
  definitionName: '报销申请',
  title: '张三的报销申请',
  serialNo: 'BX/2026-0042',
  formData: { amount: 1280.5, reason: '客户拜访差旅', phone: '13812345678', sign: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' },
  formSnapshot: {
    formType: 'designer', formId: 1, formName: '报销单', settings: null, customForm: null,
    fields: [
      { key: 'amount', label: '报销金额', type: 'amount', unit: '元', columnSpan: 12 },
      { key: 'reason', label: '事由', type: 'textarea' },
      { key: 'phone', label: '联系电话', type: 'phone' },
      { key: 'sign', label: '申请人签名', type: 'signature' },
    ],
  },
  status: 'approved',
  currentNodeKey: null,
  initiatorId: 1,
  initiatorName: '张三',
  tenantId: null,
  tasks: [
    { id: 1, instanceId: 42, nodeKey: 'n1', nodeName: '部门经理', nodeType: 'approve', assigneeId: 2, assigneeName: '李四', status: 'approved', comment: '同意报销', actionAt: '2026-09-11 10:00:00', createdAt: '2026-09-11 09:00:00' },
  ],
  comments: [],
  createdAt: '2026-09-11 09:00:00',
  updatedAt: '2026-09-11 10:00:00',
};

beforeEach(() => {
  mocks.getInstanceDetail.mockReset().mockResolvedValue(instance);
  mocks.loadEntityPrintTemplate.mockReset();
  mocks.listDictItemsByCode.mockReset().mockResolvedValue([]);
  mocks.loadWorkflowUserDisplays.mockReset().mockImplementation(async (ids: number[]) => new Map(ids.map((id) => [id, { name: id === 9 ? '打印员' : `用户${id}`, avatar: null }])));
  mocks.findFirstUser.mockReset().mockResolvedValue({ id: 1, department: { name: '销售部' } });
  mocks.resolveMaskDecisions.mockReset().mockResolvedValue([]);
  mocks.definitionRow.printTemplateId = null;
  mocks.definitionRow.flowData = null;
});

/** 从 PDF 字节里抽取文本流不可行（字形子集化），改为断言渲染入口收到的内容：拦截 renderPrintResultToPdf */
async function captureRender() {
  const exportLib = await import('../../lib/report-print-export');
  const spy = vi.spyOn(exportLib, 'renderPrintResultToPdf');
  return spy;
}

describe('renderWorkflowInstancePdf', () => {
  it('无绑定模板时按表单快照自动生成版式并产出真实 PDF（含中文与签名图片）', async () => {
    const { buffer, filename } = await renderWorkflowInstancePdf(42);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(2000);
    expect(filename).toBe('BX_2026-0042.pdf');
    expect(mocks.loadEntityPrintTemplate).not.toHaveBeenCalled();
    expect(mocks.getInstanceDetail).toHaveBeenCalledWith(42);
  });

  it('流程绑定了实体模板时用模板渲染；请求 templateId 优先于流程绑定', async () => {
    mocks.definitionRow.printTemplateId = 7;
    mocks.loadEntityPrintTemplate.mockResolvedValue({
      id: 7, name: '报销专用单', sourceType: 'entity', entityKind: 'workflow_instance', status: 'enabled', tenantId: null,
      pageConfig: { paper: 'A5' },
      content: {
        entityDatasets: ['instance', 'form'],
        sheets: [{ id: 's', name: '单', grid: { rows: 2, cols: 2, cells: [
          { row: 0, col: 0, v: '${printTitle}' },
          { row: 1, col: 0, v: '金额' }, { row: 1, col: 1, v: '${amount}', datasetKey: 'form' },
        ] } }],
      },
    });
    const bound = await renderWorkflowInstancePdf(42);
    expect(bound.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mocks.loadEntityPrintTemplate).toHaveBeenCalledWith(7, { entityKind: 'workflow_instance', tenantId: null });

    mocks.loadEntityPrintTemplate.mockClear();
    await renderWorkflowInstancePdf(42, { templateId: 11 });
    expect(mocks.loadEntityPrintTemplate).toHaveBeenCalledWith(11, { entityKind: 'workflow_instance', tenantId: null });
  });

  it('模板未设计网格时报 400', async () => {
    mocks.definitionRow.printTemplateId = 8;
    mocks.loadEntityPrintTemplate.mockResolvedValue({ id: 8, name: '空模板', content: {}, pageConfig: {} });
    await expect(renderWorkflowInstancePdf(42)).rejects.toMatchObject({ status: 400 });
  });

  it('无业务编号时文件名回退为标题 + 实例 ID，并清洗非法字符', async () => {
    mocks.getInstanceDetail.mockResolvedValue({ ...instance, serialNo: null, title: '合同/盖章:申请' });
    const { filename } = await renderWorkflowInstancePdf(42);
    expect(filename).toBe('合同_盖章_申请-42.pdf');
  });

  it('流程设置「仅通过后可打印」时，非 approved 实例返回 400', async () => {
    mocks.definitionRow.flowData = { nodes: [], edges: [], settings: { print: { onlyWhenApproved: true } } };
    mocks.getInstanceDetail.mockResolvedValue({ ...instance, status: 'running' });
    await expect(renderWorkflowInstancePdf(42)).rejects.toMatchObject({ status: 400 });
    mocks.getInstanceDetail.mockResolvedValue(instance);
    await expect(renderWorkflowInstancePdf(42)).resolves.toBeTruthy();
  });

  it('水印开关：按模板替换 {printer} / {time} / {serialNo}，关闭时不传水印', async () => {
    const spy = await captureRender();
    mocks.definitionRow.flowData = { nodes: [], edges: [], settings: { print: { watermark: true, watermarkText: '{serialNo} 由 {printer} 打印' } } };
    await renderWorkflowInstancePdf(42);
    expect(spy).toHaveBeenLastCalledWith(expect.anything(), { watermark: 'BX/2026-0042 由 打印员 打印' });

    mocks.definitionRow.flowData = { nodes: [], edges: [], settings: { print: { watermark: true } } };
    await renderWorkflowInstancePdf(42);
    const [, options] = spy.mock.lastCall!;
    expect(options?.watermark).toMatch(/^打印员 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    mocks.definitionRow.flowData = null;
    await renderWorkflowInstancePdf(42);
    expect(spy.mock.lastCall![1]).toEqual({ watermark: undefined });
    spy.mockRestore();
  });

  it('表单 PII 字段按查看者的脱敏决策打码；豁免 / 超管（无决策）原样输出', async () => {
    const spy = await captureRender();
    mocks.resolveMaskDecisions.mockResolvedValue([
      { ref: { path: ['formData', 'phone'], entity: 'WorkflowForm', field: 'phone', kind: 'phone', label: '审批表单·手机号' }, decision: { maskType: 'phone', customRule: null } },
    ]);
    await renderWorkflowInstancePdf(42);
    const masked = spy.mock.lastCall![0];
    const values = masked.grid.cells.map((c) => String(c.v ?? ''));
    expect(values).toContain('138****5678');
    expect(values).not.toContain('13812345678');

    mocks.resolveMaskDecisions.mockResolvedValue([]);
    await renderWorkflowInstancePdf(42);
    expect(spy.mock.lastCall![0].grid.cells.map((c) => c.v)).toContain('13812345678');
    spy.mockRestore();
  });
});
