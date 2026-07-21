import { requireCmsContentPublishPermission } from './cms-publish-permission';

export async function requireCmsCollectPublishPermission(
  autoPublish: boolean,
  permissionCheck: () => Promise<boolean>,
): Promise<void> {
  if (!autoPublish) return;
  await requireCmsContentPublishPermission(
    '启用或执行自动发布需要 cms:content:publish 权限',
    permissionCheck,
  );
}
