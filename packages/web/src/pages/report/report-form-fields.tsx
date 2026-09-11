/* eslint-disable react-refresh/only-export-components */
/**
 * 报表资源页共用的表单字段与批量启停：
 * - `ReportOwnerFolderFields`：新增 / 编辑表单里的「负责人 / 资源目录」下拉对（下拉源来自 `useReportOwnerFolderOptions`）
 * - `useReportBatchStatus` + `ReportBatchStatusButtons`：选中行批量启用 / 停用（可选确认框）与工具栏按钮对
 */
import { Button, Col, Form, Modal, Row, Toast } from '@douyinfe/semi-ui';
import type { FilterOption } from '@/components/search-filters';

type BatchStatus = 'enabled' | 'disabled';

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

interface UseReportBatchStatusOptions {
  readonly selectedRowKeys: number[];
  readonly setSelectedRowKeys: (keys: number[]) => void;
  readonly mutation: { mutateAsync: (vars: { body: { ids: number[]; status: BatchStatus } }) => Promise<unknown> };
  /** 传入实体名词则弹确认框（「确认批量启用选中的 N 个数据集？」）；不传直接执行 */
  readonly confirmEntity?: string;
  /** 确认框正文，按目标状态给出 */
  readonly confirmContent?: (status: BatchStatus) => string | undefined;
}

/** 返回 `handleBatchStatus(status)`：可选确认 → 提交 → 清空选中 → Toast */
export function useReportBatchStatus({ selectedRowKeys, setSelectedRowKeys, mutation, confirmEntity, confirmContent }: UseReportBatchStatusOptions) {
  return (status: BatchStatus) => {
    if (selectedRowKeys.length === 0) return;
    const label = status === 'enabled' ? '启用' : '停用';
    const run = async () => {
      await mutation.mutateAsync({ body: { ids: selectedRowKeys, status } });
      setSelectedRowKeys([]);
      Toast.success(`批量${label}成功`);
    };
    if (!confirmEntity) return run();
    Modal.confirm({
      title: `确认批量${label}选中的 ${selectedRowKeys.length} 个${confirmEntity}？`,
      content: confirmContent?.(status),
      onOk: run,
    });
  };
}

interface ReportBatchStatusButtonsProps {
  /** 有选中行且有更新权限时才渲染 */
  readonly visible: boolean;
  readonly onChange: (status: BatchStatus) => void | Promise<void>;
}

/** 工具栏「批量启用 / 批量停用」按钮对 */
export function ReportBatchStatusButtons({ visible, onChange }: ReportBatchStatusButtonsProps) {
  if (!visible) return null;
  return (
    <>
      <Button onClick={() => void onChange('enabled')}>批量启用</Button>
      <Button type="danger" onClick={() => void onChange('disabled')}>批量停用</Button>
    </>
  );
}
