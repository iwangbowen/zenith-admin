import { Tag } from '@douyinfe/semi-ui';
import type { SendStatus } from '@zenith/shared/messaging';
import { SEND_LOG_STATUS_OPTIONS as STATUS_OPTIONS } from './send-log-constants';

export function SendStatusTag({ value }: Readonly<{ value: SendStatus }>) {
  const it = STATUS_OPTIONS.find((s) => s.value === value);
  return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? value}</Tag>;
}
