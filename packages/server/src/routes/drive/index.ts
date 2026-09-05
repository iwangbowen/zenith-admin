import {
  driveAdminContract,
  driveNodeContract,
  drivePublicShareContract,
  driveShareLinkContract,
  driveSpaceContract,
  driveTagContract,
} from '@zenith/shared/drive';
import { defineRouteDomain } from '../_kit';
import driveSpacesRoutes from './drive-spaces';
import driveNodesRoutes from './drive-nodes';
import driveNodeItemRoutes from './drive-node-item';
import driveShareLinksRoutes from './drive-share-links';
import drivePublicRoutes from './drive-public';
import driveTagsRoutes from './drive-tags';
import driveAdminRoutes from './drive-admin';

export default defineRouteDomain({
  name: 'drive',
  mounts: () => [
    [driveSpaceContract.basePath, driveSpacesRoutes, { feature: 'drive' }],
    // 静态路径路由器先于单节点 /{id} 路由器挂载在同一路径
    [driveNodeContract.basePath, driveNodesRoutes, { feature: 'drive' }],
    [driveNodeContract.basePath, driveNodeItemRoutes, { feature: 'drive' }],
    [driveShareLinkContract.basePath, driveShareLinksRoutes, { feature: 'drive' }],
    [driveTagContract.basePath, driveTagsRoutes, { feature: 'drive' }],
    [driveAdminContract.basePath, driveAdminRoutes, { feature: 'drive' }],
    // 外链匿名访问：feature 门禁同样生效（关闭网盘功能即整体不可达）
    [drivePublicShareContract.basePath, drivePublicRoutes, { feature: 'drive' }],
  ],
});
