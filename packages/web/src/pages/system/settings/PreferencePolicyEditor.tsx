import { Fragment, useMemo, type ReactNode } from 'react';
import { Banner, Button, Checkbox, ColorPicker, Empty, Input, InputNumber, Select, Space, Switch, Tooltip, Typography } from '@douyinfe/semi-ui';
import { RotateCcw } from 'lucide-react';
import { terminalFileContract } from '@zenith/shared/ops';
import {
  canOverridePreference,
  defaultPreferences,
  describePreferenceCondition,
  getPreferenceValue,
  isPreferenceApplicable,
  preferenceDefinitions,
  preferenceGroups,
  resolvePreferences,
  setPreferenceValue,
  type PreferenceDefinition,
  type PreferenceGroup,
  type PreferencePath,
  type PreferencePolicy,
} from '@zenith/shared/preferences';
import { InstantFilterToolbar } from '@/components/list-page/InstantFilterToolbar';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { SettingDivider, SettingRow, SettingSection } from '@/components/settings/SettingRow';
import { useCurrentUserMenuTree, useMenuTree } from '@/hooks/queries/menus';
import { settingsKeys } from '@/hooks/queries/settings';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { useFlatMenus } from '@/layouts/admin/useMenuDerived';
import { useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { THEME_COLOR_PRESETS } from '@/lib/theme-color';
import { FONT_FAMILY_PRESETS } from '../terminal/themes';
import './preference-policy-editor.css';

interface PreferencePolicyEditorProps {
  readonly value: PreferencePolicy;
  readonly onChange: (next: PreferencePolicy) => void;
  readonly disabled?: boolean;
}

interface PolicyFilters {
  keyword: string;
  group?: PreferenceGroup;
  changedOnly: boolean;
  lockedOnly: boolean;
}

const INITIAL_FILTERS: PolicyFilters = { keyword: '', group: undefined, changedOnly: false, lockedOnly: false };
const GROUP_OPTIONS = preferenceGroups.map((group) => ({ value: group.id, label: group.label }));
const BOOLEAN_OPTIONS = [{ value: 'true', label: '开启' }, { value: 'false', label: '关闭' }];

function isAdjusted(policy: PreferencePolicy, path: PreferencePath): boolean {
  return !canOverridePreference(path, policy)
    || getPreferenceValue(policy.defaults, path) !== getPreferenceValue(defaultPreferences, path);
}

function PolicyColorInput({ value, disabled, onChange, label }: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (next: string) => void;
  readonly label: string;
}) {
  const preset = THEME_COLOR_PRESETS.find((entry) => entry.key === value);
  const color = preset?.light.primary ?? value;
  const options = THEME_COLOR_PRESETS.map((entry) => ({ value: entry.key, label: entry.name }));
  if (!preset) options.push({ value, label: value });
  return (
    <div className="preference-policy-editor__color">
      <Select aria-label={label} value={value} optionList={options} disabled={disabled}
        onChange={(next) => { if (typeof next === 'string') onChange(next); }} />
      <ColorPicker alpha={false} usePopover value={ColorPicker.colorStringToValue(color)}
        onChange={(next) => { if (!disabled) onChange(next.hex); }}>
        <button type="button" className="preference-policy-editor__swatch" disabled={disabled}
          aria-label="自定义主题色" title="自定义主题色" style={{ backgroundColor: color }} />
      </ColorPicker>
    </div>
  );
}

/** 系统偏好草稿编辑器。所有字段始终可配置，适用条件只解释用户端何时生效。 */
export function PreferencePolicyEditor({ value, onChange, disabled }: PreferencePolicyEditorProps) {
  const { hasPermission, hasAnyPermission } = usePermission();
  const canReadAllMenus = hasPermission('system:menu:list');
  const menuTree = useMenuTree({ enabled: canReadAllMenus });
  const currentMenus = useCurrentUserMenuTree();
  const flatMenus = useFlatMenus(menuTree.data ?? currentMenus.data ?? []);
  const canReadShells = hasAnyPermission('system:file:use', 'system:terminal:execute');
  const shells = useApiQuery(terminalFileContract.shells, {
    enabled: canReadShells,
    staleTime: LOOKUP_STALE_TIME,
    requestOptions: { silent: true },
  });
  const { draftParams, bind, setField, handleReset } = useListSearch<PolicyFilters>({
    defaults: INITIAL_FILTERS,
    listKey: settingsKeys.module('ui'),
    refetchOnSearch: false,
  });
  const homeOptions = useMemo(() => {
    const options = [{ value: '/', label: '首页（默认）' }];
    const seen = new Set(['/']);
    for (const menu of flatMenus) {
      // 默认首页只接受站内路由；外链内嵌菜单已由 useFlatMenus 转为 /embed/{id}。
      if (!menu.path.startsWith('/') || menu.path.startsWith('//') || seen.has(menu.path)) continue;
      seen.add(menu.path);
      options.push({ value: menu.path, label: [...menu.breadcrumb, menu.title].join(' / ') });
    }
    const configured = value.defaults.homePath;
    if (!seen.has(configured)) options.push({ value: configured, label: `${configured}（当前已配置）` });
    return options;
  }, [flatMenus, value.defaults.homePath]);
  const shellOptions = useMemo(() => {
    const options = [
      { value: '', label: '服务器默认' },
      ...(shells.data?.shells ?? []).map((shell) => ({ value: shell.id, label: shell.label })),
    ];
    const configured = value.defaults.terminal.defaultShell;
    if (configured && !options.some((option) => option.value === configured)) {
      options.push({ value: configured, label: `${configured}（当前已配置）` });
    }
    return options;
  }, [shells.data, value.defaults.terminal.defaultShell]);
  const rows = useMemo(() => {
    const keyword = draftParams.keyword.trim().toLocaleLowerCase();
    return preferenceDefinitions.filter((definition) => {
      if (draftParams.group && definition.group !== draftParams.group) return false;
      if (draftParams.changedOnly && !isAdjusted(value, definition.path)) return false;
      if (draftParams.lockedOnly && canOverridePreference(definition.path, value)) return false;
      if (!keyword) return true;
      return [definition.label, definition.path, definition.description,
        preferenceGroups.find((group) => group.id === definition.group)?.label,
        definition.applicableWhen && describePreferenceCondition(definition.applicableWhen),
      ].filter(Boolean).join(' ').toLocaleLowerCase().includes(keyword);
    });
  }, [draftParams, value]);
  const adjustedCount = preferenceDefinitions.filter((definition) => isAdjusted(value, definition.path)).length;
  const lockedCount = preferenceDefinitions.filter((definition) => !canOverridePreference(definition.path, value)).length;
  const defaultValues = resolvePreferences(value, {});

  function updateDefault(path: PreferencePath, next: string | number | boolean) {
    onChange({ ...value, defaults: setPreferenceValue(value.defaults, path, next) });
  }

  function resetField(path: PreferencePath) {
    onChange({
      defaults: setPreferenceValue(value.defaults, path, getPreferenceValue(defaultPreferences, path)),
      allowUserOverride: setPreferenceValue(value.allowUserOverride, path, true),
    });
  }

  function renderControl(definition: PreferenceDefinition): ReactNode {
    const { path, kind } = definition;
    const current = getPreferenceValue(value.defaults, path);
    const label = `${definition.label}默认值`;
    if (kind === 'boolean') {
      return <Select aria-label={label} value={String(current)} optionList={BOOLEAN_OPTIONS} disabled={disabled}
        onChange={(next) => updateDefault(path, next === 'true')} />;
    }
    if (kind === 'number') {
      return <InputNumber aria-label={label} value={typeof current === 'number' ? current : undefined}
        min={definition.min} max={definition.max} step={definition.step ?? 1}
        precision={definition.step && definition.step < 1 ? undefined : 0}
        suffix={definition.unit} disabled={disabled}
        onChange={(next) => { if (typeof next === 'number' && Number.isFinite(next)) updateDefault(path, next); }} />;
    }
    if (kind === 'color') {
      return <PolicyColorInput value={String(current)} disabled={disabled} label={label} onChange={(next) => updateDefault(path, next)} />;
    }
    if (kind === 'home-path') {
      return <Select aria-label={label} value={String(current)} optionList={homeOptions} filter disabled={disabled}
        loading={canReadAllMenus ? menuTree.isFetching : currentMenus.isFetching}
        onChange={(next) => { if (typeof next === 'string') updateDefault(path, next); }} />;
    }
    if (path === 'terminal.defaultShell') {
      return <Select aria-label={label} value={String(current)} optionList={shellOptions} disabled={disabled}
        loading={canReadShells && shells.isFetching}
        onChange={(next) => { if (typeof next === 'string') updateDefault(path, next); }} />;
    }
    if (kind === 'terminal-theme') {
      return <Select aria-label={label} value={String(current)} disabled={disabled} filter
        optionList={[...(definition.options ?? [])]}
        onChange={(next) => { if (typeof next === 'string') updateDefault(path, next); }} />;
    }
    if (path === 'terminal.fontFamily') {
      return <Select aria-label={label} value={String(current)} disabled={disabled} filter allowCreate
        optionList={[...FONT_FAMILY_PRESETS]}
        onChange={(next) => { if (typeof next === 'string') updateDefault(path, next); }} />;
    }
    if (kind === 'select') {
      return <Select<string | number> aria-label={label} value={typeof current === 'number' ? current : String(current)}
        optionList={[...(definition.options ?? [])]} disabled={disabled}
        onChange={(next) => { if (typeof next === 'string' || typeof next === 'number') updateDefault(path, next); }} />;
    }
    return <Input aria-label={label} value={String(current)} disabled={disabled} onChange={(next) => updateDefault(path, next)} />;
  }

  function renderDescription(definition: PreferenceDefinition): ReactNode {
    const applicable = isPreferenceApplicable(definition.path, defaultValues);
    return (
      <span className="preference-policy-editor__description">
        {definition.description ? <span>{definition.description}</span> : null}
        {definition.applicableWhen ? <span>适用条件：{describePreferenceCondition(definition.applicableWhen)}</span> : null}
        {!applicable ? <span className="preference-policy-editor__hint">当前系统默认组合不满足条件，满足条件后生效。</span> : null}
        {definition.path === 'homePath' ? <span>用户无权访问指定页面时回到可访问的首页。{!canReadAllMenus ? '当前仅列出你可访问的页面。' : ''}</span> : null}
        {definition.path === 'terminal.defaultShell' && !canReadShells ? <span>没有读取终端 Shell 列表的权限，可使用服务器默认。</span> : null}
        {definition.path === 'terminal.defaultShell' && shells.isError ? <span>暂时无法读取 Shell 列表，可使用服务器默认或保留已配置值。</span> : null}
      </span>
    );
  }

  return (
    <div className="preference-policy-editor">
      <SettingSection title="偏好策略" description="设置每项偏好的系统默认值，并决定用户是否可以修改。">
        <Banner type="info" closeIcon={null} className="preference-policy-editor__intro"
          description="禁止用户修改的项目会在个人偏好中隐藏并使用系统值；子项是否显示取决于父项的生效值。更改将在保存后统一生效。" />
        <InstantFilterToolbar
          primary={<KeywordInput placeholder="搜索偏好名称 / 说明" {...bind('keyword')} />}
          filters={(
            <>
              <FilterSelect placeholder="全部分组" items={GROUP_OPTIONS} {...bind('group')} />
              <Checkbox checked={draftParams.changedOnly} onChange={(event) => setField('changedOnly')(Boolean(event.target.checked))}>仅看已调整</Checkbox>
              <Checkbox checked={draftParams.lockedOnly} onChange={(event) => setField('lockedOnly')(Boolean(event.target.checked))}>仅看禁止修改</Checkbox>
            </>
          )}
          onReset={handleReset}
        />
        <Typography.Text type="tertiary" size="small">共 {preferenceDefinitions.length} 项 · 已调整 {adjustedCount} 项 · 禁止修改 {lockedCount} 项 · 当前显示 {rows.length} 项</Typography.Text>
        {rows.length === 0 ? <Empty description="没有符合筛选条件的偏好" /> : null}
        {preferenceGroups.map((group) => {
          const fields = rows.filter((definition) => definition.group === group.id);
          if (fields.length === 0) return null;
          return (
            <SettingSection key={group.id} title={group.label}>
              <div className="preference-policy-editor__head" aria-hidden="true">
                <span>偏好设置</span>
                <div className="preference-policy-editor__controls"><span>系统默认值</span><span>用户可修改</span><span /></div>
              </div>
              {fields.map((definition, index) => (
                <Fragment key={definition.path}>
                  {index > 0 ? <SettingDivider /> : null}
                  <div className="preference-policy-editor__row" data-preference-path={definition.path}>
                    <SettingRow title={definition.label} description={renderDescription(definition)} style={{ flexWrap: 'wrap' }}
                      control={(
                        <div className="preference-policy-editor__controls">
                          <div className="preference-policy-editor__value">
                            <span className="preference-policy-editor__mobile-label">系统默认值</span>
                            {renderControl(definition)}
                          </div>
                          <div className="preference-policy-editor__override">
                            <span className="preference-policy-editor__mobile-label">用户可修改</span>
                            <Switch aria-label={`${definition.label}用户可修改`} disabled={disabled}
                              checked={canOverridePreference(definition.path, value)}
                              onChange={(next) => onChange({ ...value, allowUserOverride: setPreferenceValue(value.allowUserOverride, definition.path, next) })} />
                          </div>
                          <Tooltip content="恢复内置默认值并允许用户修改">
                            <Space>
                              <Button theme="borderless" size="small" aria-label={`恢复${definition.label}内置策略`}
                                icon={<RotateCcw size={14} />} disabled={disabled || !isAdjusted(value, definition.path)}
                                onClick={() => resetField(definition.path)} />
                            </Space>
                          </Tooltip>
                        </div>
                      )} />
                  </div>
                </Fragment>
              ))}
            </SettingSection>
          );
        })}
      </SettingSection>
    </div>
  );
}
