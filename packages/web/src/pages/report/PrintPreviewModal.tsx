import type { ReportPrintRenderResult } from '@zenith/shared/report';
import AppModal from '@/components/AppModal';
import PrintReportView from './PrintReportView';

interface PrintPreviewModalProps {
  visible: boolean;
  /** 渲染请求进行中 */
  loading: boolean;
  result: ReportPrintRenderResult | null;
  /** 本次渲染使用的参数（供预览视图回显） */
  params: Record<string, unknown>;
  onClose: () => void;
}

/** 打印模板预览弹窗：模板列表与打印设计器共用（宽屏等比容器 + 生成中 / 空态） */
export function PrintPreviewModal({ visible, loading, result, params, onClose }: Readonly<PrintPreviewModalProps>) {
  return (
    <AppModal
      title="打印预览"
      visible={visible}
      onCancel={onClose}
      footer={null}
      width="92vw"
      style={{ maxWidth: 1180 }}
    >
      {loading && <div style={{ padding: 32, textAlign: 'center' }}>正在生成预览...</div>}
      {!loading && result && <PrintReportView result={result} params={params} />}
      {!loading && !result && <div style={{ padding: 32, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>暂无预览内容</div>}
    </AppModal>
  );
}

export default PrintPreviewModal;
