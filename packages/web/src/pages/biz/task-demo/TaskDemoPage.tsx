/**
 * 业务接入示例：异步任务（演示业务模块如何对接任务中心）
 *
 * 演示标准三步：① 后端 registerTaskHandler 注册任务类型（routes/task-demo.ts）；
 * ② 业务接口调用 submitAsyncTask 提交任务（写 async_tasks + 入 pg-boss 队列）；
 * ③ 前端 useMyAsyncTasks 实时展示进度（WS 推送 + 轮询兜底），支持取消 / 断点恢复 / 重新开始。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Banner, Button, Collapse, InputNumber, Modal, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Info, Play, RefreshCw } from 'lucide-react';
import type { AsyncTask, AsyncTaskStatus, AsyncTaskTypeMeta } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { formatDateTime } from '@/utils/date';

const DEMO_TASK_TYPES = ['demo-batch', 'demo-serial'];

const statusTagMap = {
  pending: { color: 'blue', label: '排队中' },
  running: { color: 'cyan', label: '执行中' },
  success: { color: 'green', label: '已完成' },
  failed: { color: 'red', label: '失败' },
  cancelled: { color: 'grey', label: '已取消' },
} as const satisfies Record<AsyncTaskStatus, { color: 'blue' | 'cyan' | 'green' | 'red' | 'grey'; label: string }>;

const codeStyle: CSSProperties = {
  background: 'var(--semi-color-fill-0)', borderRadius: 6, padding: 12, margin: 0,
  overflowX: 'auto', fontSize: 12, lineHeight: 1.6,
  fontFamily: 'var(--semi-font-family-mono, ui-monospace, monospace)',
};

const bannerStyle: CSSProperties = {
  marginBottom: 12,
  background: 'var(--semi-color-primary-light-default)',
  borderColor: 'var(--semi-color-primary-light-active)',
  color: 'var(--semi-color-primary)',
};

const SNIPPET_REGISTER = `// 后端 · 注册任务类型（启动时执行一次，routes/task-demo.ts）
registerTaskHandler({
  taskType: 'demo-batch',
  title: '批量处理演示',
  module: '业务示例',
  allowConcurrent: true,          // false = 同一用户存在未结束任务时拒绝重复提交
  async run(ctx) {
    let processed = Number(ctx.checkpoint?.processed ?? 0);   // 断点恢复：跳过已处理条目
    for (let i = processed + 1; i <= total; i++) {
      await handleOneItem(i);                                 // 业务处理
      processed = i;
      const { cancelRequested } = await ctx.progress({        // 进度 + 断点 + 心跳 + WS 推送
        processed, total,
        note: \`已处理 \${processed}/\${total} 条\`,
        checkpoint: { processed },
      });
      if (cancelRequested) return;                            // 协作式取消
    }
    return { processed };                                     // 写入 result 字段
  },
});`;

const SNIPPET_SUBMIT = `// 后端 · 业务接口中提交任务（HTTP 上下文内）
const row = await submitAsyncTask({
  taskType: 'demo-batch',
  title: '批量处理演示（500 条）',
  payload: { totalItems: 500, itemDelayMs: 100 },
});
// 前端 · 实时进度（WS 推送 + 轮询兜底）
const { tasks, refresh } = useMyAsyncTasks({ taskTypes: ['demo-batch'] });`;

export default function TaskDemoPage() {
  const [taskType, setTaskType] = useState<'demo-batch' | 'demo-serial'>('demo-batch');
  const [totalItems, setTotalItems] = useState(60);
  const [itemDelayMs, setItemDelayMs] = useState(300);
  const [failAtItem, setFailAtItem] = useState<number | null>(null);
  const [stageDelayMs, setStageDelayMs] = useState(4000);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [types, setTypes] = useState<AsyncTaskTypeMeta[]>([]);

  const { tasks, loading, refresh } = useMyAsyncTasks({ taskTypes: DEMO_TASK_TYPES });

  useEffect(() => {
    void request.get<AsyncTaskTypeMeta[]>('/api/async-tasks/types', { silent: true }).then((res) => {
      if (res.code === 0) setTypes(res.data.filter((t) => DEMO_TASK_TYPES.includes(t.taskType)));
    });
  }, []);

  const currentTypeMeta = types.find((t) => t.taskType === taskType);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body = taskType === 'demo-batch'
        ? { taskType, totalItems, itemDelayMs, ...(failAtItem ? { failAtItem } : {}) }
        : { taskType, stageDelayMs };
      const res = await request.post<AsyncTask>('/api/task-demo/submit', body);
      if (res.code === 0) {
        Toast.success('任务已提交，可在下方列表查看实时进度');
        void refresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (record: AsyncTask, action: 'cancel' | 'resume' | 'restart', successMsg: string) => {
    setActionLoadingId(record.id);
    try {
      const res = await request.post<AsyncTask>(`/api/async-tasks/${record.id}/${action}`);
      if (res.code === 0) {
        Toast.success(successMsg);
        void refresh();
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleShowResult = (record: AsyncTask) => {
    Modal.info({
      title: `任务结果 #${record.id}`,
      content: (
        <pre style={codeStyle}>{JSON.stringify(record.result ?? record.errorMessage ?? '-', null, 2)}</pre>
      ),
      okText: '知道了',
    });
  };

  const columns: ColumnProps<AsyncTask>[] = [
    { title: '任务ID', dataIndex: 'id', width: 80 },
    { title: '任务', dataIndex: 'title', width: 210, render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
    {
      title: '类型',
      dataIndex: 'taskType',
      width: 130,
      render: (value: string) => <Tag color={value === 'demo-batch' ? 'blue' : 'purple'}>{value}</Tag>,
    },
    { title: '进度', dataIndex: 'processedCount', width: 220, render: (_: number, record: AsyncTask) => <AsyncTaskProgress task={record} /> },
    { title: '执行次数', dataIndex: 'attempts', width: 90 },
    { title: '提交时间', dataIndex: 'createdAt', width: 170, render: (value: string) => formatDateTime(value) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (value: AsyncTaskStatus, record: AsyncTask) => {
        const meta = statusTagMap[value];
        return value === 'running' && record.cancelRequested
          ? <Tag color="orange">取消中</Tag>
          : <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    createOperationColumn<AsyncTask>({
      width: 220,
      desktopInlineKeys: ['cancel', 'resume', 'restart'],
      actions: (record) => [
        {
          key: 'cancel',
          label: '取消',
          hidden: !['pending', 'running'].includes(record.status),
          loading: actionLoadingId === record.id,
          disabled: record.cancelRequested,
          disabledReason: '已请求取消，等待任务退出',
          onClick: () => void runAction(record, 'cancel', '已请求取消'),
        },
        {
          key: 'resume',
          label: '断点恢复',
          hidden: !['failed', 'cancelled'].includes(record.status),
          loading: actionLoadingId === record.id,
          onClick: () => void runAction(record, 'resume', '已从断点恢复，将从中断处继续'),
        },
        {
          key: 'restart',
          label: '重新开始',
          hidden: !['success', 'failed', 'cancelled'].includes(record.status),
          loading: actionLoadingId === record.id,
          onClick: () => void runAction(record, 'restart', '已重新开始（进度清零）'),
        },
        {
          key: 'result',
          label: '查看结果',
          hidden: record.status !== 'success' && !record.errorMessage,
          onClick: () => handleShowResult(record),
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <Banner
        fullMode={false}
        icon={<Info size={16} />}
        style={bannerStyle}
        description={
          <span>
            演示业务模块如何对接<strong>任务中心</strong>：提交长耗时批量任务 → 实时进度（WS 推送 + 轮询兜底）→ 取消 / 断点恢复 / 重新开始。
            「批量处理演示」可配置失败点，失败后用「断点恢复」从中断处继续；「串行阶段演示」不允许重复提交（存在未结束任务时提交会被拒绝）。
            管理员可在 系统设置 → 任务中心 全局监控所有任务。
          </span>
        }
      />

      <SearchToolbar>
        <Select
          value={taskType}
          onChange={(value) => setTaskType(value as 'demo-batch' | 'demo-serial')}
          optionList={[
            { value: 'demo-batch', label: '批量处理演示（可并发）' },
            { value: 'demo-serial', label: '串行阶段演示（不可重复提交）' },
          ]}
          style={{ width: 230 }}
        />
        {taskType === 'demo-batch' ? (
          <>
            <InputNumber prefix="总条数" value={totalItems} min={1} max={10000} onNumberChange={(v) => setTotalItems(v || 60)} style={{ width: 150 }} />
            <InputNumber prefix="单条耗时(ms)" value={itemDelayMs} min={10} max={5000} step={50} onNumberChange={(v) => setItemDelayMs(v || 300)} style={{ width: 180 }} />
            <InputNumber
              prefix="失败点(可选)"
              value={failAtItem ?? undefined}
              min={1}
              max={10000}
              placeholder="第 N 条失败"
              onChange={(v) => setFailAtItem(typeof v === 'number' ? v : null)}
              style={{ width: 180 }}
            />
          </>
        ) : (
          <InputNumber prefix="阶段耗时(ms)" value={stageDelayMs} min={500} max={30000} step={500} onNumberChange={(v) => setStageDelayMs(v || 4000)} style={{ width: 190 }} />
        )}
        <Button type="primary" icon={<Play size={14} />} loading={submitting} onClick={() => void handleSubmit()}>提交任务</Button>
        <Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => void refresh()}>刷新</Button>
        {currentTypeMeta && !currentTypeMeta.allowConcurrent && (
          <Typography.Text type="tertiary" size="small">该类型不允许重复提交：存在未结束任务时会被拒绝</Typography.Text>
        )}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={tasks}
        loading={loading}
        onRefresh={() => void refresh()}
        refreshLoading={loading}
        pagination={false}
        rowKey="id"
        size="small"
        empty="暂无任务，先在上方提交一个演示任务"
        scroll={{ x: 1220 }}
      />

      <Collapse style={{ marginTop: 16 }}>
        <Collapse.Panel header="接入代码示例（业务模块如何对接任务中心）" itemKey="code">
          <Typography.Title heading={6} style={{ margin: '8px 0' }}>① 注册任务类型（含断点续跑 / 协作式取消）</Typography.Title>
          <pre style={codeStyle}>{SNIPPET_REGISTER}</pre>
          <Typography.Title heading={6} style={{ margin: '16px 0 8px' }}>② 提交任务 & ③ 前端实时进度</Typography.Title>
          <pre style={codeStyle}>{SNIPPET_SUBMIT}</pre>
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}
