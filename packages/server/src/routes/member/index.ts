import {
  checkinMilestoneContract,
  checkinRuleContract,
  checkinSettingsContract,
  couponContract,
  memberAuthContract,
  memberCheckinContract,
  memberContract,
  memberLevelContract,
  memberPointContract,
  memberPushContract,
  memberRechargeContract,
  memberRenewalContract,
  memberSelfContract,
  memberStatsContract,
  memberTagContract,
  memberWalletContract,
} from '@zenith/shared/member';
import { defineRouteDomain } from '../_kit';
import checkinMilestonesRoutes from './checkin-milestones';
import checkinRulesRoutes from './checkin-rules';
import checkinSettingsRoutes from './checkin-settings';
import couponsRoutes from './coupons';
import memberAuthRoutes from './member-auth';
import memberCheckinsRoutes from './member-checkins';
import memberCmsRoutes from './member-cms';
import memberLevelsRoutes from './member-levels';
import memberPointsRoutes from './member-points';
import memberPushRoutes from './member-push';
import memberRechargesRoutes from './member-recharges';
import memberRenewalRoutes from './member-renewal';
import memberSelfRoutes from './member-self';
import memberStatsRoutes from './member-stats';
import memberTagsRoutes from './member-tags';
import memberWalletsRoutes from './member-wallets';
import membersRoutes from './members';

export default defineRouteDomain({
  name: 'member',
  mounts: () => [
    [memberAuthContract.basePath, memberAuthRoutes, { feature: 'member' }],
    [memberRenewalContract.basePath, memberRenewalRoutes, { feature: 'member' }],
    ['/api/member/cms', memberCmsRoutes, { feature: 'member' }],
    // 会员端设备推送绑定;须先于 /api/member 兜底挂载
    [memberPushContract.basePath, memberPushRoutes, { feature: 'member' }],
    [memberSelfContract.basePath, memberSelfRoutes, { feature: 'member' }],
    [memberContract.basePath, membersRoutes, { feature: 'member' }],
    [memberLevelContract.basePath, memberLevelsRoutes, { feature: 'member' }],
    [memberTagContract.basePath, memberTagsRoutes, { feature: 'member' }],
    [memberPointContract.basePath, memberPointsRoutes, { feature: 'member' }],
    [memberWalletContract.basePath, memberWalletsRoutes, { feature: 'member' }],
    [couponContract.basePath, couponsRoutes, { feature: 'member' }],
    [checkinRuleContract.basePath, checkinRulesRoutes, { feature: 'member' }],
    [checkinMilestoneContract.basePath, checkinMilestonesRoutes, { feature: 'member' }],
    [checkinSettingsContract.basePath, checkinSettingsRoutes, { feature: 'member' }],
    [memberCheckinContract.basePath, memberCheckinsRoutes, { feature: 'member' }],
    [memberRechargeContract.basePath, memberRechargesRoutes, { feature: 'member' }],
    [memberStatsContract.basePath, memberStatsRoutes, { feature: 'member' }],
  ],
});
