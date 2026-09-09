import { SEED_INAPP_TEMPLATES } from '@zenith/shared/seed';
import type { InAppTemplate } from '@zenith/shared/messaging';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockInAppTemplates: InAppTemplate[] = [...SEED_INAPP_TEMPLATES];

let nextId = nextIdFrom(mockInAppTemplates);
export function getNextInAppTemplateId() {
  return nextId++;
}
