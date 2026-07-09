import { SEND_SOURCE_OPTIONS, SEND_STATUS_OPTIONS, type SendStatus } from '@zenith/shared';

const SEND_STATUS_COLORS: Record<SendStatus, 'orange' | 'green' | 'red'> = {
  pending: 'orange',
  success: 'green',
  failed: 'red',
};

export const SEND_LOG_STATUS_OPTIONS = SEND_STATUS_OPTIONS.map((option) => ({
  ...option,
  color: SEND_STATUS_COLORS[option.value],
}));

export { SEND_SOURCE_OPTIONS };
