import type { CmsEditorialStatus } from '@zenith/shared/cms';

export const CMS_EDITORIAL_STATUS_LABELS: Record<CmsEditorialStatus, string> = {
  draft: '工作稿', pending: '审核中', rejected: '已驳回', approved: '已批准', clean: '与线上一致',
};
export const CMS_EDITORIAL_STATUS_COLORS: Record<CmsEditorialStatus, 'grey' | 'orange' | 'red' | 'green' | 'blue'> = {
  draft: 'grey', pending: 'orange', rejected: 'red', approved: 'green', clean: 'blue',
};
