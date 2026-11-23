import { Tag } from '@douyinfe/semi-ui';
import type { WorkflowRuntimeDiagnostics } from '@zenith/shared/workflow';
import { UserAvatar } from '@/components/UserAvatar';
import { INSTANCE_STATUS_MAP, NODE_RT_STATUS_LABEL } from '@/components/workflow/workflow-runtime';
import { formatSecondsBetween } from '@/utils/format';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { WORKFLOW_ISSUE_SEVERITY_META } from './constants';
import { buildFocusDiagnosis, ISSUE_SOURCE_MAP, type DiagNode } from './diagnostics-model';
import './WorkflowDiagnosticsSummary.css';

interface WorkflowDiagnosticsSummaryProps {
  diagnostics: WorkflowRuntimeDiagnostics;
  nodes: DiagNode[];
}

const VISIBLE_ACTIVE_TASKS = 3;

export default function WorkflowDiagnosticsSummary({
  diagnostics,
  nodes,
}: WorkflowDiagnosticsSummaryProps) {
  const { instance, generatedAt, issues } = diagnostics;
  const status = INSTANCE_STATUS_MAP[instance.status] ?? { text: instance.status, color: 'grey' as const };
  const focus = buildFocusDiagnosis(diagnostics, nodes);
  const activeTasks = focus.activeTasks.slice(0, VISIBLE_ACTIVE_TASKS);
  const remainingTasks = focus.activeTasks.length - VISIBLE_ACTIVE_TASKS;
  const currentNode = instance.currentNodeNames?.length
    ? instance.currentNodeNames.join('、')
    : instance.currentNodeName;
  const showFocusTitle = focus.title !== currentNode;
  const longestStay = focus.longestStay;
  const separateLongestStay = longestStay && !activeTasks.some((task) => task.id === longestStay.taskId);
  const checks = issues.filter((issue) => issue.severity === 'info');
  const problems = issues.filter((issue) => issue.severity !== 'info');
  const businessKey = instance.bizType && instance.bizId
    ? `${instance.bizType}:${instance.bizId}`
    : EMPTY_PLACEHOLDER;

  return (
    <div className="workflow-diagnostics-summary">
      <div className="workflow-diagnostics-summary__title">
        <h3>{instance.definitionName || EMPTY_PLACEHOLDER}</h3>
        <Tag size="small" color={status.color}>{status.text}</Tag>
      </div>
      <dl className="workflow-diagnostics-summary__instance">
        <div><dt>当前节点</dt><dd>{currentNode || EMPTY_PLACEHOLDER}</dd></div>
        <div>
          <dt>发起人</dt>
          <dd className="workflow-diagnostics-summary__person">
            {instance.initiatorName && (
              <UserAvatar name={instance.initiatorName} avatar={instance.initiatorAvatar} size={16} />
            )}
            <span>{instance.initiatorName || EMPTY_PLACEHOLDER}</span>
          </dd>
        </div>
        <div><dt>实例 ID</dt><dd>#{instance.id}</dd></div>
        <div><dt>定义 ID</dt><dd>#{instance.definitionId}</dd></div>
        <div>
          <dt>节点 / 任务</dt>
          <dd>{nodes.length} 节点 · {diagnostics.tasks.length} 任务（{focus.activeTasks.length} 活动）</dd>
        </div>
        <div><dt>Business Key</dt><dd>{businessKey}</dd></div>
        <div><dt>生成时间</dt><dd>{generatedAt}</dd></div>
      </dl>

      <section aria-label="诊断摘要" className="workflow-diagnostics-summary__diagnosis">
        {showFocusTitle && <h4>{focus.title}</h4>}
        {focus.description && <p>{focus.description}</p>}
        {focus.risks.length > 0 && (
          <p><span className="workflow-diagnostics-summary__muted">风险</span> {focus.risks.join(' · ')}</p>
        )}
        {activeTasks.map((task, index) => {
          const nodeName = task.nodeName || task.nodeKey;
          const assigneeSource = index === 0 && focus.assigneeSource;
          const waitNotes = [
            index === 0 && focus.waitingRisk,
            task.id === longestStay?.taskId && '最久停留',
          ].filter(Boolean).join('、');

          return (
            <div key={task.id} className="workflow-diagnostics-summary__facts">
              <span>任务 #{task.id} · {NODE_RT_STATUS_LABEL[task.status]}</span>
              {(index > 0 || nodeName !== focus.title) && <span>{nodeName}</span>}
              <span>
                <span className="workflow-diagnostics-summary__muted">处理人</span>{' '}
                {task.assigneeName || '未指定'}{assigneeSource && `（${assigneeSource}）`}
              </span>
              <span>
                <span className="workflow-diagnostics-summary__muted">已等待</span>{' '}
                {formatSecondsBetween(task.createdAt, generatedAt)}{waitNotes && `（${waitNotes}）`}
              </span>
            </div>
          );
        })}
        {remainingTasks > 0 && (
          <p className="workflow-diagnostics-summary__muted">
            另有 {remainingTasks} 个活动任务，可在「任务」页签查看。
          </p>
        )}
        {separateLongestStay && (
          <p>
            <span className="workflow-diagnostics-summary__muted">最久停留</span>{' '}
            {longestStay.nodeName} · 任务 #{longestStay.taskId} · {longestStay.duration}
          </p>
        )}
        <div className="workflow-diagnostics-summary__facts">
          <span>
            <span className="workflow-diagnostics-summary__muted">外部事件</span>{' '}
            {diagnostics.triggerExecutions.length} 触发器 · {diagnostics.outboxEvents.length} 事件派发 · {focus.failedEventCount} 失败
          </span>
          {checks.map((issue, index) => (
            <span
              key={`${issue.title}-${index}`}
              className="workflow-diagnostics-summary__muted"
              title={issue.description}
            >
              {issue.title}
            </span>
          ))}
        </div>
        {problems.map((issue, index) => {
          const severity = WORKFLOW_ISSUE_SEVERITY_META[issue.severity];
          const nodeName = issue.nodeKey && (nodes.find((node) => node.key === issue.nodeKey)?.name ?? issue.nodeKey);
          const context = [
            ISSUE_SOURCE_MAP[issue.source],
            issue.taskId != null && `任务 #${issue.taskId}`,
            nodeName,
          ].filter(Boolean).join(' · ');
          return (
            <div key={`${issue.source}-${issue.title}-${index}`} className="workflow-diagnostics-summary__issue">
              <div className="workflow-diagnostics-summary__facts">
                <span>{severity.text} · {issue.title}</span>
                <span className="workflow-diagnostics-summary__muted">{context}</span>
              </div>
              <p className="workflow-diagnostics-summary__muted">{issue.description}</p>
            </div>
          );
        })}
        {focus.nextAction && (
          <p><span className="workflow-diagnostics-summary__muted">建议</span> {focus.nextAction}</p>
        )}
      </section>
    </div>
  );
}
