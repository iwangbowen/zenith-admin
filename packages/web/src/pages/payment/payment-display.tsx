/* eslint-disable react-refresh/only-export-components */
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import type { PaymentChannel } from '@zenith/shared/payment';
import { PAYMENT_CHANNEL_LABELS } from '@zenith/shared/payment';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';

export function PaymentChannelTag({
  channel,
  size,
  textOnly,
}: {
  channel: PaymentChannel;
  size?: 'small' | 'large';
  textOnly?: boolean;
}) {
  const label = PAYMENT_CHANNEL_LABELS[channel];
  if (textOnly) return <>{label}</>;
  return <Tag color={PAYMENT_CHANNEL_TAG_COLOR[channel]} size={size}>{label}</Tag>;
}

export function paymentMoneyColumn<T extends Data>(
  title: string,
  dataIndex: string,
  options: { strong?: boolean; signed?: boolean; empty?: string } = {},
): ColumnProps<T> {
  return {
    title,
    dataIndex,
    align: 'right',
    render: (value: number | null | undefined) => {
      if (value == null) return options.empty ?? '-';
      const text = `${options.signed && value > 0 ? '+' : ''}${formatYuan(value)}`;
      if (!options.strong) return text;
      return <Typography.Text strong>{text}</Typography.Text>;
    },
  };
}
