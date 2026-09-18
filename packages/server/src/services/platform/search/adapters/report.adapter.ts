import { reportDashboardContract } from '@zenith/shared/report';
import { reportDatasetContract } from '@zenith/shared/report';
import type { QueryOutputOf } from '@zenith/shared/core';
import { hasPermission } from '../../../../lib/context';
import { listDashboards } from '../../../report/report-dashboard.service';
import { listDatasets } from '../../../report/report-dataset-crud.service';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

type DashboardQuery = QueryOutputOf<typeof reportDashboardContract.list>;
type DatasetQuery = QueryOutputOf<typeof reportDatasetContract.list>;

export const reportDashboardSearchAdapter: GlobalSearchAdapter = {
  type: 'report-dashboard',
  permissions: ['report:dashboard:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('report:dashboard:list'))) return [];
    const page = await listDashboards({ page: 1, pageSize: limit, keyword: q } satisfies DashboardQuery);
    return page.list.map((dashboard) => result({
      type: 'report-dashboard',
      id: String(dashboard.id),
      title: dashboard.name,
      subtitle: [dashboard.categoryName, dashboard.folderName].filter(Boolean).join(' · '),
      description: dashboard.remark,
      icon: 'LayoutDashboard',
      route: `/report/dashboards?keyword=${encodeURIComponent(dashboard.name)}`,
      highlights: [{ field: 'title', text: dashboard.name }],
    }));
  },
};

export const reportDatasetSearchAdapter: GlobalSearchAdapter = {
  type: 'report-dataset',
  permissions: ['report:dataset:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('report:dataset:list'))) return [];
    const page = await listDatasets({ page: 1, pageSize: limit, keyword: q } satisfies DatasetQuery);
    return page.list.map((dataset) => result({
      type: 'report-dataset',
      id: String(dataset.id),
      title: dataset.name,
      subtitle: [dataset.datasourceName, dataset.folderName].filter(Boolean).join(' · '),
      description: dataset.remark,
      icon: 'Database',
      route: `/report/datasets?keyword=${encodeURIComponent(dataset.name)}`,
      highlights: [{ field: 'title', text: dataset.name }],
    }));
  },
};

