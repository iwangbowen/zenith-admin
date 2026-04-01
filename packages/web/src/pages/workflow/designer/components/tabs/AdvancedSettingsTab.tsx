/**
 * 高级设置 Tab
 * 超时处理、拒绝策略、空审批人策略
 */
import { Form, InputNumber, Select, Switch, Typography } from '@douyinfe/semi-ui';
import type {
  RejectStrategy,
  EmptyAssigneeStrategy,
  TimeoutConfig,
} from '../../types';
import {
  REJECT_STRATEGY_OPTIONS,
  EMPTY_ASSIGNEE_OPTIONS,
} from '../../constants';

interface UserOption { id: number; nickname: string; }

interface AdvancedSettingsTabProps {
  rejectStrategy: RejectStrategy;
  emptyStrategy: EmptyAssigneeStrategy;
  emptyAssignTo?: number;
  timeout?: TimeoutConfig;
  users: UserOption[];
  onChange: (updates: Record<string, unknown>) => void;
}

export default function AdvancedSettingsTab({
  rejectStrategy,
  emptyStrategy,
  emptyAssignTo,
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
        style={{ width: '100%', marginBottom: 24 }}
        optionList={REJECT_STRATEGY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
      />

      {/* 空审批人策略 */}
      <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 16, marginBottom: 24 }}>
        <Typography.Title heading={6} style={{ marginBottom: 12 }}>空审批人处理</Typography.Title>
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
          当审批节点找不到审批人时的处理方式
        </Typography.Text>
        <Select
          value={emptyStrategy}
          onChange={(v) => onChange({ emptyStrategy: v })}
          style={{ width: '100%' }}
          optionList={EMPTY_ASSIGNEE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
        />
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
