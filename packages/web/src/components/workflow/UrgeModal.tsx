import { useMemo } from 'react';
import { Banner, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import type { WorkflowTaskUrge, WorkflowUrgeResult, WorkflowUrgeSkipped } from '@zenith/shared/workflow';

export interface UrgeTarget {
  taskId: number;
  assigneeId: number | null;
  assigneeName: string | null;
  nodeName: string | null;
  instanceTitle?: string | null;
}

export interface UrgeModalProps {
  visible: boolean;
  title?: string;
  targets?: UrgeTarget[];
  message: string;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  confirmLoading?: boolean;
  /** 发送后的统一结果；存在时弹窗切换为结果态 */
  result?: WorkflowUrgeResult | null;
}

interface PersonSummary {
  key: string;
  name: string;
  nodes: Set<string>;
  count: number;
}

const SKIP_REASON_LABELS: Record<WorkflowUrgeSkipped['reason'], string> = {
  cooldown: '5 分钟内已催办',
  notPending: '任务已处理',
  noAssignee: '没有处理人',
};

function summarizePeople(rows: readonly WorkflowTaskUrge[]): PersonSummary[] {
  const map = new Map<string, PersonSummary>();
  for (const row of rows) {
    const key = row.assigneeId != null ? `user:${row.assigneeId}` : `task:${row.taskId}`;
    const current = map.get(key) ?? {
      key,
      name: row.assigneeName ?? (row.assigneeId != null ? `用户 #${row.assigneeId}` : '未命名处理人'),
      nodes: new Set<string>(),
      count: 0,
    };
    current.count += 1;
    if (row.nodeName) current.nodes.add(row.nodeName);
    map.set(key, current);
  }
  return [...map.values()];
}

function TargetList({ targets }: Readonly<{ targets: UrgeTarget[] }>) {
  if (targets.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <Typography.Text type="tertiary" size="small">将向以下 {targets.length} 个待办的处理人发送催办：</Typography.Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {targets.map((target) => (
          <Tag key={target.taskId} size="small" color="blue">
            {target.assigneeName ?? '未指定处理人'}{target.nodeName ? ` · ${target.nodeName}` : ''}
          </Tag>
        ))}
      </div>
    </div>
  );
}

function UrgeResultView({ result }: Readonly<{ result: WorkflowUrgeResult }>) {
  const people = useMemo(() => summarizePeople(result.urged), [result.urged]);
  return (
    <div>
      <Banner type="success" description={result.message} closeIcon={null} style={{ marginBottom: 12 }} />
      {people.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong size="small">已催办</Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {people.map((person) => (
              <Tag key={person.key} size="small" color="green">
                {person.name}
                {person.nodes.size > 0 ? ` · ${[...person.nodes].join('、')}` : ''}
                {person.count > 1 ? `（${person.count} 个待办）` : ''}
              </Tag>
            ))}
          </div>
        </div>
      )}
      {result.skipped.length > 0 && (
        <div>
          <Typography.Text strong size="small">未发送</Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {result.skipped.map((row) => (
              <Tag key={`${row.taskId}-${row.reason}`} size="small" color="orange">
                {row.assigneeName ?? `任务 #${row.taskId}`}{row.nodeName ? ` · ${row.nodeName}` : ''}：{SKIP_REASON_LABELS[row.reason]}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 统一催办弹窗：发送前展示待办人 / 节点，发送后展示已催办与跳过名单。
 * 所有催办入口共用，避免每个页面各写一套确认框和 Toast。
 */
export default function UrgeModal({
  visible,
  title = '催办',
  targets = [],
  message,
  onMessageChange,
  onSubmit,
  onClose,
  confirmLoading = false,
  result = null,
}: Readonly<UrgeModalProps>) {
  return (
    <AppModal
      title={title}
      visible={visible}
      onCancel={onClose}
      onOk={result ? onClose : onSubmit}
      confirmLoading={confirmLoading}
      okText={result ? '关闭' : '发送催办'}
      cancelText="取消"
      cancelButtonProps={result ? { style: { display: 'none' } } : undefined}
      width={560}
    >
      {result ? (
        <UrgeResultView result={result} />
      ) : (
        <>
          <Typography.Text type="tertiary" size="small">
            将对当前范围内的待办人发起催办；同一人多个待办只发一次通知，5 分钟内已催办过的待办会跳过。
          </Typography.Text>
          <TargetList targets={targets} />
          <TextArea
            value={message}
            onChange={onMessageChange}
            placeholder="可选留言（最多 256 个字符）"
            maxLength={256}
            rows={3}
            style={{ marginTop: 12 }}
          />
        </>
      )}
    </AppModal>
  );
}
