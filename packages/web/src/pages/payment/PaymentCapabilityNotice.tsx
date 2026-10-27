import { Banner } from '@douyinfe/semi-ui';
import type { PaymentCapabilitiesResponse } from '@zenith/shared/payment';
import { paymentCapabilityReason } from './payment-app-options';

interface PaymentCapabilityNoticeProps {
  visible: boolean;
  operationLabel: string;
  capabilities?: PaymentCapabilitiesResponse;
}

/** Shared empty state for forms whose selected app has no effective payment capability. */
export function PaymentCapabilityNotice({ visible, operationLabel, capabilities }: Readonly<PaymentCapabilityNoticeProps>) {
  if (!visible) return null;
  const reason = paymentCapabilityReason(capabilities);
  const description = reason
    ? `所选应用暂无可用${operationLabel}方式：${reason}`
    : `所选应用暂无可用${operationLabel}方式，请检查支付方式启停、商户配置与运行环境。`;
  return <Banner type="warning" closeIcon={null} style={{ marginBottom: 16 }} description={description} />;
}
