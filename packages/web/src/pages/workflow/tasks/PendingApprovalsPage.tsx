import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Descriptions,
  Form,
  Modal,
  Space,
  Steps,
  Table,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw } from 'lucide-react';
import type { WorkflowInstance, WorkflowTask, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const TASK_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  pending: { text: '待审批', color: 'blue' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  skipped: { text: '已跳过', color: 'grey' },
};

type PendingItem = WorkflowInstance & { pendingTaskId: number };

export default function PendingApprovalsPage() {
  const approveFormApi = useRef<FormApi | null>(null);
  const rejectFormApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<PendingItem> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [selectedItem, setSelectedItem] = useState<PendingItem | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);
  const [rejectVisible, setRejectVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detail, setDetail] = useState<WorkflowInstance | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
      }).toString();
      const res = await request.get<PaginatedResponse<PendingItem>>(`/api/workflows/instances/pending-mine?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const openDetail = (item: PendingItem) => {
    setDetailLoading(true);
    setDetailVisible(true);
    const p = request.get<WorkflowInstance>(`/api/workflows/instances/${item.id}`)
      .then(res => { if (res.code === 0) setDetail(res.data); })
      .finally(() => setDetailLoading(false));
    // mark as intentionally floating promise
    p.catch(() => undefined);
  };

  const handleApprove = async () => {
    if (!selectedItem) return;
    try {
      const values = await approveFormApi.current?.validate() as Record<string, unknown> | undefined;
      setSubmitting(true);
      const res = await request.post(
        `/api/workflows/tasks/${selectedItem.pendingTaskId}/approve`,
        { comment: values?.comment ?? '' }
      );
      if (res.code === 0) {
        Toast.success('审批通过');
        setApproveVisible(false);
        void fetchList();
      }
    } catch {
      // validation failed
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selectedItem) return;
    try {
      const values = await rejectFormApi.current?.validate() as Record<string, unknown>;
      setSubmitting(true);
      const res = await request.post(
        `/api/workflows/tasks/${selectedItem.pendingTaskId}/reject`,
        { comment: values.comment as string }
      );
      if (res.code === 0) {
        Toast.success('已驳回');
        setRejectVisible(false);
        void fetchList();
      }
    } catch {
      // validation failed
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnProps<PendingItem>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
    },
    {
      title: '流程名称',
      dataIndex: 'definitionName',
      width: 160,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '申请人',
      dataIndex: 'initiatorName',
      width: 120,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_: unknown, record: PendingItem) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openDetail(record)}>
            查看详情
          </Button>
          <Button
            theme="borderless"
            size="small"
            type="primary"
            onClick={() => { setSelectedItem(record); setApproveVisible(true); }}
          >
            通过
          </Button>
          <Button
            theme="borderless"
            size="small"
            type="danger"
            onClick={() => { setSelectedItem(record); setRejectVisible(true); }}
          >
            驳回
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        left={
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => void fetchList(1)}>刷新</Button>
        }
      />
      <Table
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        pagination={{
          currentPage: page,
          pageSize,
          total: data?.total ?? 0,
          onPageChange: (p) => { void fetchList(p); },
        }}
      />

      {/* 申请详情弹窗 */}
      <Modal
        title="申请详情"
        visible={detailVisible}
        onCancel={() => { setDetailVisible(false); setDetail(null); }}
        footer={null}
        style={{ width: 580 }}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>加载中...</div>
        ) : null}
        {!detailLoading && detail !== null && detail !== undefined ? (
          <div>
            <Descriptions
              data={[
                { key: '申请标题', value: detail.title },
                { key: '流程名称', value: detail.definitionName ?? '—' },
                { key: '申请人', value: detail.initiatorName ?? '—' },
                { key: '提交时间', value: formatDateTime(detail.createdAt) },
              ]}
            />
            {detail.tasks && detail.tasks.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <Typography.Title heading={6} style={{ marginBottom: 8 }}>审批流程</Typography.Title>
                <Steps direction="vertical" type="basic">
                  {detail.tasks.map((task: WorkflowTask) => {
                    const ts = TASK_STATUS_MAP[task.status];
                    const approved = task.status === 'approved';
                    const rejected = task.status === 'rejected';
                    let stepStatus: 'finish' | 'error' | 'process' = 'process';
                    if (approved) { stepStatus = 'finish'; } else if (rejected) { stepStatus = 'error'; }
                    return (
                      <Steps.Step
                        key={task.id}
                        title={task.nodeName}
                        status={stepStatus}
                        description={
                          <div>
                            <div>审批人：{task.assigneeName ?? '未指定'}</div>
                            {task.comment && <div>意见：{task.comment}</div>}
                            {task.actionAt && <div>时间：{formatDateTime(task.actionAt)}</div>}
                            <Tag color={ts?.color ?? 'grey'} style={{ marginTop: 4 }}>{ts?.text ?? task.status}</Tag>
                          </div>
                        }
                      />
                    );
                  })}
                </Steps>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* 审批通过弹窗 */}
      <Modal
        title="审批通过"
        visible={approveVisible}
        onCancel={() => setApproveVisible(false)}
        onOk={() => void handleApprove()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认通过"
        style={{ width: 440 }}
      >
        <Form getFormApi={api => { approveFormApi.current = api; }}>
          <Form.TextArea field="comment" label="审批意见（可选）" placeholder="请填写审批意见" rows={3} />
        </Form>
      </Modal>

      {/* 驳回弹窗 */}
      <Modal
        title="驳回申请"
        visible={rejectVisible}
        onCancel={() => setRejectVisible(false)}
        onOk={() => void handleReject()}
        okButtonProps={{ loading: submitting, type: 'danger' }}
        okText="确认驳回"
        style={{ width: 440 }}
      >
        <Form getFormApi={api => { rejectFormApi.current = api; }}>
          <Form.TextArea
            field="comment"
            label="驳回原因"
            placeholder="请填写驳回原因"
            rules={[{ required: true, message: '请填写驳回原因' }]}
            rows={3}
          />
        </Form>
      </Modal>
    </div>
  );
}
