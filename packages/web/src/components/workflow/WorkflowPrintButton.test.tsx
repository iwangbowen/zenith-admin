/**
 * 审批单打印入口：二进制通道的 URL / 文件名解析、错误信封透出；按钮 → 预览弹窗 → 下载 / 打印动作。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchRaw: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('@/utils/request', () => ({ request: { fetchRaw: mocks.fetchRaw } }));
vi.mock('@/utils/download', () => ({ downloadBlob: mocks.downloadBlob }));
// embedpdf 引擎（wasm）不在 jsdom 中运行：替换为渲染文件名与动作槽的轻量面板
vi.mock('@/components/PDFPreviewPanel', () => ({
  PDFPreviewPanel: ({ file, actions }: { file: File; actions?: React.ReactNode }) => (
    <div data-testid="pdf-panel">
      <span>{file.name}</span>
      {actions}
    </div>
  ),
}));

import { fetchWorkflowInstancePrintPdf } from '@/hooks/queries/workflow-instances';
import WorkflowPrintButton from './WorkflowPrintButton';

function pdfResponse(filename: string) {
  return new Response(new Blob(['%PDF-1.4 demo'], { type: 'application/pdf' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

beforeEach(() => {
  mocks.fetchRaw.mockReset();
  mocks.downloadBlob.mockReset();
});

describe('fetchWorkflowInstancePrintPdf', () => {
  it('按契约路径请求 PDF，可选 templateId 进查询串，文件名取自 Content-Disposition', async () => {
    mocks.fetchRaw.mockResolvedValue(pdfResponse('QJ-0007.pdf'));
    const result = await fetchWorkflowInstancePrintPdf(7, 3);
    expect(mocks.fetchRaw).toHaveBeenCalledWith('/api/workflows/instances/7/print?templateId=3');
    expect(result.filename).toBe('QJ-0007.pdf');
    expect(result.blob.type).toBe('application/pdf');

    mocks.fetchRaw.mockResolvedValue(pdfResponse('x.pdf'));
    await fetchWorkflowInstancePrintPdf(8);
    expect(mocks.fetchRaw).toHaveBeenLastCalledWith('/api/workflows/instances/8/print');
  });

  it('非 2xx 时透出服务端信封 message；网络失败给通用文案', async () => {
    mocks.fetchRaw.mockResolvedValue(new Response(JSON.stringify({ code: 403, message: '无权查看' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    await expect(fetchWorkflowInstancePrintPdf(7)).rejects.toThrow('无权查看');
    mocks.fetchRaw.mockResolvedValue(null);
    await expect(fetchWorkflowInstancePrintPdf(7)).rejects.toThrow('审批单生成失败');
  });
});

describe('WorkflowPrintButton', () => {
  it('点击后拉取 PDF 并打开预览，下载动作把同一份文件交给 downloadBlob', async () => {
    mocks.fetchRaw.mockResolvedValue(pdfResponse('审批单-7.pdf'));
    render(<WorkflowPrintButton instanceId={7} />);
    fireEvent.click(screen.getByRole('button', { name: /打印/ }));
    await waitFor(() => expect(screen.getByTestId('pdf-panel')).toBeInTheDocument());
    expect(screen.getByText('审批单-7.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /下载 PDF/ }));
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(1);
    expect(mocks.downloadBlob.mock.calls[0][1]).toBe('审批单-7.pdf');
  });

  it('生成失败时不打开预览', async () => {
    mocks.fetchRaw.mockResolvedValue(new Response(JSON.stringify({ code: 400, message: '模板未设计' }), { status: 400 }));
    render(<WorkflowPrintButton instanceId={7} />);
    fireEvent.click(screen.getByRole('button', { name: /打印/ }));
    await waitFor(() => expect(mocks.fetchRaw).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('pdf-panel')).not.toBeInTheDocument();
  });
});
