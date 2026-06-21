/**
 * 审批人节点 — 高级分区（钉钉/飞书式单面板布局）
 *
 * 不自带外层 fd-drawer-tab-content 包裹，直接内联在「审批人」面板里随主配置一起滚动。
 * 分区：审批人拒绝时 / 审批人超时未处理时 / 审批人为空时 / 审批人与提交人为同一人时 / 审批人去重
 */
import type { ReactNode } from 'react';
import { Form, InputNumber, Select, Switch, Typography, RadioGroup, Radio } from '@douyinfe/semi-ui';
import { Minus, Plus } from 'lucide-react';
import type {
  RejectStrategy,
  EmptyAssigneeStrategy,
  TimeoutConfig,
  SameInitiatorStrategy,
  DeduplicateStrategy,
} from '../../types';
import {
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
  emptyAssignTo?: number;
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

/** 钉钉式分区标题：短线 + 标题 + 长线 */
function SectionDivider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="fd-section-divider">
      <span className="fd-section-divider__label">{children}</span>
    </div>
  );
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
  emptyAssignTo,
  emptyAssignToIds,
  sameInitiatorStrategy = 'selfApprove',
  deduplicateStrategy = 'autoSkip',
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

  return (
    <>
      {/* ─── 审批人拒绝时 ─────────────────────────────────────── */}
      <SectionDivider>审批人拒绝时</SectionDivider>
      <RadioGroup
        value={rejectStrategy}
        onChange={(e) => onChange({ rejectStrategy: e.target.value })}
        direction="vertical"
        className="fd-radio-list"
      >
        {REJECT_STRATEGY_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
      </RadioGroup>
      {rejectStrategy === 'returnToNode' && (
        <div style={{ marginTop: 4, marginBottom: 8 }}>
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
        <div style={{ marginTop: 4, marginBottom: 8 }}>
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

      {/* ─── 审批人超时未处理时 ───────────────────────────────── */}
      <SectionDivider>审批人超时未处理时</SectionDivider>
      <ReqLabel>启用开关</ReqLabel>
      <div className="fd-switch-row">
        <span className={`fd-switch-row__txt ${!timeoutEnabled ? 'fd-switch-row__txt--active' : ''}`}>关闭</span>
        <Switch checked={timeoutEnabled} onChange={(v) => handleTimeoutChange({ enabled: v })} />
        <span className={`fd-switch-row__txt ${timeoutEnabled ? 'fd-switch-row__txt--active' : ''}`}>开启</span>
      </div>

      {timeoutEnabled && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <ReqLabel>执行动作</ReqLabel>
            <RadioGroup
              type="button"
              value={timeoutAction}
              onChange={(e) => handleTimeoutChange({ action: e.target.value as TimeoutConfig['action'] })}
              className="fd-segmented-full"
            >
              <Radio value="remind">自动提醒</Radio>
              <Radio value="autoApprove">自动同意</Radio>
              <Radio value="autoReject">自动拒绝</Radio>
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
                  { value: 'autoApprove', label: '自动同意' },
                  { value: 'autoReject', label: '自动拒绝' },
                  { value: 'transferToManager', label: '转交给上级处理' },
                ]}
              />
              {timeout?.escalateAction === 'transferToManager' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
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
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── 审批人为空时 ─────────────────────────────────────── */}
      <SectionDivider>审批人为空时</SectionDivider>
      <RadioGroup
        value={emptyStrategy}
        onChange={(e) => onChange({ emptyStrategy: e.target.value })}
        direction="vertical"
        className="fd-radio-list"
      >
        {EMPTY_ASSIGNEE_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
      </RadioGroup>
      {emptyStrategy === 'assignTo' && (
        <div style={{ marginTop: 4, marginBottom: 8 }}>
          <Form.Slot label="转交给（可多选，多人时生成会签任务）">
            <Select
              value={(emptyAssignToIds && emptyAssignToIds.length > 0)
                ? emptyAssignToIds
                : (emptyAssignTo ? [emptyAssignTo] : [])}
              onChange={(v) => {
                const ids = Array.isArray(v) ? (v as number[]) : [];
                const names = ids.map((id) => users.find((u) => u.id === id)?.nickname ?? '').filter(Boolean);
                onChange({
                  emptyAssignToIds: ids,
                  emptyAssignToNames: names,
                  emptyAssignTo: ids[0],
                  emptyAssignToName: names[0],
                });
              }}
              multiple
              filter
              style={{ width: '100%' }}
              placeholder="请选择转交人员"
              optionList={users.map((u) => ({ value: u.id, label: u.nickname }))}
            />
          </Form.Slot>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <div className="fd-field-label">异常兜底（审批人为空时的额外处理）</div>
        <Select
          value={catchAction ?? ''}
          onChange={(v) => onChange({ catchAction: v === '' ? undefined : v })}
          style={{ width: '100%' }}
          placeholder="不启用（按上方策略处理）"
          optionList={[
            { value: '', label: '不启用（按上方策略处理）' },
            { value: 'toAdmin', label: '转交管理员处理' },
            { value: 'notify', label: '通知相关人并自动通过' },
            { value: 'terminate', label: '终止流程' },
          ]}
        />
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
          启用后，当审批人解析为空时优先执行此异常处理。
        </Typography.Text>
        {catchAction === 'notify' && (
          <div style={{ marginTop: 8 }}>
            <div className="fd-field-label">通知人</div>
            <Select
              multiple
              filter
              style={{ width: '100%' }}
              placeholder="请选择异常通知人"
              value={catchNotifyUserIds ?? []}
              onChange={(v) => onChange({ catchNotifyUserIds: (v as number[]) ?? [] })}
              optionList={users.map((u) => ({ value: u.id, label: u.nickname }))}
            />
          </div>
        )}
      </div>

      {/* ─── 审批人与提交人为同一人时 ─────────────────────────── */}
      <SectionDivider>审批人与提交人为同一人时</SectionDivider>
      <RadioGroup
        value={sameInitiatorStrategy}
        onChange={(e) => onChange({ sameInitiatorStrategy: e.target.value })}
        direction="vertical"
        className="fd-radio-list"
      >
        {SAME_INITIATOR_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>{o.label}</Radio>
        ))}
      </RadioGroup>

      {/* ─── 审批人去重 ───────────────────────────────────────── */}
      <SectionDivider>审批人去重</SectionDivider>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
        当同一审批人出现在多个审批节点时的处理方式
      </Typography.Text>
      <Select
        value={deduplicateStrategy}
        onChange={(v) => onChange({ deduplicateStrategy: v })}
        style={{ width: '100%' }}
        optionList={DEDUPLICATE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        placeholder="请选择去重策略"
      />
    </>
  );
}
