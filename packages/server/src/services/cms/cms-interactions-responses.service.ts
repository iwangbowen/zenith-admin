import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import { CMS_INTERACTION_MATRIX_SEPARATOR, CMS_INTERACTION_OTHER_PREFIX, CMS_INTERACTION_OTHER_VALUE, cmsInteractionContract } from '@zenith/shared/cms';
import type { CmsInteractionAnswerDetail, CmsInteractionKind, CmsInteractionQuestionType, CmsInteractionRepeatPolicy, CmsInteractionResponse } from '@zenith/shared/cms';
import { db } from '../../db';
import {
  cmsInteractionAnswers,
  cmsInteractionQuestions,
  cmsInteractionResponses,
  cmsInteractions,
  members,
} from '../../db/schema';
import type { CmsInteractionRow } from '../../db/schema';
import { formatDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { streamByDescendingId } from '../../lib/export-center/cursor-stream';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { repeatKeyFor } from './cms-interactions-shared';
import { maskedMemberDisplay } from './cms-member-display';

export type CmsInteractionResponseListFilter = Omit<QueryOutputOf<typeof cmsInteractionContract.responses>, 'page' | 'pageSize'>;

export function buildCmsInteractionResponseWhere(
  q: CmsInteractionResponseListFilter,
): SQL {
  const conditions: SQL[] = [eq(cmsInteractions.siteId, q.siteId)];
  if (q.interactionId) conditions.push(eq(cmsInteractionResponses.interactionId, q.interactionId));
  if (q.kind) conditions.push(eq(cmsInteractions.kind, q.kind));
  if (q.startTime) {
    const parsed = parseDateRangeStart(q.startTime);
    if (!parsed) throw new HTTPException(400, { message: '开始时间格式无效' });
    conditions.push(gte(cmsInteractionResponses.createdAt, parsed));
  }
  if (q.endTime) {
    const parsed = parseDateRangeEnd(q.endTime);
    if (!parsed) throw new HTTPException(400, { message: '结束时间格式无效' });
    conditions.push(lte(cmsInteractionResponses.createdAt, parsed));
  }
  return buildWhere(...conditions);
}

/**
 * 把一条原始答案关联题目后转成可读结构：选项 value 反查文案，
 * 选项被改名/删除时回退成原始 value，保证答卷永远看得见内容。
 */
export function toCmsInteractionAnswerDetail(input: {
  questionId: number;
  label: string;
  type: CmsInteractionQuestionType;
  options: { label: string; value: string }[] | null;
  matrixRows?: { id: string; label: string }[] | null;
  otherLabel?: string | null;
  value: string | string[];
}): CmsInteractionAnswerDetail {
  const raw = Array.isArray(input.value) ? input.value : [input.value];
  const labelOf = new Map((input.options ?? []).map((option) => [option.value, option.label]));
  const rowLabelOf = new Map((input.matrixRows ?? []).map((row) => [row.id, row.label]));
  const otherLabel = input.otherLabel?.trim() || '其他';
  const values = raw.map((value) => {
    switch (input.type) {
      case 'text':
      case 'date':
      case 'number':
        return value;
      case 'rating':
        return `${value} 分`;
      case 'nps':
        return `${value} 分`;
      case 'matrix': {
        const separator = value.indexOf(CMS_INTERACTION_MATRIX_SEPARATOR);
        if (separator < 0) return value;
        const rowId = value.slice(0, separator);
        const optionValue = value.slice(separator + CMS_INTERACTION_MATRIX_SEPARATOR.length);
        return `${rowLabelOf.get(rowId) ?? rowId}：${labelOf.get(optionValue) ?? optionValue}`;
      }
      default: {
        if (value === CMS_INTERACTION_OTHER_VALUE) return otherLabel;
        if (value.startsWith(CMS_INTERACTION_OTHER_PREFIX)) {
          return `${otherLabel}：${value.slice(CMS_INTERACTION_OTHER_PREFIX.length)}`;
        }
        return labelOf.get(value) ?? value;
      }
    }
  });
  return {
    questionId: input.questionId,
    label: input.label,
    type: input.type,
    values,
    display: values.join('、'),
  };
}

interface LoadedAnswers {
  /** 原始答案：questionId -> 选项 value / 文本，保持既有 API 兼容 */
  answers: Map<number, Record<string, string | string[]>>;
  /** 关联题目后的可读答案，按题目 sort 排序 */
  details: Map<number, CmsInteractionAnswerDetail[]>;
}

/** 一次性载入答案并关联题目，把选项 value 反查成选项文案 */
async function loadAnswers(responseIds: number[]): Promise<LoadedAnswers> {
  if (responseIds.length === 0) return { answers: new Map(), details: new Map() };
  const rows = await db.select({
    responseId: cmsInteractionAnswers.responseId,
    questionId: cmsInteractionAnswers.questionId,
    value: cmsInteractionAnswers.value,
    label: cmsInteractionQuestions.label,
    type: cmsInteractionQuestions.type,
    options: cmsInteractionQuestions.options,
    matrixRows: cmsInteractionQuestions.matrixRows,
    otherLabel: cmsInteractionQuestions.otherLabel,
  })
    .from(cmsInteractionAnswers)
    .innerJoin(cmsInteractionQuestions, eq(cmsInteractionAnswers.questionId, cmsInteractionQuestions.id))
    .where(inArray(cmsInteractionAnswers.responseId, responseIds))
    .orderBy(asc(cmsInteractionQuestions.sort), asc(cmsInteractionQuestions.id));
  const answers = new Map<number, Record<string, string | string[]>>();
  const details = new Map<number, CmsInteractionAnswerDetail[]>();
  for (const row of rows) {
    const answer = answers.get(row.responseId) ?? {};
    answer[String(row.questionId)] = row.value;
    answers.set(row.responseId, answer);

    const list = details.get(row.responseId) ?? [];
    list.push(toCmsInteractionAnswerDetail(row));
    details.set(row.responseId, list);
  }
  return { answers, details };
}

export async function listCmsInteractionResponses(q: QueryOutputOf<typeof cmsInteractionContract.responses>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildCmsInteractionResponseWhere(q);
  const base = db.select({
    response: cmsInteractionResponses,
    interactionTitle: cmsInteractions.title,
    kind: cmsInteractions.kind,
    nickname: members.nickname,
    username: members.username,
    phone: members.phone,
    email: members.email,
  })
    .from(cmsInteractionResponses)
    .innerJoin(cmsInteractions, eq(cmsInteractionResponses.interactionId, cmsInteractions.id))
    .leftJoin(members, eq(cmsInteractionResponses.memberId, members.id))
    .where(where)
    .orderBy(desc(cmsInteractionResponses.createdAt), desc(cmsInteractionResponses.id));
  const { list: rows, total } = await buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.select({ value: sql<number>`count(*)::int` }).from(cmsInteractionResponses)
      .innerJoin(cmsInteractions, eq(cmsInteractionResponses.interactionId, cmsInteractions.id))
      .where(where)
      .then((r) => r[0]?.value ?? 0),
    rows: () => withPagination(base.$dynamic(), q.page, q.pageSize),
  });
  const { answers, details } = await loadAnswers(rows.map((row) => row.response.id));
  const list: CmsInteractionResponse[] = rows.map((row) => ({
    id: row.response.id,
    interactionId: row.response.interactionId,
    interactionTitle: row.interactionTitle,
    kind: row.kind,
    memberId: row.response.memberId,
    memberDisplay: row.response.memberId ? maskedMemberDisplay(row, '游客') : '游客',
    visitorHash: row.response.visitorHash,
    ipHash: row.response.ipHash,
    answers: answers.get(row.response.id) ?? {},
    answerDetails: details.get(row.response.id) ?? [],
    createdAt: formatDateTime(row.response.createdAt),
  }));
  return { list, total, page: q.page, pageSize: q.pageSize };
}

export async function* streamCmsInteractionResponses(
  q: CmsInteractionResponseListFilter,
) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const baseWhere = buildCmsInteractionResponseWhere(q);
  yield* streamByDescendingId(async (beforeId, limit) => {
    const rows = await db.select({
      response: cmsInteractionResponses,
      interactionTitle: cmsInteractions.title,
      kind: cmsInteractions.kind,
      memberId: members.id,
      nickname: members.nickname,
      username: members.username,
      phone: members.phone,
      email: members.email,
    })
      .from(cmsInteractionResponses)
      .innerJoin(cmsInteractions, eq(cmsInteractionResponses.interactionId, cmsInteractions.id))
      .leftJoin(members, eq(cmsInteractionResponses.memberId, members.id))
      .where(and(baseWhere, beforeId === null ? undefined : lt(cmsInteractionResponses.id, beforeId)))
      .orderBy(desc(cmsInteractionResponses.id))
      .limit(limit);
    const { answers, details } = await loadAnswers(rows.map((row) => row.response.id));
    return rows.map((row): CmsInteractionResponse => ({
      id: row.response.id,
      interactionId: row.response.interactionId,
      interactionTitle: row.interactionTitle,
      kind: row.kind,
      memberId: row.response.memberId,
      memberDisplay: row.memberId
        ? row.nickname || row.username || row.phone || row.email || `会员 #${row.memberId}`
        : '游客',
      visitorHash: row.response.visitorHash,
      ipHash: row.response.ipHash,
      answers: answers.get(row.response.id) ?? {},
      answerDetails: details.get(row.response.id) ?? [],
      createdAt: formatDateTime(row.response.createdAt),
    }));
  });
}

const INTERACTION_MARKER_RE = /(?:<p[^>]*>)?\s*\[互动:([a-z0-9-]+)\]\s*(?:<\/p>)?/gi;
const LEGACY_INTERACTION_MARKER_RE = /(?:<p[^>]*>)?\s*\[(?:投票|问卷|survey|poll):[^\]\r\n]{1,100}\]\s*(?:<\/p>)?/gi;

export function applyInteractionMarkers(html: string, siteCode: string, siteId?: number): string {
  if (!html) return html;
  const withoutLegacy = html.replace(LEGACY_INTERACTION_MARKER_RE, '');
  if (!withoutLegacy.includes('[互动:')) return withoutLegacy;
  const safeSiteCode = siteCode.replace(/[^a-z0-9-]/gi, '');
  const siteIdAttr = Number.isInteger(siteId) && siteId! > 0 ? ` data-site-id="${siteId}"` : '';
  return withoutLegacy.replace(INTERACTION_MARKER_RE, (_match, code: string) =>
    `<div class="cms-interaction" data-island="survey" data-site="${safeSiteCode}"${siteIdAttr} data-code="${code}"></div>`);
}

export function canExposeCmsInteractionResults(input: {
  visibility: CmsInteractionRow['resultVisibility'];
  status: CmsInteractionRow['status'];
  submitted: boolean;
}): boolean {
  return input.visibility === 'always'
    || (input.visibility === 'after_submit' && input.submitted)
    || (input.visibility === 'after_close' && input.status === 'closed');
}

export function cmsInteractionRepeatIdentity(input: {
  policy: CmsInteractionRepeatPolicy;
  memberId: number | null;
  ipHash: string;
}): string | null {
  return repeatKeyFor(input.policy, input.memberId, input.ipHash);
}
