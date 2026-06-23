import type { MpMessage } from '@zenith/shared';
import { SEED_MP_MESSAGES } from '@zenith/shared';

export const mockMpMessages: MpMessage[] = SEED_MP_MESSAGES.map((m) => ({ ...m }));

let nextId = Math.max(0, ...mockMpMessages.map((m) => m.id)) + 1;
export function getNextMpMessageId() {
  return nextId++;
}
