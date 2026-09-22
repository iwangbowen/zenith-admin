/**
 * 开放平台应用（OAuth2Client）在开发者侧「我的应用」、管理端「OAuth2 应用」与「调用统计」共用的
 * 环境 / 审核状态标签与列、Scope 列，以及筛选下拉的选项。文案取 shared 的 `XXX_LABELS`，
 * Tag 颜色只在这里维护一份；列宽、标题等差异由参数表达。
 */
import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag/interface';
import { overflowTagColumn } from '@/utils/table-columns';
import {
  OPEN_APP_ENVIRONMENT_LABELS, OPEN_APP_REVIEW_STATUS_LABELS,
  type OAuth2Client, type OpenAppEnvironment, type OpenAppReviewStatus,
} from '@zenith/shared/open-platform';

export const OPEN_APP_ENVIRONMENT_TAG_COLOR: Record<OpenAppEnvironment, TagColor> = { production: 'blue', sandbox: 'orange' };
export const OPEN_APP_REVIEW_STATUS_TAG_COLOR: Record<OpenAppReviewStatus, TagColor> = {
  draft: 'grey', pending: 'orange', approved: 'green', rejected: 'red',
};

export function renderOpenAppEnvironmentTag(value: OpenAppEnvironment) {
  return <Tag size="small" color={OPEN_APP_ENVIRONMENT_TAG_COLOR[value]}>{OPEN_APP_ENVIRONMENT_LABELS[value]}</Tag>;
}

export function renderOpenAppReviewStatusTag(value: OpenAppReviewStatus) {
  return <Tag size="small" color={OPEN_APP_REVIEW_STATUS_TAG_COLOR[value]}>{OPEN_APP_REVIEW_STATUS_LABELS[value]}</Tag>;
}

type OpenAppRow = Pick<OAuth2Client, 'environment' | 'reviewStatus' | 'allowedScopes'>;

/** 环境列（生产 / 沙箱） */
export function openAppEnvironmentColumn<T extends Pick<OpenAppRow, 'environment'>>({ width = 100 }: { width?: number } = {}): ColumnProps<T> {
  return { title: '环境', dataIndex: 'environment', width, render: renderOpenAppEnvironmentTag };
}

/** 审核状态列；管理端标题更短（「审核」） */
export function openAppReviewStatusColumn<T extends Pick<OpenAppRow, 'reviewStatus'>>({ title = '审核状态', width = 110 }: { title?: string; width?: number } = {}): ColumnProps<T> {
  return { title, dataIndex: 'reviewStatus', width, render: renderOpenAppReviewStatusTag };
}

/** 已授权 Scope 列：标签集合固定、文案长度相近，按固定数量收起（最多内联 2 个，其余进气泡） */
export function openAppScopesColumn<T extends Pick<OpenAppRow, 'allowedScopes'>>({ title = 'Scope', width = 240, color }: { title?: string; width?: number; color?: TagColor } = {}): ColumnProps<T> {
  return overflowTagColumn<T>({
    title,
    dataIndex: 'allowedScopes',
    width,
    contentWidth: width - 32,
    maxTagCount: 2,
    getItems: (values) => ((values as string[] | undefined) ?? []).map((value) => ({ key: value, label: value, color })),
    tagColor: color,
    tagSize: 'small',
    popoverWidth: width,
    empty: null,
  });
}
