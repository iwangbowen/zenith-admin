/**
 * 通用导入按钮（与 ExportButton 对偶）。
 *
 * 交互：下载模板 / 选择 xlsx → 上传文件中心 → 提交导入任务 → 进度弹窗
 * （轮询任务 + 行级成败明细），全程不离开当前页面。
 * 完成后触发 onFinished（调用方失效列表查询）。
 *
 * ImportProgressModal 为独立受控组件，导入中心页复用它展示任意导入任务详情。
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Modal, Table, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ChevronDown, Upload } from 'lucide-react';
import type { AsyncTaskItem } from '@zenith/shared/tasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { useAsyncTaskItems } from '@/hooks/queries/async-tasks';
import { downloadImportTemplate, useImportTaskPolling } from '@/hooks/queries/import-jobs';
import { useImportUpload } from '@/hooks/useImportUpload';

const { Text } = Typography;

const ITEM_STATUS_META = {
  success: { label: '成功', color: 'green' },
  failed: { label: '失败', color: 'red' },
  skipped: { label: '跳过', color: 'grey' },
} as const;

interface ImportProgressModalProps {
  /** 导入任务 ID，null 时不显示 */
  taskId: number | null;
  /** 弹窗标题前缀（实体名） */
  title: string;
  onClose: () => void;
  /** 任务到达终态时回调一次（成功与否都触发，调用方刷新列表） */
  onFinished?: () => void;
}

/** 导入任务进度弹窗：轮询任务 + 行级明细 + 错误行文件下载 */
export function ImportProgressModal({ taskId, title, onClose, onFinished }: Readonly<ImportProgressModalProps>) {
  const [itemPage, setItemPage] = useState(1);
  const finishedNotified = useRef(false);

  const taskQuery = useImportTaskPolling(taskId);
  const task = taskQuery.data ?? null;
  const isTerminal = task ? ['success', 'failed', 'cancelled'].includes(task.status) : false;
  const itemsQuery = useAsyncTaskItems({ taskId: taskId ?? 0, page: itemPage, pageSize: 8 }, taskId !== null);

  // 行级明细跟随任务进度刷新（items 查询本身无轮询）
  const processedCount = task?.processedCount ?? 0;
  const refetchItems = itemsQuery.refetch;
  useEffect(() => {
    if (taskId !== null) void refetchItems();
  }, [taskId, processedCount, refetchItems]);

  // 换任务时重置分页与终态通知标记
  useEffect(() => {
    setItemPage(1);
    finishedNotified.current = false;
  }, [taskId]);

  // 终态回调（一次性）：调用方借此刷新业务列表
  useEffect(() => {
    if (isTerminal && !finishedNotified.current) {
      finishedNotified.current = true;
      onFinished?.();
    }
  }, [isTerminal, onFinished]);

  /** 错误行文件下载（handler 生成，含错误原因列，修正后可回导） */
  async function downloadErrorFile() {
    const result = task?.result as { errorFileId?: string | null } | null;
    if (!result?.errorFileId) return;
    const { getFileAccessUrl } = await import('@/hooks/queries/files');
    const access = await getFileAccessUrl(result.errorFileId, 'download');
    globalThis.open(access.url, '_blank');
  }

  const itemColumns: ColumnProps<AsyncTaskItem>[] = [
    { title: '行', dataIndex: 'itemKey', width: 80 },
    { title: '内容', dataIndex: 'label', width: 160, ellipsis: true },
    {
      title: '结果', dataIndex: 'status', width: 80,
      render: (v: AsyncTaskItem['status']) => {
        const meta = ITEM_STATUS_META[v as keyof typeof ITEM_STATUS_META] ?? { label: v, color: 'grey' as const };
        return <Tag size="small" color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '说明', dataIndex: 'message', width: 220, ellipsis: { showTitle: false },
      render: (v: string | null) => v ? <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }} size="small">{v}</Text> : '—',
    },
  ];

  return (
    <Modal
      title={`${title}导入`}
      visible={taskId !== null}
      onCancel={onClose}
      footer={<Button type="primary" onClick={onClose}>{isTerminal ? '完成' : '后台运行'}</Button>}
      width={640}
      maskClosable={false}
    >
      {task && (() => {
        const result = task.result as { errorFileId?: string | null } | null;
        const isDryRun = Boolean((task.payload as { dryRun?: boolean } | null)?.dryRun);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            {isDryRun && <Text type="warning" size="small">预检模式：仅校验数据，不写入任何记录。</Text>}
            <AsyncTaskProgress task={task} fluid />
            {task.errorMessage && <Text type="danger" size="small">{task.errorMessage}</Text>}
            {isTerminal && result?.errorFileId && (
              <Button theme="light" type="danger" onClick={() => void downloadErrorFile()}>
                下载错误行文件（修正后可重新上传）
              </Button>
            )}
            <Table
              columns={itemColumns}
              dataSource={itemsQuery.data?.list ?? []}
              loading={itemsQuery.isFetching && !itemsQuery.data}
              rowKey="id"
              size="small"
              empty="暂无行级明细"
              pagination={{
                currentPage: itemPage,
                pageSize: 8,
                total: itemsQuery.data?.total ?? 0,
                onPageChange: setItemPage,
              }}
            />
            <Text type="tertiary" size="small">
              可关闭本窗口后台运行，稍后在「任务中心」查看进度与全部明细。
            </Text>
          </div>
        );
      })()}
    </Modal>
  );
}

interface ImportButtonProps {
  /** 导入实体标识（服务端 Definition 的 entity），如 'member.members' */
  entity: string;
  /** 实体名（按钮文案与模板文件名） */
  title: string;
  label?: string;
  /** 实体上下文参数（如 CMS 内容导入的 siteId/channelId），随任务提交 */
  context?: Record<string, unknown>;
  /** 提交前校验（如未选栏目时阻止），返回 false 取消 */
  beforeSubmit?: () => boolean;
  /** 导入任务终态后回调（成功与否都触发，调用方刷新列表） */
  onFinished?: () => void;
}

export function ImportButton({ entity, title, label = '导入', context, beforeSubmit, onFinished }: Readonly<ImportButtonProps>) {
  const [taskId, setTaskId] = useState<number | null>(null);
  const { fileInput, pickFile, submitting } = useImportUpload({
    resolveTarget: () => (beforeSubmit && !beforeSubmit() ? null : { entity, context }),
    onSubmitted: (task) => setTaskId(task.id),
  });

  return (
    <>
      {fileInput}
      <Dropdown
        trigger="click"
        position="bottomLeft"
        clickToHide
        render={(
          <Dropdown.Menu>
            <Dropdown.Item onClick={() => pickFile(false)}>上传文件导入</Dropdown.Item>
            <Dropdown.Item onClick={() => pickFile(true)}>预检文件（仅校验不落库）</Dropdown.Item>
            <Dropdown.Item onClick={() => void downloadImportTemplate(entity, title)}>下载导入模板</Dropdown.Item>
          </Dropdown.Menu>
        )}
      >
        <Button
          icon={<Upload size={14} />}
          iconPosition="left"
          loading={submitting}
        >
          {label} <ChevronDown size={12} style={{ verticalAlign: 'middle' }} />
        </Button>
      </Dropdown>

      <ImportProgressModal taskId={taskId} title={title} onClose={() => setTaskId(null)} onFinished={onFinished} />
    </>
  );
}

export default ImportButton;
