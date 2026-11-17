/**
 * 审批人节点 — 直接展示的审批规则
 *
 * 不自带外层 fd-drawer-tab-content 包裹，直接内联在「审批人」面板里随主配置一起滚动。
 * 分区：审批人拒绝时 / 审批人超时未处理时 / 审批人为空时 / 审批人与提交人为同一人时 / 审批人去重。
 * 策略选项常驻可见，仅在选中对应策略或启用超时后展示附加配置。
 */
import type { ReactNode } from 'react';
import { Form, InputNumber, Select, Switch, Typography, RadioGroup, Radio } from '@douyinfe/semi-ui';
import { Minus, Plus } from 'lucide-react';
import { emptyAssigneeChoicePatch, resolveEmptyAssigneeChoice, type EmptyAssigneeChoice } from '../../assignee-props';
import type {
  RejectStrategy,
  EmptyAssigneeStrategy,
  TimeoutConfig,
  SameInitiatorStrategy,
  DeduplicateStrategy,
} from '../../types';
import {
  AUTO_DECISION_LABELS,
  REJECT_STRATEGY_OPTIONS,
  EMPTY_ASSIGNEE_OPTIONS,
  SAME_INITIATOR_OPTIONS,
  DEDUPLICATE_OPTIONS,
} from '../../constants';

interface UserOption { id: number; nickname: string; }

interface ApproverAdvancedSectionsProps {
  rejectStrategy: RejectStrategy;
  rejectToNodeKey?: string;
  availableRejectNodes?: Array<{ id: string; key?: string; name: string; type: string }>;
  emptyStrategy: EmptyAssigneeStrategy;
  emptyAssignToIds?: number[];
  sameInitiatorStrategy?: SameInitiatorStrategy;
  deduplicateStrategy?: DeduplicateStrategy;
  returnMode?: 'reexecute' | 'backToOrigin';
  catchAction?: 'toAdmin' | 'notify' | 'terminate';
  catchNotifyUserIds?: number[];
  timeout?: TimeoutConfig;
  users: UserOption[];
  onChange: (updates: Record<string, unknown>) => void;
}

/** 必填星号 */
function ReqLabel({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="fd-field-label">
      <span className="fd-field-label__req">*</span>
      {children}
    </div>
  );
}

/** 横向步进器 −/[n]/+ */
function Stepper({
  value, min, max, onChange,
}: Readonly<{ value: number; min: number; max: number; onChange: (v: number) => void }>) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="fd-stepper">
      <button
        type="button"
        className="fd-stepper__btn"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
        aria-label="减少"
      >
        <Minus size={14} />
      </button>
      <span className="fd-stepper__value">{value}</span>
      <button
        type="button"
        className="fd-stepper__btn"
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
        aria-label="增加"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export default function ApproverAdvancedSections({
  rejectStrategy,
  rejectToNodeKey,
  availableRejectNodes = [],
  emptyStrategy,
  emptyAssignToIds,
  sameInitiatorStrategy = 'autoSkip',
  deduplicateStrategy = 'inherit',
  returnMode = 'reexecute',
  catchAction,
  catchNotifyUserIds,
  timeout,
  users,
  onChange,
}: Readonly<ApproverAdvancedSectionsProps>) {

  const handleTimeoutChange = (updates: Partial<TimeoutConfig>) => {
    onChange({
      timeout: {
        enabled: false,
        duration: 6,
        unit: 'hours',
        action: 'remind',
        remindCount: 1,
        ...timeout,
        ...updates,
      },
    });
  };

  const timeoutEnabled = timeout?.enabled ?? false;
  const timeoutAction = timeout?.action ?? 'remind';
  const emptyChoice = resolveEmptyAssigneeChoice(emptyStrategy, catchAction);

  return (
    <>
      <Typography.Title heading={6} style={{ margin: '20px 0 10px' }}>审批规则</Typography.Title>
      <div className="fd-fallback-sections">
      {/* ─── 审批人拒绝时 ─────────────────────────────────────── */}
      <section className="fd-fallback-section" aria-label="审批人拒绝时">
      <div className="fd-fallback-section__title">审批人拒绝时</div>
      <RadioGroup
        value={rejectStrategy}
        onChange={(e) => onChange({ rejectStrategy: e.target.value })}
        direction="horizontal"
        className="fd-fallback-options"
        aria-label="审批人拒绝时"
      >
        {REJECT_STRATEGY_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
      </RadioGroup>
      {rejectStrategy === 'returnToNode' && (
        <div className="fd-fallback-details">
          <ReqLabel>驳回节点</ReqLabel>
          <Select
            value={rejectToNodeKey}
            onChange={(v) => onChange({ rejectToNodeKey: v })}
            style={{ width: '100%' }}
            placeholder={availableRejectNodes.length === 0 ? '当前节点之前没有可选节点' : '请选择'}
            disabled={availableRejectNodes.length === 0}
            optionList={availableRejectNodes.map((n) => ({
              value: n.key || n.id,
              label: `${n.name}（${n.type === 'approver' ? '审批人' : '办理人'}${n.key ? ` · ${n.key}` : ''}）`,
            }))}
          />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
            仅能选当前节点之前同一执行路径上的审批、办理节点
          </Typography.Text>
        </div>
      )}
      {(rejectStrategy === 'returnPrev' || rejectStrategy === 'returnToNode') && (
        <div className="fd-fallback-details">
          <div className="fd-field-label">退回后</div>
          <RadioGroup
            value={returnMode}
            onChange={(e) => onChange({ returnMode: e.target.value })}
            direction="vertical"
            className="fd-radio-list"
          >
            <Radio value="reexecute">重新执行后续路径（默认）</Radio>
            <Radio value="backToOrigin">去而复返（被退回节点通过后直接回到本节点）</Radio>
          </RadioGroup>
        </div>
      )}
      </section>

      {/* ─── 审批人超时未处理时 ───────────────────────────────── */}
      <section className="fd-fallback-section" aria-label="超时未处理">
      <div className="fd-fallback-section__header">
        <div className="fd-fallback-section__title">超时未处理</div>
        <Switch checked={timeoutEnabled} onChange={(v) => handleTimeoutChange({ enabled: v })} aria-label="启用超时处理" size="small" />
      </div>

      {timeoutEnabled && (
        <div className="fd-fallback-details" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <ReqLabel>执行动作</ReqLabel>
            <RadioGroup
              type="button"
              value={timeoutAction}
              onChange={(e) => handleTimeoutChange({ action: e.target.value as TimeoutConfig['action'] })}
              className="fd-segmented-full"
            >
              <Radio value="remind">自动提醒</Radio>
              <Radio value="autoApprove">{AUTO_DECISION_LABELS.autoApprove}</Radio>
              <Radio value="autoReject">{AUTO_DECISION_LABELS.autoReject}</Radio>
            </RadioGroup>
          </div>

          <div>
            <Typography.Text size="small" style={{ display: 'block', marginBottom: 8, color: 'var(--semi-color-text-1)' }}>
              超时时间设置
            </Typography.Text>
            <div className="fd-timeout-inline">
              <span>当超过</span>
              <InputNumber
                value={timeout?.duration ?? 6}
                onChange={(v) => handleTimeoutChange({ duration: Number(v) || 1 })}
                min={1}
                max={9999}
                style={{ width: 110 }}
              />
              <Select
                value={timeout?.unit ?? 'hours'}
                onChange={(v) => handleTimeoutChange({ unit: v as TimeoutConfig['unit'] })}
                style={{ width: 110 }}
                optionList={[
                  { value: 'minutes', label: '分钟' },
                  { value: 'hours', label: '小时' },
                  { value: 'days', label: '天' },
                ]}
              />
              <span>未处理</span>
            </div>
          </div>

          {timeoutAction === 'remind' && (
            <div>
              <ReqLabel>最大提醒次数</ReqLabel>
              <Stepper
                value={timeout?.remindCount ?? 1}
                min={1}
                max={10}
                onChange={(v) => handleTimeoutChange({ remindCount: v })}
              />
            </div>
          )}

          {timeoutAction === 'remind' && (
            <div>
              <Typography.Text size="small" style={{ display: 'block', marginBottom: 8, color: 'var(--semi-color-text-1)' }}>
                提醒耗尽后
              </Typography.Text>
              <Select
                value={timeout?.escalateAction ?? 'none'}
                onChange={(v) => handleTimeoutChange({ escalateAction: v as TimeoutConfig['escalateAction'] })}
                style={{ width: '100%' }}
                optionList={[
                  { value: 'none', label: '不处理（保持挂起，等待人工）' },
                  { value: 'autoApprove', label: AUTO_DECISION_LABELS.autoApprove },
                  { value: 'autoReject', label: AUTO_DECISION_LABELS.autoReject },
                  { value: 'transferToManager', label: '转交给上级处理' },
                ]}
              />
              {timeout?.escalateAction === 'transferToManager' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>上级层级</span>
                    <InputNumber
                      value={timeout?.escalateManagerLevel ?? 1}
                      onChange={(v) => handleTimeoutChange({ escalateManagerLevel: Number(v) || 1 })}
                      min={1}
                      max={10}
                      style={{ width: 110 }}
                      suffix="级"
                    />
                    <Typography.Text type="tertiary" size="small">1 = 直属上级</Typography.Text>
                  </div>
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
                    找不到指定上级时会依次尝试部门负责人、系统管理员。
                  </Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <div className="fd-field-label">仍无人可转时</div>
                    <Select
                      value={timeout?.escalateFallbackAction ?? 'none'}
                      onChange={(v) => handleTimeoutChange({ escalateFallbackAction: v as TimeoutConfig['escalateFallbackAction'] })}
                      style={{ width: '100%' }}
                      optionList={[
                        { value: 'none', label: '保持挂起（停止重复扫描）' },
                        { value: 'autoApprove', label: AUTO_DECISION_LABELS.autoApprove },
                        { value: 'autoReject', label: AUTO_DECISION_LABELS.autoReject },
                      ]}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </section>

      {/* ─── 审批人为空时 ─────────────────────────────────────── */}
      <section className="fd-fallback-section" aria-label="审批人为空时">
      <div className="fd-fallback-section__title">审批人为空时</div>
      <RadioGroup
        value={emptyChoice}
        onChange={(e) => onChange(emptyAssigneeChoicePatch(e.target.value as EmptyAssigneeChoice, catchAction))}
        direction="horizontal"
        className="fd-fallback-options"
        aria-label="审批人为空时"
      >
        {EMPTY_ASSIGNEE_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
        <Radio value="notify">通知后自动通过</Radio>
      </RadioGroup>
      {emptyChoice === 'assignTo' && (
        <div className="fd-fallback-details">
          <Form.Slot label="转交给（可多选，多人时生成会签任务）">
            <Select
              value={emptyAssignToIds ?? []}
              onChange={(v) => {
                const ids = Array.isArray(v) ? (v as number[]) : [];
                const names = ids.map((id) => users.find((u) => u.id === id)?.nickname ?? '').filter(Boolean);
                onChange({
                  emptyAssignToIds: ids,
                  emptyAssignToNames: names,
                });
              }}
              multiple
              maxTagCount={2}
              showRestTagsPopover
              filter
              style={{ width: '100%' }}
              placeholder="请选择转交人员"
              optionList={users.map((u) => ({ value: u.id, label: u.nickname }))}
            />
          </Form.Slot>
        </div>
      )}

        {emptyChoice === 'notify' && (
          <div className="fd-fallback-details">
            <div className="fd-field-label">通知人</div>
            <Select
              multiple
              filter
              style={{ width: '100%' }}
              maxTagCount={2} showRestTagsPopover
              placeholder="不选则通知发起人与管理员"
              value={catchNotifyUserIds ?? []}
              onChange={(v) => onChange({ catchNotifyUserIds: (v as number[]) ?? [] })}
              optionList={users.map((u) => ({ value: u.id, label: u.nickname }))}
            />
          </div>
        )}
      </section>

      {/* ─── 审批人与提交人为同一人时 ─────────────────────────── */}
      <section className="fd-fallback-section" aria-label="与提交人同一人">
      <div className="fd-fallback-section__title">与提交人同一人</div>
      <RadioGroup
        value={sameInitiatorStrategy}
        onChange={(e) => onChange({ sameInitiatorStrategy: e.target.value })}
        direction="horizontal"
        className="fd-fallback-options"
        aria-label="与提交人同一人"
      >
        {SAME_INITIATOR_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
      </RadioGroup>
      </section>

      {/* ─── 审批人去重 ───────────────────────────────────────── */}
      <section className="fd-fallback-section" aria-label="审批人去重">
      <div className="fd-fallback-section__title">审批人去重</div>
      <RadioGroup
        value={deduplicateStrategy}
        onChange={(e) => onChange({ deduplicateStrategy: e.target.value })}
        direction="vertical"
        className="fd-fallback-options"
        aria-label="审批人去重"
      >
        {DEDUPLICATE_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.value === 'autoSkip' ? '后续节点自动通过' : o.label}</Radio>
        ))}
      </RadioGroup>
      </section>
      </div>
    </>
  );
}
