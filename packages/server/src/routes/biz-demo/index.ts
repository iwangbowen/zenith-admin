import { bizLeaveContract } from '@zenith/shared/biz';
import { defineRouteDomain } from '../_kit';
import bizLeaveRoutes from './biz-leave';

export default defineRouteDomain({
  name: 'biz-demo',
  licensing: { core: '业务接入示例不单独收取功能授权' },
  mounts: () => [
    [bizLeaveContract.basePath, bizLeaveRoutes],
  ],
});
