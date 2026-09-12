import { eq, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import { members } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { keywordCondition } from '../../lib/where-helpers';

/** 积分 / 钱包流水行的公共字段（两张流水表同构） */
export interface MemberLedgerRow<Type extends string> {
  id: number;
  memberId: number;
  type: Type;
  amount: number;
  balanceAfter: number;
  bizType: string | null;
  bizId: string | null;
  remark: string | null;
  createdAt: Date;
}

/** 积分 / 钱包流水 → 契约实体；`memberName` 由列表查询按关联会员补入，详情 / 最近流水不带 */
export function mapLedgerTransaction<Type extends string>(row: MemberLedgerRow<Type>, memberName?: string | null) {
  return {
    id: row.id,
    memberId: row.memberId,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    bizType: row.bizType ?? null,
    bizId: row.bizId ?? null,
    remark: row.remark ?? null,
    memberName: memberName ?? undefined,
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface MemberReferenceQuery {
  memberId?: number;
  memberKeyword?: string;
}

export function memberReferenceCondition(
  memberIdColumn: PgColumn,
  query: MemberReferenceQuery,
): SQL | undefined {
  if (query.memberId) return eq(memberIdColumn, query.memberId);
  if (!query.memberKeyword) return undefined;

  const numericMemberId = /^\d+$/.test(query.memberKeyword)
    ? parseInt(query.memberKeyword, 10)
    : null;
  if (numericMemberId) return eq(memberIdColumn, numericMemberId);

  return inArray(
    memberIdColumn,
    db
      .select({ id: members.id })
      .from(members)
      .where(keywordCondition(query.memberKeyword, [members.nickname], 'ilike')),
  );
}
