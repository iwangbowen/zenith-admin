import type { CmsContentStatus } from '@zenith/shared';

export const CMS_CONTENT_STATUS_TRANSITIONS = {
  submit: ['draft', 'rejected'],
  publish: ['draft', 'pending', 'rejected', 'offline'],
  reject: ['pending'],
  offline: ['published'],
} as const satisfies Record<string, readonly CmsContentStatus[]>;

export type CmsContentTransitionAction = keyof typeof CMS_CONTENT_STATUS_TRANSITIONS;

export function canTransitionCmsContentStatus(
  current: CmsContentStatus,
  action: CmsContentTransitionAction,
): boolean {
  return (CMS_CONTENT_STATUS_TRANSITIONS[action] as readonly CmsContentStatus[]).includes(current);
}
