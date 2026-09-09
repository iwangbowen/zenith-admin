import type { ReactNode } from 'react';
import { Button, Typography } from '@douyinfe/semi-ui';
import { QRCodeSVG } from 'qrcode.react';
import type { CreatePaymentResult, PaymentMethod } from '@zenith/shared/payment';
import { AppModal } from '@/components/AppModal';
import { getPaymentQrInstruction } from '@/utils/payment';

interface PaymentResultModalProps {
  /** 下单结果；为 null 时弹窗关闭 */
  result: CreatePaymentResult | null;
  /** 下单使用的支付方式，用于二维码下方的扫码引导文案 */
  method: PaymentMethod | null;
  onClose: () => void;
  /** 结果区块下方的补充说明（如演示页的履约提示） */
  extra?: ReactNode;
}

/** 支付下单结果弹窗：扫码二维码 / 跳转支付页 / APP 调起参数，支付订单页与支付演示页共用 */
export function PaymentResultModal({ result, method, onClose, extra }: Readonly<PaymentResultModalProps>) {
  return (
    <AppModal title="支付下单结果" visible={!!result} onCancel={onClose} footer={null} width={420} closeOnEsc>
      {result && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 8 }}>订单号：{result.orderNo}</div>
          {result.codeUrl && (
            <>
              <QRCodeSVG value={result.codeUrl} size={200} style={{ margin: '12px auto', display: 'block' }} />
              <Typography.Text type="tertiary">{getPaymentQrInstruction(method)}</Typography.Text>
            </>
          )}
          {result.payUrl && (
            <div style={{ margin: '16px 0' }}>
              <Button type="primary" onClick={() => window.open(result.payUrl, '_blank', 'noopener')}>打开支付页</Button>
              <div style={{ marginTop: 8, wordBreak: 'break-all', fontSize: 12 }}><Typography.Text type="tertiary">{result.payUrl}</Typography.Text></div>
            </div>
          )}
          {result.appOrderStr && (
            <div style={{ margin: '12px 0', wordBreak: 'break-all', fontSize: 12, textAlign: 'left' }}>
              <Typography.Text type="tertiary">APP 调起参数（复制给客户端 SDK）：</Typography.Text>
              <div style={{ marginTop: 4 }}>{result.appOrderStr}</div>
            </div>
          )}
          {extra}
        </div>
      )}
    </AppModal>
  );
}

export default PaymentResultModal;
