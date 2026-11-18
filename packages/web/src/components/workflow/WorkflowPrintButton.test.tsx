import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetchRaw: vi.fn() }));
vi.mock('@/utils/request', () => ({ request: { fetchRaw: mocks.fetchRaw } }));
import { fetchWorkflowInstancePrintPdf } from '@/hooks/queries/workflow-instances';

function pdfResponse(filename: string, source?: 'archive' | 'live') {
  return new Response(new Blob(['%PDF-1.4 demo'], { type: 'application/pdf' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      ...(source ? { 'X-Zenith-Print-Source': source } : {}),
    },
  });
}

beforeEach(() => {
  mocks.fetchRaw.mockReset();

});

describe('fetchWorkflowInstancePrintPdf', () => {
  it('按契约路径请求 PDF，可选 templateId / source 进查询串，文件名与来源取自响应头', async () => {
    mocks.fetchRaw.mockResolvedValue(pdfResponse('QJ-0007.pdf', 'archive'));
    const result = await fetchWorkflowInstancePrintPdf(7, { templateId: 3 });
    expect(mocks.fetchRaw).toHaveBeenCalledWith('/api/workflows/instances/7/print?templateId=3');
    expect(result.filename).toBe('QJ-0007.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(result.source).toBe('archive');

    mocks.fetchRaw.mockResolvedValue(pdfResponse('x.pdf'));
    const live = await fetchWorkflowInstancePrintPdf(8);
    expect(mocks.fetchRaw).toHaveBeenLastCalledWith('/api/workflows/instances/8/print');
    expect(live.source).toBe('live');

    mocks.fetchRaw.mockResolvedValue(pdfResponse('x.pdf'));
    await fetchWorkflowInstancePrintPdf(8, { source: 'live' });
    expect(mocks.fetchRaw).toHaveBeenLastCalledWith('/api/workflows/instances/8/print?source=live');
  });

  it('非 2xx 时透出服务端信封 message；网络失败给通用文案', async () => {
    mocks.fetchRaw.mockResolvedValue(new Response(JSON.stringify({ code: 403, message: '无权查看' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    await expect(fetchWorkflowInstancePrintPdf(7)).rejects.toThrow('无权查看');
    mocks.fetchRaw.mockResolvedValue(null);
    await expect(fetchWorkflowInstancePrintPdf(7)).rejects.toThrow('审批单生成失败');
  });
});
