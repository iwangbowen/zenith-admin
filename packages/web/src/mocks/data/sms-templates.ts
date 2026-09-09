import { SEED_SMS_TEMPLATES } from '@zenith/shared/seed';
import type { SmsTemplate } from '@zenith/shared/messaging';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockSmsTemplates: SmsTemplate[] = [...SEED_SMS_TEMPLATES];

let nextId = nextIdFrom(mockSmsTemplates);
export function getNextSmsTemplateId() {
  return nextId++;
}
