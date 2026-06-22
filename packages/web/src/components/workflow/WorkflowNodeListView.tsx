/**
 * 流程节点列表 —— 线性化展示流程中所有节点，并叠加运行态（状态 + 处理人 + 时间）。
 */
import { List, Tag, Typography } from '@douyinfe/semi-ui';
import type { WorkflowTask } from '@zenith/shared';
import type { FlowNode, FlowProcess } from '@/pages/workflow/designer/types';
import { ADDABLE_NODE_TYPES } from '@/pages/workflow/designer/constants';
import { UserAvatar } from '@/components/UserAvatar';
import { formatDateTime } from '@/utils/date';
import { buildNodeRuntimeMap, NODE_RT_STATUS_LABEL, NODE_RT_STATUS_COLOR, approverActionLabel } from './workflow-runtime';

interface Props {
  flowData: { process?: unknown } | null | undefined;
  tasks?: WorkflowTask[];
  /** 实例发起人（详情场景传入真实发起人；发起预览场景传入当前用户作为预期发起人） */
  initiator?: { name?: string | null; avatar?: string | null; submittedAt?: string | null };
}

interface FlatNode {
  node: FlowNode;
  level: number;
  branchName?: string;
}

function flatten(node: FlowNode | undefined, level: number, branchName: string | undefined, out: FlatNode[]): void {
  if (!node) return;
  out.push({ node, level, branchName });
  if (node.branches?.length) {
    for (const br of node.branches) {
      flatten(br.children, level + 1, br.name, out);
    }
  }
  if (node.children) {
    flatten(node.children, level, undefined, out);
  }
}

function getNodeMeta(type: FlowNode['type']) {
  return ADDABLE_NODE_TYPES.find(n => n.type === type);
}

export default function WorkflowNodeListView({ flowData, tasks = [], initiator }: Readonly<Props>) {
  const process = flowData?.process as FlowProcess | undefined;
  if (!process?.initiator) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>
        无节点数据
      </div>
    );
  }
  const all: FlatNode[] = [];
  // initiator
  all.push({ node: process.initiator, level: 0 });
  flatten(process.initiator.children, 0, undefined, all);

  const runtime = buildNodeRuntimeMap(tasks);

  return (
    <List
      dataSource={all}
      renderItem={(item) => {
        const meta = getNodeMeta(item.node.type);
        const Icon = meta?.icon;
        const rt = runtime.get(item.node.key ?? item.node.id);
        const isCc = item.node.type === 'cc';
        const isInitiator = item.node.type === 'initiator';
        const typeLabel = isInitiator ? '发起人' : (meta?.label ?? item.node.type);
        return (
          <List.Item
            main={(
              <div style={{ paddingLeft: item.level * 16, width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {Icon ? <Icon size={14} /> : null}
                  <Typography.Text strong>{item.node.name || typeLabel}</Typography.Text>
                  {!isInitiator ? <Tag size="small" color="grey">{typeLabel}</Tag> : null}
                  {item.branchName ? <Tag size="small" color="blue">{item.branchName}</Tag> : null}
                  {rt ? (
                    <Tag size="small" color={NODE_RT_STATUS_COLOR[rt.status]} style={{ marginLeft: 'auto', flexShrink: 0 }}>
                      {NODE_RT_STATUS_LABEL[rt.status]}
                    </Tag>
                  ) : null}
                </div>
                {isInitiator ? (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <UserAvatar name={initiator?.name || '?'} avatar={initiator?.avatar ?? null} semiSize="extra-extra-small" size={18} />
                    <Typography.Text size="small" type="tertiary">{initiator?.name || '未指定'}</Typography.Text>
                    {initiator?.submittedAt ? (
                      <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto' }}>
                        {formatDateTime(initiator.submittedAt)}
                      </Typography.Text>
                    ) : null}
                  </div>
                ) : null}
                {rt && rt.approvers.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {rt.approvers.map((a, i) => (
                      <div key={`${a.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <UserAvatar
                          name={a.name || '?'}
                          avatar={a.status === 'skipped' ? null : a.avatar}
                          semiSize="extra-extra-small"
                          size={18}
                        />
                        <Typography.Text size="small" type="tertiary">{a.name || '未指定'}</Typography.Text>
                        <Tag size="small" color={NODE_RT_STATUS_COLOR[a.status]}>
                          {approverActionLabel(a.status, isCc)}
                        </Tag>
                        {a.actionAt && (
                          <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto' }}>
                            {formatDateTime(a.actionAt)}
                          </Typography.Text>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          />
        );
      }}
    />
  );
}
