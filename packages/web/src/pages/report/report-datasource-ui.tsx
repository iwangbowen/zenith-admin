import { Tag } from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag/interface';
import { REPORT_DATASOURCE_TYPE_LABELS, type ReportDatasourceType } from '@zenith/shared';

export const REPORT_DATASOURCE_TYPE_TAG_COLORS: Record<ReportDatasourceType, TagColor> = {
  api: 'blue',
  sql: 'violet',
  mysql: 'cyan',
  postgresql: 'indigo',
  sqlserver: 'orange',
  static: 'grey',
};

export function renderReportDatasourceTypeTag(type: ReportDatasourceType) {
  return (
    <Tag color={REPORT_DATASOURCE_TYPE_TAG_COLORS[type]} size="small">
      {REPORT_DATASOURCE_TYPE_LABELS[type]}
    </Tag>
  );
}
