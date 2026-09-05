/**
 * 个人中心 · 通知设置 Tab。
 *
 * 上半部分是全局设置（免打扰 / 摘要 / 全局静音），下半部分是「事件 × 渠道」订阅矩阵。
 * 矩阵开关即点即存：单元格粒度的偏好没有草稿语义，攒一个「保存」按钮
 * 只会让用户不确定改动有没有生效。
 */
import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Collapse, Form, Spin, Switch, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Lock } from 'lucide-react';
import {
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_DIGEST_MODE_OPTIONS,
  NOTIFICATION_SEVERITY_LABELS,
  type NotificationChannel,
  type NotificationMatrixEvent,
  type SaveNotificationSettingsInput,
} from '@zenith/shared/messaging';
import { FormTimezoneSelect } from '@/components/FormTimezoneSelect';
import {
  useNotificationMatrix,
  useNotificationSettings,
  useSaveNotificationPreferences,
  useSaveNotificationSettings,
} from '@/hooks/queries/notification-preferences';

const { Text } = Typography;

const SEVERITY_TAG_COLOR: Record<string, 'grey' | 'orange' | 'red'> = {
  normal: 'grey',
  important: 'orange',
  critical: 'red',
};

/** 半小时粒度的 HH:mm 选项（免打扰起止） */
const CLOCK_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`;
  return { value, label: value };
});

const DIGEST_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, '0')}:00`,
}));

function EventRow({ event }: Readonly<{ event: NotificationMatrixEvent }>) {
  const saveMutation = useSaveNotificationPreferences();
  const [pendingChannel, setPendingChannel] = useState<string | null>(null);

  const handleToggle = (channel: NotificationChannel, enabled: boolean) => {
    setPendingChannel(channel);
    saveMutation.mutate({ body: { items: [{ eventKey: event.key, channel, enabled }] } }, {
      onSuccess: () => Toast.success(enabled ? '已开启' : '已关闭'),
      onSettled: () => setPendingChannel(null),
    });
  };

  return (
    <div className="notify-event-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--semi-color-border)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 220px', minWidth: 200 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Text>{event.label}</Text>
          {event.severity !== 'normal' && (
            <Tag size="small" color={SEVERITY_TAG_COLOR[event.severity]}>{NOTIFICATION_SEVERITY_LABELS[event.severity]}</Tag>
          )}
          {event.mandatory && (
            <Tooltip content="必达通知，不可关闭">
              <Lock size={12} style={{ color: 'var(--semi-color-text-2)' }} />
            </Tooltip>
          )}
        </span>
        {event.description && (
          <div><Text type="tertiary" size="small">{event.description}</Text></div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {event.channels.map((cell) => {
          const disabled = cell.locked;
          const control = (
            <span key={cell.channel} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Text type="tertiary" size="small">{NOTIFICATION_CHANNEL_LABELS[cell.channel]}</Text>
              <Switch
                size="small"
                checked={cell.enabled}
                disabled={disabled}
                loading={pendingChannel === cell.channel && saveMutation.isPending}
                onChange={(checked) => handleToggle(cell.channel, checked)}
                aria-label={`${event.label} - ${NOTIFICATION_CHANNEL_LABELS[cell.channel]}`}
              />
            </span>
          );
          return disabled ? (
            <Tooltip key={cell.channel} content={event.mandatory ? '必达通知，不可关闭' : '已由管理员统一管理'}>
              {control}
            </Tooltip>
          ) : control;
        })}
      </div>
    </div>
  );
}

export default function NotificationSettingsTab() {
  const settingsQuery = useNotificationSettings();
  const matrixQuery = useNotificationMatrix();
  const saveSettings = useSaveNotificationSettings();
  const [digestMode, setDigestMode] = useState<string>('realtime');

  useEffect(() => {
    if (settingsQuery.data) setDigestMode(settingsQuery.data.digestMode);
  }, [settingsQuery.data]);

  const groups = useMemo(() => matrixQuery.data ?? [], [matrixQuery.data]);
  const defaultActiveKeys = useMemo(() => groups.map((g) => g.group), [groups]);

  const handleSaveSettings = (values: Record<string, unknown>) => {
    const quietStart = (values.quietStart as string | undefined) || null;
    const quietEnd = (values.quietEnd as string | undefined) || null;
    if ((quietStart === null) !== (quietEnd === null)) {
      Toast.warning('免打扰起止时间需同时设置或同时留空');
      return;
    }
    if (quietStart !== null && quietStart === quietEnd) {
      Toast.warning('免打扰起止时间不能相同');
      return;
    }
    const payload: SaveNotificationSettingsInput = {
      globalMuted: Boolean(values.globalMuted),
      timezone: (values.timezone as string) || 'Asia/Shanghai',
      quietStart,
      quietEnd,
      digestMode: values.digestMode as SaveNotificationSettingsInput['digestMode'],
      digestHour: (values.digestHour as number) ?? 9,
    };
    saveSettings.mutate({ body: payload }, { onSuccess: () => Toast.success('通知设置已保存') });
  };

  if (settingsQuery.isPending || matrixQuery.isPending) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  }
  const settings = settingsQuery.data;

  return (
    <div className="profile-section">
      <div className="section-title">全局设置</div>
      {settings?.globalMuted && (
        <Banner type="warning" description="全局静音已开启：除必达通知外，所有渠道都不会向你发送通知。" style={{ marginBottom: 12 }} />
      )}
      {/* 页面级全局配置表单：无「编辑对象」语义，不适用 useEditModal */}
      <Form
        key={settings?.updatedAt}
        labelPosition="left"
        labelWidth={110}
        style={{ maxWidth: 560 }}
        initValues={{
          globalMuted: settings?.globalMuted ?? false,
          timezone: settings?.timezone ?? 'Asia/Shanghai',
          quietStart: settings?.quietStart ?? undefined,
          quietEnd: settings?.quietEnd ?? undefined,
          digestMode: settings?.digestMode ?? 'realtime',
          digestHour: settings?.digestHour ?? 9,
        }}
        onSubmit={handleSaveSettings}
      >
        <Form.Switch field="globalMuted" label="全局静音" extraText="开启后除必达通知外不再接收任何通知" />
        <FormTimezoneSelect extraText="免打扰时段按此时区判定" />
        <Form.Select field="quietStart" label="免打扰开始" placeholder="不启用" optionList={CLOCK_OPTIONS} showClear filter style={{ width: '100%' }} />
        <Form.Select field="quietEnd" label="免打扰结束" placeholder="不启用" optionList={CLOCK_OPTIONS} showClear filter style={{ width: '100%' }} extraText="支持跨零点（如 22:00 至 08:00）；紧急通知不受免打扰影响" />
        <Form.RadioGroup field="digestMode" label="邮件摘要" onChange={(e) => setDigestMode(e.target.value as string)}>
          {NOTIFICATION_DIGEST_MODE_OPTIONS.map((opt) => (
            <Form.Radio key={opt.value} value={opt.value}>{opt.label}</Form.Radio>
          ))}
        </Form.RadioGroup>
        {digestMode === 'daily' && (
          <Form.Select field="digestHour" label="摘要时间" optionList={DIGEST_HOUR_OPTIONS} style={{ width: 160 }} />
        )}
        <div style={{ marginLeft: 110, marginTop: 8 }}>
          <Button htmlType="submit" type="primary" loading={saveSettings.isPending}>保存设置</Button>
        </div>
      </Form>

      <div className="section-title" style={{ marginTop: 32 }}>订阅偏好</div>
      <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
        按事件与渠道选择接收方式；带锁标记的为必达通知或已由管理员统一管理。
      </Text>
      <Collapse defaultActiveKey={defaultActiveKeys} keepDOM>
        {groups.map((group) => (
          <Collapse.Panel key={group.group} itemKey={group.group} header={`${group.label}（${group.events.length}）`}>
            {group.events.map((event) => <EventRow key={event.key} event={event} />)}
          </Collapse.Panel>
        ))}
      </Collapse>
    </div>
  );
}
