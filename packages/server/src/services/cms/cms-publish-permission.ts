import { HTTPException } from 'hono/http-exception';
import { hasPermission } from '../../lib/context';

export const CMS_CONTENT_PUBLISH_PERMISSION = 'cms:content:publish';

export type CmsPublishPermissionCheck = () => Promise<boolean>;

export async function requireCmsContentPublishPermission(
  message: string,
  permissionCheck: CmsPublishPermissionCheck = () => hasPermission(CMS_CONTENT_PUBLISH_PERMISSION),
): Promise<void> {
  if (!(await permissionCheck())) {
    throw new HTTPException(403, { message });
  }
}

export async function requireCmsScheduledAtMutationPermission(
  input: {
    current: Date | null;
    requested: Date | null | undefined;
  },
  permissionCheck?: CmsPublishPermissionCheck,
): Promise<void> {
  if (input.requested === undefined) return;
  const currentTime = input.current?.getTime() ?? null;
  const requestedTime = input.requested?.getTime() ?? null;
  if (currentTime === requestedTime) return;
  await requireCmsContentPublishPermission(
    '设置、修改或清除计划发布时间需要 cms:content:publish 权限',
    permissionCheck,
  );
}

export const CMS_IMPORTED_CONTENT_LIFECYCLE = {
  status: 'draft',
  publishedAt: null,
  scheduledAt: null,
  archivedAt: null,
} as const;
