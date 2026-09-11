/**
 * 审批单打印入口：拉取服务端生成的 PDF → 应用内预览（embedpdf）→ 浏览器打印 / 下载同一份文件。
 * 详情面板 / 我的申请 / 待办 / 已办 / 流程监控共用；PDF 引擎按需懒加载，不进入首屏。
 */
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button, Modal, Spin, Tag, Toast, Tooltip } from '@douyinfe/semi-ui';
import { Download, Printer, RefreshCw, ShieldCheck } from 'lucide-react';
import { fetchWorkflowInstancePrintPdf, type WorkflowInstancePrintPdf } from '@/hooks/queries/workflow-instances';
import { downloadBlob } from '@/utils/download';

const PDFPreviewPanel = lazy(() =>
  import('@/components/PDFPreviewPanel').then((m) => ({ default: m.PDFPreviewPanel })),
);

/** 隐藏 iframe 承载 PDF 触发浏览器打印对话框；afterprint 后回收，避免残留节点与 objectURL */
function printPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  const cleanup = () => {
    iframe.remove();
    URL.revokeObjectURL(url);
  };
  iframe.onload = () => {
    const cw = iframe.contentWindow;
    if (!cw) { cleanup(); return; }
    cw.addEventListener('afterprint', cleanup, { once: true });
    // 部分浏览器不触发 afterprint（取消对话框），兜底延时回收
    setTimeout(cleanup, 60_000);
    cw.focus();
    cw.print();
  };
  iframe.src = url;
  document.body.appendChild(iframe);
}

interface WorkflowPrintButtonProps {
  readonly instanceId: number;
  /** 临时指定打印模板（设计器预览用）；缺省按流程绑定 / 自动版式 */
  readonly templateId?: number;
  readonly size?: 'small' | 'default';
  readonly theme?: 'borderless' | 'light' | 'solid';
  readonly children?: ReactNode;
}

export default function WorkflowPrintButton({ instanceId, templateId, size = 'small', theme = 'borderless', children }: WorkflowPrintButtonProps) {
  const [loading, setLoading] = useState(false);
  const [pdf, setPdf] = useState<WorkflowInstancePrintPdf | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // embedpdf 按 file 引用重新加载文档：同一份 PDF 只构造一次 File，避免每次渲染重开文档
  const file = useMemo(() => (pdf ? new File([pdf.blob], pdf.filename, { type: 'application/pdf' }) : null), [pdf]);

  const open = useCallback(async (source?: 'live') => {
    setLoading(true);
    try {
      setPdf(await fetchWorkflowInstancePrintPdf(instanceId, { templateId, source }));
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '审批单生成失败');
    } finally {
      setLoading(false);
    }
  }, [instanceId, templateId]);

  const close = useCallback(() => {
    setPdf(null);
    setFullscreen(false);
  }, []);

  return (
    <>
      <Button theme={theme} size={size} icon={<Printer size={14} />} loading={loading} onClick={() => void open()}>
        {children ?? '打印'}
      </Button>
      {pdf && file ? (
        <Modal
          visible
          onCancel={close}
          title={null}
          footer={null}
          fullScreen={fullscreen}
          width="min(1000px, 92vw)"
          centered
          bodyStyle={{ padding: 0, display: 'flex', overflow: 'hidden', height: fullscreen ? '100vh' : '88vh' }}
          closable={false}
          keepDOM={false}
        >
          <Suspense
            fallback={(
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                <Spin size="large" tip="加载预览组件..." />
              </div>
            )}
          >
            <PDFPreviewPanel
              file={file}
              onClose={close}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((v) => !v)}
              style={{ width: '100%', borderLeft: 'none' }}
              actions={(
                <>
                  {pdf.source === 'archive' ? (
                    <>
                      <Tooltip content="流程办结时系统生成并固化的 PDF 存证，内容不随模板或数据变化">
                        <Tag color="green" prefixIcon={<ShieldCheck size={12} />}>归档原件</Tag>
                      </Tooltip>
                      <Button theme="borderless" size="small" icon={<RefreshCw size={14} />} loading={loading} onClick={() => void open('live')}>按当前版式重新生成</Button>
                    </>
                  ) : null}
                  <Button theme="solid" size="small" icon={<Printer size={14} />} onClick={() => printPdfBlob(pdf.blob)}>打印</Button>
                  <Button theme="light" size="small" icon={<Download size={14} />} onClick={() => downloadBlob(pdf.blob, pdf.filename)}>下载 PDF</Button>
                </>
              )}
            />
          </Suspense>
        </Modal>
      ) : null}
    </>
  );
}
