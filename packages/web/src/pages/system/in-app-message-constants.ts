import { IN_APP_MESSAGE_TYPE_OPTIONS } from '@zenith/shared/messaging';
import type { InAppMessageType } from '@zenith/shared/messaging';

type InAppMessageTypeColor = 'blue' | 'green' | 'orange' | 'red';

export const IN_APP_MESSAGE_TYPE_COLORS: Record<InAppMessageType, InAppMessageTypeColor> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

export const IN_APP_MESSAGE_TYPE_OPTIONS_WITH_COLOR = IN_APP_MESSAGE_TYPE_OPTIONS.map((option) => ({
  ...option,
  color: IN_APP_MESSAGE_TYPE_COLORS[option.value],
}));
