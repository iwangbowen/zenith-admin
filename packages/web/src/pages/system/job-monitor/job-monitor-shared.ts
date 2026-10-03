import { createLabelOptionsFromMap } from '@zenith/shared/core';
import type { JobHealthLevel, JobSourceSummary } from '@zenith/shared/platform';
import type { TagProps } from '@douyinfe/semi-ui/lib/es/tag';
import { formatSecondsHuman } from '@/utils/format';

export const JOB_HEALTH_COLORS: Record<JobHealthLevel, TagProps['color']> = {
  ok: 'green', warn: 'orange', critical: 'red', unavailable: 'grey',
};

const HEALTH_ORDER: Record<JobHealthLevel, number> = {
  critical: 0, warn: 1, ok: 2, unavailable: 3,
};

const REFRESH_LABELS = {
  off: '关闭自动刷新', '15000': '每 15 秒刷新', '30000': '每 30 秒刷新', '60000': '每 60 秒刷新',
};
export const JOB_REFRESH_OPTIONS = createLabelOptionsFromMap(REFRESH_LABELS);

export const formatAge = formatSecondsHuman;

export function sortJobSources(sources: readonly JobSourceSummary[]): JobSourceSummary[] {
  return [...sources].sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]);
}
