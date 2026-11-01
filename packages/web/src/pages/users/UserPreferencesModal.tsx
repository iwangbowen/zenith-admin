/**
 * 用户偏好设置弹窗（用户管理页入口）
 *
 * 展示指定用户的偏好覆盖与最终生效值：系统策略锁定的项只读，
 * 其余项可逐项修改或恢复系统默认；保存时整体替换该用户的偏好覆盖文档。
 */
import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Empty, Input, InputNumber, Select, Space, Spin, Switch, Tabs, Tag, Toast } from '@douyinfe/semi-ui';
import { RotateCcw, Search } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { SettingDivider, SettingRow } from '@/components/settings/SettingRow';
import { useMySettings } from '@/hooks/queries/settings-projections';
import { useSaveUserPreferences, useUserPreferences } from '@/hooks/queries/users';
import {
  canOverridePreference,
  defaultPreferencePolicy,
  getPreferenceValue,
  isPreferenceApplicable,
  preferenceDefinitions,
  preferenceGroups,
  removePreferenceOverride,
  resolvePreferences,
  setPreferenceValue,
  type PreferenceDefinition,
  type PreferenceOverrides,
  type PreferencePath,
  type PreferenceScalar,
} from '@zenith/shared/preferences';

type Props = Readonly<{
  userId: number;
  userName: string;
  visible: boolean;
  onClose: () => void;
}>;

export function UserPreferencesModal({ userId, userName, visible, onClose }: Props) {
  const preferencesQuery = useUserPreferences(userId, visible);
  const settingsQuery = useMySettings();
  const saveMutation = useSaveUserPreferences();
  const [overrides, setOverrides] = useState<PreferenceOverrides>({});
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>(preferenceGroups[0].id);

  const policy = settingsQuery.data?.ui.preferences ?? defaultPreferencePolicy;
  const { refetch: refetchPreferences } = preferencesQuery;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setOverrides({});
    setLoaded(false);
    setSearch('');
    setActiveGroup(preferenceGroups[0].id);
    // 每次打开都重新拉取：命中上一次弹窗的缓存会显示旧偏好。
    void refetchPreferences().then((result) => {
      if (cancelled || !result.data) return;
      setOverrides(result.data.overrides);
      setLoaded(true);
    }).catch(() => { /* 错误状态由 preferencesQuery.isError 展示 */ });
    return () => { cancelled = true; };
  }, [visible, userId, refetchPreferences]);

  const effective = useMemo(() => resolvePreferences(policy, overrides), [policy, overrides]);

  const groups = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return preferenceGroups
      .map((group) => ({
        ...group,
        definitions: preferenceDefinitions.filter((definition) => (
          definition.group === group.id
          && isPreferenceApplicable(definition.path, effective)
          && (!keyword || `${definition.label} ${definition.description ?? ''} ${definition.path} ${group.label}`.toLowerCase().includes(keyword))
        )),
      }))
      .filter((group) => group.definitions.length > 0);
  }, [effective, search]);

  const currentGroup = groups.some((group) => group.id === activeGroup) ? activeGroup : groups[0]?.id;

  function handleChange(path: PreferencePath, value: PreferenceScalar | undefined) {
    setOverrides((prev) => {
      let next = value === undefined ? removePreferenceOverride(prev, path) : setPreferenceValue(prev, path, value);
      // 与个人偏好面板一致：灰色模式与色弱模式互斥。
      if (path === 'grayscale' && value === true && canOverridePreference('colorBlind', policy)) {
        next = setPreferenceValue(next, 'colorBlind', false);
      } else if (path === 'colorBlind' && value === true && canOverridePreference('grayscale', policy)) {
        next = setPreferenceValue(next, 'grayscale', false);
      }
      return next;
    });
  }

  function handleReset(path: PreferencePath) {
    setOverrides((prev) => removePreferenceOverride(prev, path));
  }

  function renderControl(definition: PreferenceDefinition, disabled: boolean) {
    const value = getPreferenceValue(effective, definition.path);
    if (definition.kind === 'boolean') {
      return <Switch checked={value === true} disabled={disabled} onChange={(checked) => handleChange(definition.path, checked)} />;
    }
    if (definition.options) {
      return (
        <Select
          // Semi 的 Select value 类型只声明 string，数值选项在运行时仍按原值匹配。
          value={value as unknown as string}
          disabled={disabled}
          filter={definition.options.length > 8}
          optionList={definition.options.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(next) => handleChange(definition.path, next as unknown as PreferenceScalar)}
          style={{ width: 190 }}
        />
      );
    }
    if (definition.kind === 'number') {
      return (
        <Space spacing={6}>
          <InputNumber
            value={Number(value)}
            disabled={disabled}
            min={definition.min}
            max={definition.max}
            step={definition.step}
            onChange={(next) => handleChange(definition.path, typeof next === 'number' && Number.isFinite(next) ? next : undefined)}
            style={{ width: 120 }}
          />
          {definition.unit ? <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>{definition.unit}</span> : null}
        </Space>
      );
    }
    return (
      <Input
        value={String(value ?? '')}
        disabled={disabled}
        placeholder={definition.kind === 'color' ? '主题色名称或 #RRGGBB' : undefined}
        onChange={(next) => handleChange(definition.path, next)}
        style={{ width: 240 }}
      />
    );
  }

  function renderRows(definitions: PreferenceDefinition[]) {
    return definitions.map((definition, index) => {
      const overridden = getPreferenceValue(overrides, definition.path) !== undefined;
      const locked = !canOverridePreference(definition.path, policy);
      return (
        <div key={definition.path}>
          {index > 0 ? <SettingDivider /> : null}
          <SettingRow
            title={definition.label}
            description={definition.description}
            overridden={overridden}
            extra={(locked || overridden) ? (
              <Space spacing={6}>
                {locked ? <Tag size="small" color="grey">系统统一设置</Tag> : null}
                {overridden ? (
                  <Button
                    theme="borderless"
                    type="tertiary"
                    size="small"
                    icon={<RotateCcw size={14} />}
                    aria-label={`恢复默认：${definition.label}`}
                    onClick={() => handleReset(definition.path)}
                  />
                ) : null}
              </Space>
            ) : null}
            control={renderControl(definition, locked)}
          />
        </div>
      );
    });
  }

  const handleSave = async () => {
    if (!loaded) return;
    await saveMutation.mutateAsync({ params: { id: userId }, body: { overrides } });
    Toast.success('用户偏好设置已更新');
    onClose();
  };

  return (
    <AppModal
      title={`偏好设置 — ${userName}`}
      visible={visible}
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      okButtonProps={{ disabled: !loaded || !settingsQuery.isSuccess }}
      confirmLoading={saveMutation.isPending}
      width={760}
    >
      <Banner
        type="info"
        closeIcon={null}
        fullMode={false}
        style={{ marginBottom: 12 }}
        description="当前显示该用户最新的生效设置（系统默认值 + 个人覆盖）。标记为「系统统一设置」的项目由系统策略控制，不可修改；带「已覆盖」标记的项目可恢复系统默认值。"
      />
      <Input
        prefix={<Search size={14} />}
        placeholder="搜索设置项"
        value={search}
        showClear
        onChange={setSearch}
        style={{ marginBottom: 8 }}
      />
      {preferencesQuery.isError ? (
        <Empty title="偏好设置加载失败" description="请关闭弹窗后重试" />
      ) : !loaded ? (
        <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
      ) : groups.length === 0 ? (
        <Empty title="没有匹配的设置项" description="试试其他关键词" />
      ) : (
        <Tabs collapsible="auto" activeKey={currentGroup} onChange={(key) => setActiveGroup(String(key))}>
          {groups.map((group) => (
            <Tabs.TabPane key={group.id} itemKey={group.id} tab={group.label}>
              <div style={{ maxHeight: '58vh', overflowY: 'auto', paddingRight: 4 }}>
                {renderRows(group.definitions)}
              </div>
            </Tabs.TabPane>
          ))}
        </Tabs>
      )}
    </AppModal>
  );
}