import { desc, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { coupons, memberCoupons, members } from '../../../db/schema';
import { buildMemberCouponWhere } from '../../../services/member/coupons.service';
import { batchIterable } from '../../excel-export';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';
import { MEMBER_COUPON_STATUS_LABELS } from '@zenith/shared';

const STATUS_LABELS: Record<string, string> = MEMBER_COUPON_STATUS_LABELS;

type Query = { memberKeyword?: string; couponId?: number; status?: 'unused' | 'used' | 'expired' | 'frozen' };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'couponName', header: '优惠券', width: 22 },
  { key: 'code', header: '券码', width: 22 },
  { key: 'memberId', header: '会员ID', width: 10, type: 'number' },
  { key: 'memberName', header: '会员昵称', width: 16 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
  { key: 'receivedAt', header: '领取时间', width: 22, type: 'datetime' },
  { key: 'usedAt', header: '使用时间', width: 22, type: 'datetime' },
  { key: 'expireAt', header: '过期时间', width: 22, type: 'datetime' },
];

export const memberCouponRecordsExportDefinition = defineExport<Query & Record<string, unknown>, Record<string, unknown>>({
  entity: 'member.coupon-records',
  moduleName: '优惠券',
  filenamePrefix: '领券记录',
  sourcePath: '/member/coupon-records',
  sheetName: '领券记录',
  permissions: { export: 'member:coupon:list' },
  execution: { mode: 'auto' },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => db.$count(memberCoupons, buildMemberCouponWhere(query)),
  streamRows: async (query) => {
    const where = buildMemberCouponWhere(query);
    return batchIterable(async (limit, offset) => {
      const rows = await db.select({
        id: memberCoupons.id,
        couponName: coupons.name,
        code: memberCoupons.code,
        memberId: memberCoupons.memberId,
        memberName: members.nickname,
        status: memberCoupons.status,
        receivedAt: memberCoupons.receivedAt,
        usedAt: memberCoupons.usedAt,
        expireAt: memberCoupons.expireAt,
      })
        .from(memberCoupons)
        .leftJoin(coupons, eq(coupons.id, memberCoupons.couponId))
        .leftJoin(members, eq(members.id, memberCoupons.memberId))
        .where(where)
        .orderBy(desc(memberCoupons.id))
        .limit(limit)
        .offset(offset);
      return rows;
    });
  },
});
