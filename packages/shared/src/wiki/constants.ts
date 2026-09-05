import { createLabelOptions } from '../core/enum-options';

// ─── 空间可见性 ───────────────────────────────────────────────────────────────
export const WIKI_SPACE_VISIBILITIES = ['public', 'private'] as const;

export type WikiSpaceVisibility = (typeof WIKI_SPACE_VISIBILITIES)[number];

export const WIKI_SPACE_VISIBILITY_LABELS: Record<WikiSpaceVisibility, string> = {
  public: '全员可读',
  private: '成员可见',
};

export const WIKI_SPACE_VISIBILITY_OPTIONS: Array<{ value: WikiSpaceVisibility; label: string }> =
  createLabelOptions(WIKI_SPACE_VISIBILITIES, WIKI_SPACE_VISIBILITY_LABELS);

// ─── 空间成员角色 ─────────────────────────────────────────────────────────────
export const WIKI_SPACE_MEMBER_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;

export type WikiSpaceMemberRole = (typeof WIKI_SPACE_MEMBER_ROLES)[number];

export const WIKI_SPACE_MEMBER_ROLE_LABELS: Record<WikiSpaceMemberRole, string> = {
  owner: '负责人',
  admin: '管理员',
  editor: '编辑者',
  viewer: '阅读者',
};

export const WIKI_SPACE_MEMBER_ROLE_OPTIONS: Array<{ value: WikiSpaceMemberRole; label: string }> =
  createLabelOptions(WIKI_SPACE_MEMBER_ROLES, WIKI_SPACE_MEMBER_ROLE_LABELS);

// ─── 文档状态 ─────────────────────────────────────────────────────────────────
export const WIKI_DOC_STATUSES = ['draft', 'pending', 'published', 'rejected'] as const;

export type WikiDocStatus = (typeof WIKI_DOC_STATUSES)[number];

export const WIKI_DOC_STATUS_LABELS: Record<WikiDocStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  rejected: '已驳回',
};

export const WIKI_DOC_STATUS_OPTIONS: Array<{ value: WikiDocStatus; label: string }> =
  createLabelOptions(WIKI_DOC_STATUSES, WIKI_DOC_STATUS_LABELS);

// ─── 评论状态 ─────────────────────────────────────────────────────────────────
export const WIKI_COMMENT_STATUSES = ['visible', 'hidden'] as const;

export type WikiCommentStatus = (typeof WIKI_COMMENT_STATUSES)[number];

export const WIKI_COMMENT_STATUS_LABELS: Record<WikiCommentStatus, string> = {
  visible: '正常',
  hidden: '已隐藏',
};

export const WIKI_COMMENT_STATUS_OPTIONS: Array<{ value: WikiCommentStatus; label: string }> =
  createLabelOptions(WIKI_COMMENT_STATUSES, WIKI_COMMENT_STATUS_LABELS);

// ─── 审核动作 ─────────────────────────────────────────────────────────────────
export const WIKI_REVIEW_ACTIONS = ['submit', 'approve', 'reject', 'withdraw'] as const;

export type WikiReviewAction = (typeof WIKI_REVIEW_ACTIONS)[number];

export const WIKI_REVIEW_ACTION_LABELS: Record<WikiReviewAction, string> = {
  submit: '提交审核',
  approve: '审核通过',
  reject: '驳回',
  withdraw: '撤回',
};

export const WIKI_REVIEW_ACTION_OPTIONS: Array<{ value: WikiReviewAction; label: string }> =
  createLabelOptions(WIKI_REVIEW_ACTIONS, WIKI_REVIEW_ACTION_LABELS);

// ─── 治理（P2-D）──────────────────────────────────────────────────────────────

export const WIKI_GOVERNANCE_KINDS = ['all', 'expired', 'review-due', 'stale', 'no-owner', 'draft-backlog', 'review-backlog', 'archived'] as const;

export type WikiGovernanceKind = (typeof WIKI_GOVERNANCE_KINDS)[number];

export const WIKI_GOVERNANCE_KIND_LABELS: Record<WikiGovernanceKind, string> = {
  all: '全部文档',
  expired: '已过期',
  'review-due': '待复审',
  stale: '长期未更新',
  'no-owner': '无负责人',
  'draft-backlog': '草稿积压',
  'review-backlog': '审核积压',
  archived: '已归档',
};

export const WIKI_GOVERNANCE_KIND_OPTIONS: Array<{ value: WikiGovernanceKind; label: string }> =
  createLabelOptions(WIKI_GOVERNANCE_KINDS, WIKI_GOVERNANCE_KIND_LABELS);

