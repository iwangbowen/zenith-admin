import { SEED_SMS_TEMPLATES } from '@zenith/shared';
import type { SmsTemplate } from '@zenith/shared';

export const mockSmsTemplates: SmsTemplate[] = [...SEED_SMS_TEMPLATES];

let nextId = Math.max(...mockSmsTemplates.map((t) => t.id)) + 1;
export function getNextSmsTemplateId() {
  return nextId++;
}
}
