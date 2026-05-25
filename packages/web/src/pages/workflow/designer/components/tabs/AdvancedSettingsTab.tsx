/**
 * 高级设置 Tab
 * 拒绝策略、审批人与发起人同一人策略、审批人去重、空审批人策略、超时处理
 */
import { Form, InputNumber, Select, Switch, Typography, RadioGroup, Radio } from '@douyinfe/semi-ui';
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

interface AdvancedSettingsTabProps {
  rejectStrategy: RejectStrategy;
  rejectToNodeKey?: string;
  availableRejectNodes?: Array<{ id: string; key?: string; name: string; type: string }>;
  emptyStrategy: EmptyAssigneeStrategy;
  emptyAssignTo?: number;
  sameInitiatorStrategy?: SameInitiatorStrategy;
  deduplicateStrategy?: DeduplicateStrategy;
  timeout?: TimeoutConfig;
  users: UserOption[];
  onChange: (updates: Record<string, unknown>) => void;
}

export default function AdvancedSettingsTab({
  rejectStrategy,
  rejectToNodeKey,
  availableRejectNodes = [],
  emptyStrategy,
  emptyAssignTo,
  sameInitiatorStrategy = 'selfApprove',
  deduplicateStrategy = 'autoSkip',
  timeout,
  users,
  onChange,
}: Readonly<AdvancedSettingsTabProps>) {

  const handleTimeoutChange = (updates: Partial<TimeoutConfig>) => {
    onChange({
      timeout: {
        enabled: false,
        duration: 24,
        action: 'remind',
        remindCount: 3,
        ...timeout,
        ...updates,
      },
    });
  };

  return (
    <div className="fd-drawer-tab-content">
      {/* 拒绝策略 */}
      <Typography.Title heading={6} style={{ marginBottom: 12 }}>拒绝策略</Typography.Title>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
        当审批人拒绝时，流程如何处理
      </Typography.Text>
      <Select
        value={rejectStrategy}
        onChange={(v) => onChange({ rejectStrategy: v })}
        style={{ width: '100%', marginBottom: 12 }}
        optionList={REJECT_STRATEGY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
        placeholder="请选择拒绝策略"
      />
      {rejectStrategy === 'returnToNode' && (
        <div style={{ marginBottom: 24 }}>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>
            选择被驳回后要返回的节点（仅能选当前节点之前同一执行路径上的审批、办理节点）
          </Typography.Text>
          <Select
            value={rejectToNodeKey}
            onChange={(v) => onChange({ rejectToNodeKey: v })}
            style={{ width: '100%' }}
            placeholder={availableRejectNodes.length === 0 ? '当前节点之前没有可选节点' : '请选择回退节点'}
            disabled={availableRejectNodes.length === 0}
            optionList={availableRejectNodes.map((n) => ({
              value: n.key || n.id,
              label: `${n.name}（${n.type === 'approver' ? '审批人' : '办理人'}${n.key ? ` · ${n.key}` : ''}）`,
            }))}
          />
        </div>
      )}
      {rejectStrategy !== 'returnToNode' && <div style={{ marginBottom: 12 }} />}

      {/* 空审批人策略 */}
      <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 16, marginBottom: 24 }}>
        <Typography.Title heading={6} style={{ marginBottom: 12 }}>空审批人处理</Typography.Title>
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
          当审批节点找不到审批人时的处理方式
        </Typography.Text>
        <RadioGroup
          value={emptyStrategy}
          onChange={(e) => onChange({ emptyStrategy: e.target.value })}
          direction="vertical"
          className="fd-radio-list"
        >
          {EMPTY_ASSIGNEE_OPTIONS.map(o => (
            <Radio key={o.value} value={o.value}>{o.label}</Radio>
          ))}
        </RadioGroup>
        {emptyStrategy === 'assignTo' && (
          <div style={{ marginTop: 12 }}>
            <Form.Slot label="转交给">
              <Select
                value={emptyAssignTo}
                onChange={(v) => {
                  const user = users.find(u => u.id === v);
                  onChange({ emptyAssignTo: v, emptyAssignToName: user?.nickname });
                }}
                filter
                style={{ width: '100%' }}
                placeholder="请选择转交人员"
                optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
              />
            </Form.Slot>
          </div>
        )}
      </div>

      {/* 审批人与发起人同一人 */}
      <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 16, marginBottom: 24 }}>
        <Typography.Title heading={6} style={{ marginBottom: 12 }}>审批人与发起人为同一人时</Typography.Title>
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
          当审批人与流程发起人相同时的处理方式
        </Typography.Text>
        <RadioGroup
          value={sameInitiatorStrategy}
          onChange={(e) => onChange({ sameInitiatorStrategy: e.target.value })}
          direction="vertical"
          className="fd-radio-list"
        >
          {SAME_INITIATOR_OPTIONS.map(o => (
            <Radio key={o.value} value={o.value}>{o.label}</Radio>
          ))}
        </RadioGroup>
      </div>

      {/* 审批人去重 */}
      <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 16, marginBottom: 24 }}>
        <Typography.Title heading={6} style={{ marginBottom: 12 }}>审批人去重</Typography.Title>
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
          当同一审批人出现在多个审批节点时的处理方式
        </Typography.Text>
        <Select
          value={deduplicateStrategy}
          onChange={(v) => onChange({ deduplicateStrategy: v })}
          style={{ width: '100%' }}
          optionList={DEDUPLICATE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          placeholder="请选择去重策略"
        />
      </div>

      {/* 超时处理 */}
      <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Typography.Title heading={6} style={{ margin: 0 }}>超时处理</Typography.Title>
          <Switch
            checked={timeout?.enabled ?? false}
            onChange={(v) => handleTimeoutChange({ enabled: v })}
          />
        </div>

        {timeout?.enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13 }}>超时时间</span>
              <InputNumber
                value={timeout.duration}
                onChange={(v) => handleTimeoutChange({ duration: v as number })}
                min={1}
                max={720}
                placeholder="请输入超时时间"
                style={{ width: 100 }}
              />
              <span style={{ fontSize: 13 }}>小时</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13 }}>超时后</span>
              <Select
                value={timeout.action}
                onChange={(v) => handleTimeoutChange({ action: v as TimeoutConfig['action'] })}
                style={{ width: 160 }}
                optionList={[
                  { value: 'remind', label: '发送提醒' },
                  { value: 'autoApprove', label: '自动通过' },
                  { value: 'autoReject', label: '自动拒绝' },
                ]}
                placeholder="请选择超时动作"
              />
            </div>
            {timeout.action === 'remind' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>提醒次数</span>
                <InputNumber
                  value={timeout.remindCount ?? 3}
                  onChange={(v) => handleTimeoutChange({ remindCount: v as number })}
                  min={1}
                  max={10}
                  placeholder="请输入"
                  style={{ width: 100 }}
                />
                <span style={{ fontSize: 13 }}>次</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
