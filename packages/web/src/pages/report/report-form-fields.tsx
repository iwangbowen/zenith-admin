/**
 * 报表资源页共用的表单字段：
 * - `ReportOwnerFolderFields`：新增 / 编辑表单里的「负责人 / 资源目录」下拉对（下拉源来自 `useReportOwnerFolderOptions`）
 *
 * 批量启用 / 停用走 `components/list-page` 的 `batchStatusHandler` + `toolbar-controls` 的 `BatchStatusButtons`。
 */
import { Col, Form, Row } from '@douyinfe/semi-ui';
import type { FilterOption } from '@/components/search-filters';

interface ReportOwnerFolderFieldsProps {
  readonly userOptions: FilterOption<number>[];
  readonly folderOptions: FilterOption<number>[];
  /** `row` 两列并排（数据源 / 数据集弹窗），`stack` 纵排（打印模板 / 仪表盘弹窗） */
  readonly layout?: 'row' | 'stack';
  readonly folderLabel?: string;
}

export function ReportOwnerFolderFields({ userOptions, folderOptions, layout = 'stack', folderLabel = '资源目录' }: ReportOwnerFolderFieldsProps) {
  const owner = <Form.Select field="ownerId" label="负责人" filter showClear style={{ width: '100%' }} optionList={userOptions} />;
  const folder = <Form.Select field="folderId" label={folderLabel} filter showClear style={{ width: '100%' }} optionList={folderOptions} />;
  if (layout === 'row') {
    return (
      <Row gutter={16}>
        <Col span={12}>{owner}</Col>
        <Col span={12}>{folder}</Col>
      </Row>
    );
  }
  return <>{owner}{folder}</>;
}
