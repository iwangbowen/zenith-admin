/**
 * 个人中心 · 通知设置 Tab。
 *
 * 上半部分是全局设置（免打扰 / 摘要 / 全局静音），下半部分是「事件 × 渠道」订阅矩阵。
 * 矩阵开关即点即存：单元格粒度的偏好没有草稿语义，攒一个「保存」按钮
 * 只会让用户不确定改动有没有生效。
 */
import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Collapse, Form, Select, Spin, Switch, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { BellRing, Lock, Volume2 } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import {
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_DIGEST_MODE_OPTIONS,
  NOTIFICATION_SEVERITY_LABELS,
  type NotificationChannel,
  type NotificationMatrixEvent,
  type SaveNotificationSettingsInput,
} from '@zenith/shared/messaging';
import { FormTimezoneSelect } from '@/components/FormTimezoneSelect';
import { PreferenceControl } from '@/components/settings/SettingRow';
import {
  useNotificationMatrix,
  useNotificationSettings,
  useSaveNotificationPreferences,
  useSaveNotificationSettings,
} from '@/hooks/queries/notification-preferences';
import { usePreferences } from '@/hooks/usePreferences';
import { NOTIFICATION_SOUND_STYLES, NOTIFICATION_SOUND_STYLE_OPTIONS, playNotificationSound } from '@/utils/notification-sound';
import {
  desktopNotificationPermission,
  requestDesktopNotificationPermission,
  showDesktopNotification,
  type DesktopNotificationPermission,
} from '@/utils/desktop-notification';
import { DEFAULT_TIMEZONE } from '@/utils/timezones';
import { NOTIFICATION_SEVERITY_TAG_COLOR } from '../system/notify-policies/notify-tag-colors';

const { Text } = Typography;

/** 半小时粒度的 HH:mm 选项（免打扰起止） */
const CLOCK_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`;
  return { value, label: value };
});

const DIGEST_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, '0')}:00`,
}));

/** 桌面通知开关：开启时申请浏览器授权，被拒绝 / 不支持时回退关闭并说明原因；已授权时可发一条测试通知 */
function DesktopNotificationControls({ enabled, content, onChange, onContentChange }: Readonly<{ enabled: boolean; content: 'summary' | 'type'; onChange: (enabled: boolean) => void; onContentChange: (content: 'summary' | 'type') => void }>) {
  const [permission, setPermission] = useState<DesktopNotificationPermission>(desktopNotificationPermission);
  const [requesting, setRequesting] = useState(false);

  const requestPermission = async () => {
    setRequesting(true);
    const result = await requestDesktopNotificationPermission();
    setRequesting(false);
    setPermission(result);
    if (result !== 'granted') Toast.warning(result === 'unsupported' ? '当前浏览器不支持桌面通知' : '浏览器已拒绝通知权限，请在地址栏站点设置中允许通知后再开启');
    return result;
  };

  const handleToggle = async (checked: boolean) => {
    if (!checked) { onChange(false); return; }
    if (await requestPermission() === 'granted') onChange(true);
  };

  const handleTest = () => {
    const shown = showDesktopNotification({ title: '测试通知', body: content === 'summary' ? '桌面通知已生效，站内信与公告会以此形式提醒你' : undefined, tag: 'desktop-notification-test' });
    if (!shown) Toast.warning('未能弹出通知，请检查浏览器与系统的通知权限');
  };

  const blocked = permission === 'denied' || permission === 'unsupported';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <PreferenceControl path="desktopNotification" inline>
        <Switch checked={enabled && permission === 'granted'} loading={requesting} onChange={(v) => void handleToggle(v)} aria-label="桌面通知" />
        <Text>桌面通知</Text>
      </PreferenceControl>
      {blocked && (
        <Text type="tertiary" size="small">
          {permission === 'unsupported' ? '当前浏览器不支持' : '浏览器已拒绝授权，需在站点设置中允许通知'}
        </Text>
      )}
      {enabled && permission === 'granted' && (
        <Button theme="light" icon={<BellRing size={14} />} onClick={handleTest}>发送测试通知</Button>
      )}
      {permission !== 'granted' && permission !== 'unsupported' ? (
        <Button theme="light" loading={requesting} onClick={() => void requestPermission()}>授权浏览器通知</Button>
      ) : null}
      <PreferenceControl path="desktopNotificationContent" inline>
      <Select
        value={content}
        onChange={(value) => onContentChange(value as 'summary' | 'type')}
        optionList={[{ value: 'summary', label: '显示消息摘要' }, { value: 'type', label: '仅显示消息类型' }]}
        style={{ width: 160 }}
        aria-label="桌面通知内容预览"
      />
      </PreferenceControl>
    </div>
  );
}

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
            <Tag size="small" color={NOTIFICATION_SEVERITY_TAG_COLOR[event.severity]}>{NOTIFICATION_SEVERITY_LABELS[event.severity]}</Tag>
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
  // 提示音是客户端播放偏好：存用户偏好（跟随账号，无需服务端字段），即改即存
  const { preferences, setPreferences, canEditPreference, hasManagedPreferences } = usePreferences();

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
      timezone: (values.timezone as string) || DEFAULT_TIMEZONE,
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
      {hasManagedPreferences ? <Banner type="info" closeIcon={null} description="部分偏好由管理员统一管理；浏览器通知授权仍需在当前设备完成。" style={{ marginBottom: 16 }} /> : null}
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
          timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
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

      {preferences.notificationSound || canEditPreference('notificationSound') || canEditPreference('notificationSoundStyle') ? <>
      <div className="section-title" style={{ marginTop: 32 }}>提醒音效</div>
      <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
        站内信与公告实时到达时播放提示音，跟随账号生效，即改即存；浏览器要求页面有过交互后才能出声，可先点「试听」。
      </Text>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <PreferenceControl path="notificationSound" inline>
        <Switch
          checked={preferences.notificationSound}
          onChange={(checked) => setPreferences({ notificationSound: checked })}
          aria-label="播放提示音"
        />
        <Text>播放提示音</Text>
        </PreferenceControl>
        <PreferenceControl path="notificationSoundStyle" inline>
        <Select
          value={preferences.notificationSoundStyle}
          optionList={NOTIFICATION_SOUND_STYLE_OPTIONS}
          onChange={(value) => {
            const style = enumValueOf(NOTIFICATION_SOUND_STYLES, value);
            if (style) setPreferences({ notificationSoundStyle: style });
          }}
          style={{ width: 140 }}
        />
        </PreferenceControl>
        {preferences.notificationSound ? <Button
          theme="light"
          icon={<Volume2 size={14} />}
          onClick={() => playNotificationSound(preferences.notificationSoundStyle)}
        >
          试听
        </Button> : null}
      </div>
      </> : null}

      <div className="section-title" style={{ marginTop: 32 }}>桌面通知</div>
      <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
        浏览器页签不在前台时，站内信与公告到达改为弹出系统通知，点击即回到本页；需浏览器授权，聊天消息的桌面通知在聊天页单独设置。
      </Text>
      <DesktopNotificationControls
        enabled={preferences.desktopNotification}
        content={preferences.desktopNotificationContent}
        onChange={(enabled) => setPreferences({ desktopNotification: enabled })}
        onContentChange={(content) => setPreferences({ desktopNotificationContent: content })}
      />

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
