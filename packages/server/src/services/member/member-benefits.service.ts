/**
 * 会员权益服务：等级折扣查询（等级权益消费侧落地入口）。
 *
 * `getMemberDiscount(memberId)` 返回会员当前折扣百分比（100 = 原价），
 * 供订单/支付等消费链路在计价时调用：`应付 = Math.round(原价 * discount / 100)`。
 */
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { memberLevels, members } from '../../db/schema';
import { currentMemberId } from '../../lib/member-context';

/** 会员当前折扣百分比（无等级 / 等级停用 = 100 原价）*/
export async function getMemberDiscount(memberId: number): Promise<number> {
  const row = await db.query.members.findFirst({
    where: and(eq(members.id, memberId), isNull(members.deletedAt)),
    columns: { id: true },
    with: { level: { columns: { discount: true, status: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '会员不存在' });
  if (!row.level || row.level.status !== 'enabled') return 100;
  return row.level.discount;
}

/** 按折扣计算应付金额（分），四舍五入 */
export function applyDiscount(amountFen: number, discount: number): number {
  if (discount >= 100 || discount <= 0) return amountFen;
  return Math.round((amountFen * discount) / 100);
}

/** 前台：我的权益（当前等级/折扣 + 距下一等级的成长值差距）*/
export async function getMyBenefits() {
  const memberId = currentMemberId();
  const row = await db.query.members.findFirst({
    where: and(eq(members.id, memberId), isNull(members.deletedAt)),
    columns: { growthValue: true },
    with: { level: { columns: { id: true, name: true, discount: true, growthThreshold: true, benefits: true, status: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '会员不存在' });

  const growthValue = row.growthValue;
  const currentLevel = row.level && row.level.status === 'enabled' ? row.level : null;
  const [nextLevel] = await db
    .select({ id: memberLevels.id, name: memberLevels.name, growthThreshold: memberLevels.growthThreshold, discount: memberLevels.discount })
    .from(memberLevels)
    .where(and(eq(memberLevels.status, 'enabled'), gt(memberLevels.growthThreshold, growthValue)))
    .orderBy(asc(memberLevels.growthThreshold))
    .limit(1);

  return {
    growthValue,
    discount: currentLevel?.discount ?? 100,
    levelId: currentLevel?.id ?? null,
    levelName: currentLevel?.name ?? null,
    benefits: currentLevel?.benefits ?? [],
    nextLevel: nextLevel
      ? {
        id: nextLevel.id,
        name: nextLevel.name,
        growthThreshold: nextLevel.growthThreshold,
        discount: nextLevel.discount,
        growthGap: nextLevel.growthThreshold - growthValue,
      }
      : null,
  };
}
