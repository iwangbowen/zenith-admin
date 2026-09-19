import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dropdown, Input, InputNumber, Popover, Radio, RadioGroup, Select, SplitButtonGroup, Switch, Tooltip } from '@douyinfe/semi-ui';
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Download, Info } from 'lucide-react';
import { LOADING_STYLE_OPTIONS, DARK_SURFACE_TONE_OPTIONS, UI_SCALE_OPTIONS, FONT_FAMILY_OPTIONS } from '@/hooks/usePreferences';
import { clearAllListFilterSnapshots } from '@/lib/list-filter-memory';
import type { NavLayout, TableSizePreference, RouteAnimation, BorderRadiusPreference, ScheduledDarkMode, TabStyle, TabSize, TabType, DarkSurfaceTone, TopbarClockMode, UserPreferences, UiScale, FontFamilyPreference, WeekStart, TimeDisplay, DoubleRailStyle } from '@/hooks/usePreferences';
import { isScheduleTime } from '@/hooks/usePreferences';
import type { ThemeMode } from '@/hooks/useTheme';
import { THEME_COLOR_PRESETS } from '@/lib/theme-color';
import { SwatchColorPicker } from '@/components/SwatchColorPicker';
import { confirmDanger } from '@/utils/confirm';
import { LoadingIndicator } from '@/components/PageLoading';
import { PreferenceControl, PreferenceSection } from '@/components/settings/SettingRow';

// 偏好设置面板各分区。所有分区组件都返回 Fragment，
// 使设置块保持为外层 flex 容器的直接子节点（gap 布局不变）。
interface PrefsSectionBaseProps {
  readonly prefSection: (label: string) => ReactNode;
  readonly matchesPref: (keywords: string[]) => boolean;
  readonly preferences: UserPreferences;
  readonly setPreferences: (prefs: Partial<UserPreferences>) => void;
}

// ── 布局 ──
export function PrefsLayoutSection({
  prefSection,
  matchesPref,
  preferences,
  setPreferences,
  navLayout,
}: PrefsSectionBaseProps & Readonly<{ navLayout: NavLayout }>) {
  return (
    <PreferenceSection title={prefSection('布局')}>

      {/* ── 导航布局 ── */}
      {matchesPref(['导航布局', '布局', '左侧菜单', '顶部菜单', '混合菜单', '双列菜单']) && (
      <PreferenceControl path="navLayout">
      <div>
        <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 500, color: 'var(--semi-color-text-0)' }}>导航布局</div>
        <div className="auto-grid" style={{ ['--auto-grid-min' as string]: '150px', ['--auto-grid-cols' as string]: 3, ['--auto-grid-gap' as string]: '10px' }}>
          {([
            { value: 'vertical' as NavLayout, label: '左侧菜单' },
            { value: 'horizontal' as NavLayout, label: '顶部菜单' },
            { value: 'mixed' as NavLayout, label: '混合菜单' },
            { value: 'double' as NavLayout, label: '双列菜单' },
          ]).map(({ value, label }) => (
            <button
              type="button"
              key={value}
              className={`layout-picker__option${navLayout === value ? ' layout-picker__option--active' : ''}`}
              onClick={() => setPreferences({ navLayout: value })}
            >
              <div className={`layout-picker__preview layout-picker__preview--${value}`} />
              <span className="layout-picker__label">{label}</span>
            </button>
          ))}
        </div>
      </div>
      </PreferenceControl>
      )}

      {/* ── 双列首列形式（仅双列布局适用，依赖 navLayout）── */}
      {navLayout === 'double' && matchesPref(['双列', '双列菜单', '首列', '双列首列', '图标', '图标文字']) && (
      <PreferenceControl path="doubleRailStyle">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          双列首列形式
          <Tooltip content="仅图标：与左侧菜单收起时同宽，名称靠悬浮提示，可容纳更多一级模块；图标 + 文字：名称直接可读，但条目更高，矮窗口需要滚动" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.doubleRailStyle ?? 'icon'}
          onChange={(e) => setPreferences({ doubleRailStyle: e.target.value as DoubleRailStyle })}
        >
          <Radio value="icon">仅图标</Radio>
          <Radio value="icon-text">图标 + 文字</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}

      {/* ── 内容宽度 ── */}
      {matchesPref(['内容宽度', '固定宽度', '居中', '内容区']) && (
      <PreferenceControl path="contentWidth">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          固定内容宽度
          <Tooltip content="开启后内容区最大宽度为 1400px 并居中，适合宽屏显示器" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={(preferences.contentWidth ?? 'fluid') === 'fixed'} onChange={(v) => setPreferences({ contentWidth: v ? 'fixed' : 'fluid' })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── Logo 图标 ── */}
      {matchesPref(['Logo', 'Logo图标', '图标', '显示Logo']) && (
      <PreferenceControl path="showLogo">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>显示 Logo 图标</span>
        <Switch checked={preferences.showLogo ?? true} onChange={(v) => setPreferences({ showLogo: v })} />
      </div>
      </PreferenceControl>
      )}
    </PreferenceSection>
  );
}

// ── 外观 ──
function PrefDarkToneRow({
  label,
  hint,
  value,
  onChange,
}: Readonly<{
  label: string;
  hint: string;
  value: DarkSurfaceTone;
  onChange: (tone: DarkSurfaceTone) => void;
}>) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        <Tooltip content={hint} position="right">
          <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
        </Tooltip>
      </span>
      <RadioGroup type="button" value={value} onChange={(e) => onChange(e.target.value as DarkSurfaceTone)}>
        {DARK_SURFACE_TONE_OPTIONS.map((option) => (
          <Radio key={option.value} value={option.value}>{option.label}</Radio>
        ))}
      </RadioGroup>
    </div>
  );
}

/**
 * 定时深色的 HH:mm 输入：非受控输入 + 合法才提交，键入过程中的非法中间态不回写，
 * 外部值变化（跟随系统 / 重置）时 key 强制重挂载回填。
 */
function ScheduleTimeInput({ path, label, value, onCommit }: Readonly<{
  path: 'scheduledDarkStart' | 'scheduledDarkEnd';
  label: string;
  value: string;
  onCommit: (value: string) => void;
}>) {
  return (
    <PreferenceControl path={path}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{label}</span>
        <Input
          key={value}
          defaultValue={value}
          placeholder="18:00"
          aria-label={label}
          style={{ width: 96 }}
          onChange={(text) => { if (isScheduleTime(text)) onCommit(text); }}
        />
      </div>
    </PreferenceControl>
  );
}

export function PrefsAppearanceSection({
  prefSection,
  matchesPref,
  preferences,
  setPreferences,
  mode,
  handleThemeModeChange,
  isDark,
  themeColor,
  setThemeColor,
}: PrefsSectionBaseProps & Readonly<{
  mode: ThemeMode;
  handleThemeModeChange: (newMode: ThemeMode) => void;
  isDark: boolean;
  themeColor: string;
  setThemeColor: (color: string) => void;
}>) {
  const loadingPickerRef = useRef<HTMLDivElement>(null);
  const activeLoadingOptionRef = useRef<HTMLButtonElement>(null);
  const [loadingPickerNav, setLoadingPickerNav] = useState({ canPrev: false, canNext: false });
  const updateLoadingPickerNav = useCallback(() => {
    const el = loadingPickerRef.current;
    if (!el) return;
    setLoadingPickerNav({
      canPrev: el.scrollLeft > 1,
      canNext: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);
  useEffect(() => {
    updateLoadingPickerNav();
    const el = loadingPickerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateLoadingPickerNav, { passive: true });
    return () => el.removeEventListener('scroll', updateLoadingPickerNav);
  }, [updateLoadingPickerNav]);
  // 当前选中的动画始终滚入可见区（初次打开即定位，不做平滑滚动避免与抽屉动效打架）。
  // 这里只改挑选项容器自身的 scrollLeft：scrollIntoView 会连带滚动每一个可滚动祖先，
  // 并推抽屉正文一起动——导航布局排在“外观”之前，一打开偏好设置就被拽到加载动画那一屏。
  useEffect(() => {
    const el = loadingPickerRef.current;
    const active = activeLoadingOptionRef.current;
    if (!el || !active) return;
    const elRect = el.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < elRect.left) el.scrollLeft -= elRect.left - activeRect.left;
    else if (activeRect.right > elRect.right) el.scrollLeft += activeRect.right - elRect.right;
  }, [preferences.loadingStyle]);
  const scrollLoadingPicker = useCallback((direction: 1 | -1) => {
    const el = loadingPickerRef.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth, behavior: 'smooth' });
  }, []);
  return (
    <PreferenceSection title={prefSection('外观')}>

      {/* ── 标签栏尺寸 ── */}
      {matchesPref(['标签栏尺寸', 'Tabs尺寸', 'Tabs 大小', '标签控件尺寸', 'small', 'medium', 'large', '外观']) && (
      <PreferenceControl path="tabsSize">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          标签栏尺寸
          <Tooltip content="控制页面内部标签栏（Semi Tabs）组件的尺寸" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.tabsSize ?? 'small'}
          onChange={(e) => setPreferences({ tabsSize: e.target.value as TabSize })}
        >
          <Radio value="small">小</Radio>
          <Radio value="medium">中</Radio>
          <Radio value="large">大</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}

      {/* ── 标签栏样式 ── */}
      {matchesPref(['标签栏样式', 'Tabs样式', 'Tabs 类型', 'line', 'button', 'card', 'slash', '外观']) && (
      <PreferenceControl path="tabsType">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          标签栏样式
          <Tooltip content="控制页面内部标签栏（Semi Tabs）的原生 type 属性" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Select
          value={preferences.tabsType ?? 'line'}
          optionList={[
            { value: 'line', label: '线条' },
            { value: 'button', label: '按钮' },
            { value: 'card', label: '卡片' },
            { value: 'slash', label: '斜线' },
          ]}
          onChange={(v) => setPreferences({ tabsType: v as TabType })}
          style={{ width: 120 }}
        />
      </div>
      </PreferenceControl>
      )}

      {/* ── 颜色模式 ── */}
      {matchesPref(['颜色模式', '深色', '浅色', '系统', '主题模式']) && (
      <PreferenceControl path="colorMode">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>颜色模式</span>
        <RadioGroup
          type="button"
          value={mode}
          onChange={(e) => {
            const v = e.target.value as ThemeMode;
            handleThemeModeChange(v);
          }}
        >
          <Radio value="light">浅色</Radio>
          <Radio value="dark">深色</Radio>
          <Radio value="system">系统</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
      {/* ── 定时深色 ── */}
      {matchesPref(['定时深色', '夜间深色', '自动深色', '深色定时', '深色时段']) && (
      <PreferenceControl path="scheduledDarkMode">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          定时深色
          <Tooltip content="时段内无条件使用深色；时段外跟随颜色模式" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.scheduledDarkMode ?? 'off'}
          onChange={(e) => setPreferences({ scheduledDarkMode: e.target.value as ScheduledDarkMode })}
        >
          <Radio value="off">关闭</Radio>
          <Radio value="custom">自定义时段</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
      {matchesPref(['深色开始时间', '开始时间', '定时深色', '夜间开始']) && (
        <ScheduleTimeInput path="scheduledDarkStart" label="深色开始时间"
          value={preferences.scheduledDarkStart ?? '18:00'}
          onCommit={(value) => setPreferences({ scheduledDarkStart: value })} />
      )}
      {matchesPref(['深色结束时间', '结束时间', '定时深色', '夜间结束']) && (
        <ScheduleTimeInput path="scheduledDarkEnd" label="深色结束时间"
          value={preferences.scheduledDarkEnd ?? '06:00'}
          onCommit={(value) => setPreferences({ scheduledDarkEnd: value })} />
      )}

      {!isDark && matchesPref(['顶部栏深色', '深色', '深色模式', '顶部栏', '顶部导航']) && (
      <PreferenceControl path="headerDarkMode">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>顶部栏深色模式</span>
        <Switch checked={preferences.headerDarkMode ?? false} onChange={(v) => setPreferences({ headerDarkMode: v })} />
      </div>
      </PreferenceControl>
      )}
      {!isDark && matchesPref(['侧边栏深色', '深色', '深色模式', '侧边栏']) && (
      <PreferenceControl path="sidebarDarkMode">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>侧边栏深色模式</span>
        <Switch checked={preferences.sidebarDarkMode ?? false} onChange={(v) => setPreferences({ sidebarDarkMode: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 深色底色档位（仅深色模式下可调；分区深色区域同样跟随） ── */}
      {(isDark || preferences.sidebarDarkMode) && matchesPref(['侧边栏底色', '底色', '色调', '深浅', '侧边栏']) && (
      <PreferenceControl path="darkSidebarTone">
      <PrefDarkToneRow
        label="侧边栏底色"
        hint="标准与卡片、表格同色；更深会比标准再暗一档，让侧边栏从内容中分离出来"
        value={preferences.darkSidebarTone ?? 'bg-1'}
        onChange={(tone) => setPreferences({ darkSidebarTone: tone })}
      />
      </PreferenceControl>
      )}
      {(isDark || preferences.headerDarkMode) && matchesPref(['顶部底色', '底色', '色调', '深浅', '顶部', '顶栏', '标签栏', '面包屑']) && (
      <PreferenceControl path="darkHeaderTone">
      <PrefDarkToneRow
        label="顶部底色"
        hint="作用于顶栏、头部、面包屑栏与标签栏；更深会让整条顶部区域比内容更暗"
        value={preferences.darkHeaderTone ?? 'bg-1'}
        onChange={(tone) => setPreferences({ darkHeaderTone: tone })}
      />
      </PreferenceControl>
      )}
      {isDark && matchesPref(['主区域底色', '底色', '色调', '深浅', '主区域', '内容区', '画布']) && (
      <PreferenceControl path="darkContentTone">
      <PrefDarkToneRow
        label="主区域底色"
        hint="作用于内容画布；更深时卡片与表格会从画布中浮起，形成明度层次"
        value={preferences.darkContentTone ?? 'bg-1'}
        onChange={(tone) => setPreferences({ darkContentTone: tone })}
      />
      </PreferenceControl>
      )}

      {/* ── 主题色 ── */}
      {matchesPref(['主题颜色', '主题色', '颜色', '品牌色', '自定义颜色']) && (
      <PreferenceControl path="themeColor">
      <div>
        <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 500, color: 'var(--semi-color-text-0)' }}>主题颜色</div>
        <SwatchColorPicker
          value={themeColor}
          onChange={setThemeColor}
          options={THEME_COLOR_PRESETS.map((preset) => ({
            key: preset.key,
            label: preset.name,
            color: isDark ? preset.dark.primary : preset.light.primary,
          }))}
        />
      </div>
      </PreferenceControl>
      )}

      {/* ── 圆角大小 ── */}
      {matchesPref(['圆角', '圆角大小', '直角', '边框圆角', 'radius', '外观']) && (
      <PreferenceControl path="borderRadius">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          圆角大小
          <Tooltip content="调整按钮、卡片、弹窗等组件的圆角风格：直角更硬朗，大圆角更柔和" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.borderRadius ?? 'medium'}
          onChange={(e) => setPreferences({ borderRadius: e.target.value as BorderRadiusPreference })}
        >
          <Radio value="none">直角</Radio>
          <Radio value="small">小</Radio>
          <Radio value="medium">默认</Radio>
          <Radio value="large">大</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}

      {/* ── 界面缩放 ── */}
      {matchesPref(['界面缩放', '缩放', '字号', '字体大小', '放大', '缩小', '外观', '无障碍']) && (
      <PreferenceControl path="uiScale">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          界面缩放
          <Tooltip content="整体放大或缩小界面（含文字、控件与弹层），适合高分屏或需要更大字号的场景" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Select
          value={preferences.uiScale ?? 100}
          optionList={UI_SCALE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(v) => setPreferences({ uiScale: v as UiScale })}
          style={{ width: 100 }}
        />
      </div>
      </PreferenceControl>
      )}

      {/* ── 界面字体 ── */}
      {matchesPref(['字体', '界面字体', 'Inter', '思源', '等宽', '外观']) && (
      <PreferenceControl path="fontFamily">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          界面字体
          <Tooltip content="只使用系统已安装的字体，未安装时按预设回退到系统默认字体" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Select
          value={preferences.fontFamily ?? 'system'}
          optionList={FONT_FAMILY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(v) => setPreferences({ fontFamily: v as FontFamilyPreference })}
          style={{ width: 140 }}
        />
      </div>
      </PreferenceControl>
      )}

      {/* ── 加载动画 ── */}
      {matchesPref(['加载动画', '加载效果', 'Loading', '圆点', '圆环', '方块', '律动条', '菊花转', '双弹跳', '水波纹', '进度条']) && (
      <PreferenceControl path="loadingStyle">
      <div>
        <div className="loading-style-picker__heading">
          <span>加载动画</span>
          <Tooltip content="用于首次进入系统、菜单首载和页面懒加载" position="right">
            <Info size={13} />
          </Tooltip>
        </div>
        <div className="loading-style-picker__nav">
          <Button
            theme="borderless"
            size="small"
            className="loading-style-picker__nav-button"
            icon={<ChevronLeft size={14} />}
            aria-label="上一个加载动画"
            title="上一个"
            disabled={!loadingPickerNav.canPrev}
            onClick={() => scrollLoadingPicker(-1)}
          />
          <div className="loading-style-picker" ref={loadingPickerRef}>
          {LOADING_STYLE_OPTIONS.map((option) => {
            const isActive = preferences.loadingStyle === option.value;
            return (
              <button
                type="button"
                key={option.value}
                ref={isActive ? activeLoadingOptionRef : undefined}
                className={`loading-style-picker__option${isActive ? ' loading-style-picker__option--active' : ''}`}
                aria-pressed={isActive}
                title={option.isDefault ? `${option.label}（默认）` : option.label}
                onClick={() => setPreferences({ loadingStyle: option.value })}
              >
                <span className="loading-style-picker__preview">
                  <LoadingIndicator variant={option.value} />
                </span>
                <span className="loading-style-picker__label">
                  {option.label}
                </span>
              </button>
            );
          })}
          </div>
          <Button
            theme="borderless"
            size="small"
            className="loading-style-picker__nav-button"
            icon={<ChevronRight size={14} />}
            aria-label="下一个加载动画"
            title="下一个"
            disabled={!loadingPickerNav.canNext}
            onClick={() => scrollLoadingPicker(1)}
          />
        </div>
      </div>
      </PreferenceControl>
      )}

      {/* ── 无障碍 ── */}
      {matchesPref(['灰色', '灰色模式', '无障碍', '公祭日', '去色']) && (
      <PreferenceControl path="grayscale">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          灰色模式
          <Tooltip content="适用于国家公祭日等场景，全局去除色彩" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch
          checked={preferences.grayscale ?? false}
          onChange={(v) => setPreferences({ grayscale: v, ...(v ? { colorBlind: false } : {}) })}
        />
      </div>
      </PreferenceControl>
      )}
      {matchesPref(['色弱', '色弱模式', '无障碍', '对比度', '色觉']) && (
      <PreferenceControl path="colorBlind">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          色弱模式
          <Tooltip content="提高界面对比度，辅助色觉障碍用户" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch
          checked={preferences.colorBlind ?? false}
          onChange={(v) => setPreferences({ colorBlind: v, ...(v ? { grayscale: false } : {}) })}
        />
      </div>
      </PreferenceControl>
      )}

      {/* ── 减弱动效 ── */}
      {matchesPref(['动效', '动画', '减弱动效', '性能', '晕动', '过渡']) && (
      <PreferenceControl path="reduceMotion">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          减弱动效
          <Tooltip content="关闭路由切换、标签页、主题切换扩散等装饰性动画与过渡；加载指示不受影响。适合低配设备或对动效敏感的用户" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.reduceMotion ?? false} onChange={(v) => setPreferences({ reduceMotion: v })} />
      </div>
      </PreferenceControl>
      )}
    </PreferenceSection>
  );
}

// ── 导航与工具栏 ──
export function PrefsNavToolbarSection({
  prefSection,
  matchesPref,
  preferences,
  setPreferences,
  prefsSearch,
  quickChatEnabled,
}: PrefsSectionBaseProps & Readonly<{ prefsSearch: string; quickChatEnabled: boolean }>) {
  return (
    <PreferenceSection title={prefSection('导航与工具栏')}>

      {/* ── 动态标题 ── */}
      {matchesPref(['动态标题', '浏览器标题', '页面标题', '标题']) && (
      <PreferenceControl path="dynamicTitle">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          动态浏览器标题
          <Tooltip content="开启后浏览器标签页标题会随当前页面变化，如「用户管理 - Zenith Admin」；关闭后固定显示应用名称" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.dynamicTitle ?? true} onChange={(v) => setPreferences({ dynamicTitle: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 面包屑 ── */}
      {matchesPref(['面包屑', '面包屑导航', '导航栏', '路径导航']) && (
      <PreferenceControl path="showBreadcrumb">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          显示面包屑导航
          <Tooltip content="在页面顶部显示路径导航（如：首页 / 系统管理 / 用户管理），帮助定位当前位置" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.showBreadcrumb} onChange={(v) => setPreferences({ showBreadcrumb: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.showBreadcrumb || !!prefsSearch.trim()) && matchesPref(['面包屑图标', '图标', '面包屑']) && (
      <PreferenceControl path="breadcrumbIcon">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>面包屑显示图标</span>
        <Switch checked={preferences.breadcrumbIcon ?? false} onChange={(v) => setPreferences({ breadcrumbIcon: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.showBreadcrumb || !!prefsSearch.trim()) && matchesPref(['面包屑首页', '首页', '面包屑']) && (
      <PreferenceControl path="breadcrumbShowHome">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          面包屑从首页开始
          <Tooltip content="开启后面包屑导航会以「首页」作为第一项，关闭后直接从当前页面的父级路径开始" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.breadcrumbShowHome ?? true} onChange={(v) => setPreferences({ breadcrumbShowHome: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.showBreadcrumb || !!prefsSearch.trim()) && matchesPref(['面包屑可点击', '点击', '面包屑跳转', '面包屑']) && (
      <PreferenceControl path="breadcrumbClickable">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          面包屑可点击
          <Tooltip content="关闭后面包屑仅展示路径文字，不可点击跳转" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.breadcrumbClickable ?? true} onChange={(v) => setPreferences({ breadcrumbClickable: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.showBreadcrumb || !!prefsSearch.trim()) && matchesPref(['面包屑子菜单', '子菜单', '面包屑悬浮', '面包屑展开']) && (
      <PreferenceControl path="breadcrumbSubMenu">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          面包屑子菜单
          <Tooltip content="悬停目录层级时弹出子菜单快速导航，支持多级展开" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.breadcrumbSubMenu ?? false} onChange={(v) => setPreferences({ breadcrumbSubMenu: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 菜单搜索 ── */}
      {matchesPref(['菜单搜索', '搜索框', '搜索', '搜索菜单']) && (
      <PreferenceControl path="showMenuSearch">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>显示菜单搜索框</span>
        <Switch checked={preferences.showMenuSearch ?? true} onChange={(v) => setPreferences({ showMenuSearch: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 收藏 ── */}
      {matchesPref(['收藏', '收藏菜单', '收藏按钮', '显示收藏', '收藏入口', '快捷收藏']) && (
      <PreferenceControl path="showFavorites">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>显示收藏入口</span>
        <Switch checked={preferences.showFavorites ?? false} onChange={(v) => setPreferences({ showFavorites: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 全屏按钮 ── */}
      {matchesPref(['全屏', '全屏按钮', '显示全屏']) && (
      <PreferenceControl path="showFullscreen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>显示全屏按钮</span>
        <Switch checked={preferences.showFullscreen ?? true} onChange={(v) => setPreferences({ showFullscreen: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 回到顶部按钮 ── */}
      {matchesPref(['回到顶部', 'BackTop', '返回顶部', '回到顶', '顶部按钮']) && (
      <PreferenceControl path="showBackTop">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          显示回到顶部按钮
          <Tooltip content="内容区域滚动超过 400px 后，右下角浮现回顶按钮" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.showBackTop ?? true} onChange={(v) => setPreferences({ showBackTop: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 快捷聊天 ── */}
      {quickChatEnabled && matchesPref(['快捷聊天', '聊天', 'AI助手', '聊天按钮', '快捷聊天按钮']) && (
        <PreferenceControl path="showQuickChat">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            显示快捷聊天按钮
            <Tooltip content="在页面右下角显示浮动聊天按钮，可快速唤起 AI 助手" position="right">
              <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
            </Tooltip>
          </span>
          <Switch checked={preferences.showQuickChat ?? true} onChange={(v) => setPreferences({ showQuickChat: v })} />
        </div>
      </PreferenceControl>
      )}
      {/* ── 顶栏时钟 ── */}
      {matchesPref(['顶栏时钟', '时钟', '时钟显示', '12小时', '24小时']) && (
      <PreferenceControl path="topbarClock">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>顶栏时钟</span>
        <RadioGroup
          type="button"
          value={preferences.topbarClock ?? 'off'}
          onChange={(e) => setPreferences({ topbarClock: e.target.value as TopbarClockMode })}
        >
          <Radio value="off">关闭</Radio>
          <Radio value="12h">12小时制</Radio>
          <Radio value="24h">24小时制</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
      {matchesPref(['时钟显示日期', '日期', '时钟日期', '星期']) && (
      <PreferenceControl path="topbarClockShowDate">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>时钟显示日期</span>
        <Switch checked={preferences.topbarClockShowDate ?? true} onChange={(v) => setPreferences({ topbarClockShowDate: v })} />
      </div>
      </PreferenceControl>
      )}

    </PreferenceSection>
  );
}

// ── 侧边栏 ──
export function PrefsSidebarSection({
  prefSection,
  matchesPref,
  preferences,
  setPreferences,
  navLayout,
}: PrefsSectionBaseProps & Readonly<{ navLayout: NavLayout }>) {
  return (
    <PreferenceSection title={prefSection('侧边栏')}>

      {/* ── 侧边栏宽度 ── */}
      {matchesPref(['侧边栏宽度', '侧边栏', '菜单宽度', '展开宽度']) && navLayout !== 'horizontal' && (
      <PreferenceControl path="sidebarWidth">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ flexShrink: 0 }}>侧边栏宽度</span>
        <InputNumber
          style={{ width: 110 }}
          size="small"
          min={160}
          max={320}
          step={4}
          suffix="px"
          value={preferences.sidebarWidth ?? 216}
          onChange={(v) => setPreferences({ sidebarWidth: Number(v) || 216 })}
        />
      </div>
      </PreferenceControl>
      )}

      {/* ── 子菜单箭头位置 ── */}
      {matchesPref(['箭头', '展开箭头', '箭头位置', '展开收起', '子菜单箭头', '侧边栏']) && (
      <PreferenceControl path="sidebarToggleIconPosition">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          子菜单箭头位置
          <Tooltip content="侧边栏可展开子菜单的展开/收起箭头显示位置：默认在菜单项右端，可改为显示在左侧" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.sidebarToggleIconPosition ?? 'right'}
          onChange={(e) => setPreferences({ sidebarToggleIconPosition: e.target.value as 'left' | 'right' })}
        >
          <Radio value="left">左侧</Radio>
          <Radio value="right">右侧</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}

      {/* ── 侧边栏分组标题 sticky ── */}
      {matchesPref(['侧边栏', '分组标题', '滚动固定', '侧边栏分组']) && (
      <PreferenceControl path="sidebarStickyScroll">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          侧边栏分组标题滚动固定
          <Tooltip content="侧边栏菜单滚动时，分组标题吸附固定在顶部，便于识别当前菜单所属分组" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.sidebarStickyScroll ?? true} onChange={(v) => setPreferences({ sidebarStickyScroll: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 侧栏手风琴展开 ── */}
      {matchesPref(['侧边栏', '手风琴', '排他展开', '侧栏排他']) && (
      <PreferenceControl path="sidebarAccordion">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          侧栏排他展开
          <Tooltip content="开启后侧边栏同级菜单同时只允许展开一项，点击其他分组时自动收起之前展开的分组" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.sidebarAccordion ?? false} onChange={(v) => setPreferences({ sidebarAccordion: v })} />
      </div>
      </PreferenceControl>
      )}
      {matchesPref(['悬浮展开', '侧边栏悬浮', '侧边栏', 'hover']) && (
      <PreferenceControl path="sidebarHoverTrigger">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          悬浮展开侧边栏
          <Tooltip content="开启后侧边栏收起时，鼠标悬浮即可临时展开，移开后自动收起" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.sidebarHoverTrigger ?? false} onChange={(v) => setPreferences({ sidebarHoverTrigger: v })} />
      </div>
      </PreferenceControl>
      )}
      {matchesPref(['菜单滚动', '自动定位', '菜单', '滚动定位']) && (
      <PreferenceControl path="scrollMenuIntoView">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          菜单自动滚动定位
          <Tooltip content="开启后切换菜单时，侧边栏自动平滑滚动使激活项居中可见" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.scrollMenuIntoView ?? true} onChange={(v) => setPreferences({ scrollMenuIntoView: v })} />
      </div>
      </PreferenceControl>
      )}
    </PreferenceSection>
  );
}

// ── 通用 ──
export function PrefsGeneralSection({
  prefSection,
  matchesPref,
  preferences,
  setPreferences,
  homePathOptions,
  autoLockMinutes,
  hasPassword,
  clearLockPassword,
  openLockPasswordModal,
}: PrefsSectionBaseProps & Readonly<{
  homePathOptions: { value: string; label: string }[];
  autoLockMinutes: number;
  hasPassword: () => boolean;
  clearLockPassword: () => void;
  openLockPasswordModal: (mode: 'set' | 'change') => void;
}>) {
  return (
    <PreferenceSection title={prefSection('通用')}>

      {/* ── 默认首页 ── */}
      {matchesPref(['默认首页', '首页', '登录跳转', '落地页', '默认页面', '登录页面']) && (
      <PreferenceControl path="homePath">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          登录默认页面
          <Tooltip content="登录成功后进入的页面；不影响日常点击「首页」菜单的行为" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Select
          filter
          style={{ width: 170 }}
          value={preferences.homePath ?? '/'}
          onChange={(v) => setPreferences({ homePath: (v as string) || '/' })}
          optionList={homePathOptions}
        />
      </div>
      </PreferenceControl>
      )}

      {/* ── 时间显示方式 ── */}
      {matchesPref(['时间显示', '相对时间', '绝对时间', '分钟前', '时间格式', '时间戳']) && (
      <PreferenceControl path="timeDisplay">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          时间显示方式
          <Tooltip content="列表、消息与时间线里的时间：绝对时间显示完整日期时刻；相对时间显示「3 分钟前」，悬停查看精确时刻。详情页字段始终为绝对时间" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.timeDisplay ?? 'absolute'}
          onChange={(e) => setPreferences({ timeDisplay: e.target.value as TimeDisplay })}
        >
          <Radio value="absolute">绝对</Radio>
          <Radio value="relative">相对</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}

      {/* ── 一周起始日 ── */}
      {matchesPref(['一周起始日', '周一', '周日', '星期', '日历', '日期选择器', '起始日']) && (
      <PreferenceControl path="weekStart">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          一周起始日
          <Tooltip content="日期选择器与日历面板每周从哪一天开始排列" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.weekStart ?? 'monday'}
          onChange={(e) => setPreferences({ weekStart: e.target.value as WeekStart })}
        >
          <Radio value="monday">周一</Radio>
          <Radio value="sunday">周日</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}

      {/* ── 聚焦时自动刷新 ── */}
      {matchesPref(['自动刷新', '聚焦', '切回', '窗口', '页签', '重新获取', '过期数据', 'refetch']) && (
      <PreferenceControl path="refetchOnFocus">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          切回窗口时自动刷新数据
          <Tooltip content="从其他窗口或页签切回时，自动重新获取已过期的列表与详情数据；网络较差时可关闭" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.refetchOnFocus ?? false} onChange={(v) => setPreferences({ refetchOnFocus: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 页面加载进度条 ── */}
      {matchesPref(['进度条', '加载进度', '页面加载', '顶部进度', 'NProgress']) && (
      <PreferenceControl path="showProgressBar">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          页面加载进度条
          <Tooltip content="页面切换时在内容区顶部显示加载进度条" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.showProgressBar ?? true} onChange={(v) => setPreferences({ showProgressBar: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 全局快捷键 ── */}
      {matchesPref(['快捷键', '键盘', '热键', 'Alt', 'Ctrl', '组合键']) && (
      <PreferenceControl path="enableShortcuts">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          启用全局快捷键
          <Tooltip content="Alt+L 锁屏、Alt+S 收起/展开侧边栏、Alt+C 内容全屏、Ctrl+K 搜索菜单；关闭后这些组合键不再生效" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.enableShortcuts ?? true} onChange={(v) => setPreferences({ enableShortcuts: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 页面状态同步到地址栏 ── */}
      {matchesPref(['地址栏', 'URL', '深链', '页面状态', '查询参数', '分享', '书签', '标签参数', 'tab参数', '选中项']) && (
      <PreferenceControl path="syncPageStateToUrl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          页面状态同步到地址栏
          <Tooltip content="页面内的 Tab 与分栏选中项以查询参数写入地址栏（如 ?tab=），刷新、收藏或分享链接可直达当前视图；关闭时地址栏保持干净，外部带参链接进入仍会生效一次" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.syncPageStateToUrl ?? false} onChange={(v) => setPreferences({ syncPageStateToUrl: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 退出登录确认 ── */}
      {matchesPref(['退出确认', '退出登录', '二次确认', '注销', '登出']) && (
      <PreferenceControl path="confirmLogout">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          退出登录二次确认
          <Tooltip content="关闭后点击「退出登录」将直接退出，不再弹出确认框" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.confirmLogout ?? true} onChange={(v) => setPreferences({ confirmLogout: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 弹窗点击遮罩关闭 ── */}
      {matchesPref(['弹窗', '模态框', '遮罩', '蒙层', '点击关闭', 'maskClosable', '误触']) && (
      <PreferenceControl path="modalClickMaskToClose">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          弹窗点击遮罩关闭
          <Tooltip content="开启后，点击弹窗外的遮罩区域可直接关闭弹窗（按 Esc 关闭不受影响）；关闭时需点击右上角或底部按钮，可防止误触丢失表单内容" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.modalClickMaskToClose ?? false} onChange={(v) => setPreferences({ modalClickMaskToClose: v })} />
      </div>
      </PreferenceControl>
      )}

      {/* ── 文件默认视图 ── */}
      {matchesPref(['文件视图', '文件列表', '文件管理', '列表', '网格', '文件']) && (
      <PreferenceControl path="filesViewMode">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>文件列表默认视图</span>
        <RadioGroup
          type="button"
          value={preferences.filesViewMode ?? 'list'}
          onChange={(e) => setPreferences({ filesViewMode: e.target.value as 'list' | 'grid' })}
        >
          <Radio value="list">列表</Radio>
          <Radio value="grid">网格</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}

      {/* ── 锁屏 ── */}
      {matchesPref(['锁屏', '屏幕锁', '密码', '锁定']) && (
      <PreferenceControl path="enableLockScreen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          开启屏幕锁
          <Tooltip content="开启后可通过 Alt+L 快捷键或用户菜单锁定屏幕，解锁需输入密码" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch
          checked={preferences.enableLockScreen ?? false}
          onChange={(v) => {
            if (v) {
              openLockPasswordModal('set');
            } else {
              clearLockPassword();
              setPreferences({ enableLockScreen: false });
            }
          }}
        />
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableLockScreen ?? false) && matchesPref(['锁屏', '密码', '锁屏密码']) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>锁屏密码</span>
          <Button
            size="small"
            theme="light"
            onClick={() => {
              openLockPasswordModal(hasPassword() ? 'change' : 'set');
            }}
          >
            {hasPassword() ? '修改密码' : '设置密码'}
          </Button>
        </div>
      )}
      {(preferences.enableLockScreen ?? false) && hasPassword() && matchesPref(['自动锁屏', '锁屏', '无操作', '空闲', '闲置']) && (
        <PreferenceControl path="autoLockMinutes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            无操作自动锁屏
            <Tooltip content="超过设定时长没有任何鼠标/键盘操作时自动锁定屏幕" position="right">
              <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
            </Tooltip>
          </span>
          <Select
            style={{ width: 110 }}
            value={autoLockMinutes}
            onChange={(v) => setPreferences({ autoLockMinutes: v as UserPreferences['autoLockMinutes'] })}
            optionList={[
              { value: 0, label: '关闭' },
              { value: 5, label: '5 分钟' },
              { value: 10, label: '10 分钟' },
              { value: 30, label: '30 分钟' },
            ]}
          />
        </div>
      </PreferenceControl>
      )}
    </PreferenceSection>
  );
}

// ── 表格 ──
export function PrefsTableSection({
  prefSection,
  matchesPref,
  preferences,
  setPreferences,
}: PrefsSectionBaseProps) {
  return (
    <PreferenceSection title={prefSection('表格')}>

      {/* ── 表格设置 ── */}
      {matchesPref(['表格', '边框', '斦马纹', '尺寸', '分页', '列设置', '显示表格', '启用斦马纹']) && (
      <>
        <PreferenceControl path="tableBordered">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>显示表格边框</span>
            <Switch checked={preferences.tableBordered ?? true} onChange={(v) => setPreferences({ tableBordered: v })} />
          </div>
        </PreferenceControl>
        <PreferenceControl path="tableStriped">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>启用斑马纹</span>
            <Switch checked={preferences.tableStriped ?? false} onChange={(v) => setPreferences({ tableStriped: v })} />
          </div>
        </PreferenceControl>
        <PreferenceControl path="tableSize">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>表格尺寸</span>
            <RadioGroup
              type="button"
              value={preferences.tableSize ?? 'default'}
              onChange={(e) => setPreferences({ tableSize: e.target.value as TableSizePreference })}
            >
              <Radio value="small">紧凑</Radio>
              <Radio value="middle">适中</Radio>
              <Radio value="default">宽松</Radio>
            </RadioGroup>
          </div>
        </PreferenceControl>
        <PreferenceControl path="tablePageSize">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>默认分页大小</span>
            <Select
              value={preferences.tablePageSize ?? 10}
              onChange={(v) => setPreferences({ tablePageSize: v as UserPreferences['tablePageSize'] })}
              style={{ width: 100 }}
              optionList={[10, 20, 50, 100].map((v) => ({ value: v, label: `${v} 条` }))}
            />
          </div>
        </PreferenceControl>
        <PreferenceControl path="showTableColumnSettings">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>显示表格列设置按钮</span>
            <Switch checked={preferences.showTableColumnSettings ?? true} onChange={(v) => setPreferences({ showTableColumnSettings: v })} />
          </div>
        </PreferenceControl>
      </>
      )}

      {/* ── 记住筛选条件 ── */}
      {matchesPref(['筛选', '筛选条件', '记住', '搜索条件', '恢复', '查询条件', '表格']) && (
      <PreferenceControl path="rememberListFilters">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          记住列表筛选条件
          <Tooltip content="离开列表页再回来时恢复上次查询的筛选条件（分页回到第 1 页）；关闭浏览器即清除" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch
          checked={preferences.rememberListFilters ?? false}
          onChange={(v) => {
            if (!v) clearAllListFilterSnapshots();
            setPreferences({ rememberListFilters: v });
          }}
        />
      </div>
      </PreferenceControl>
      )}
    </PreferenceSection>
  );
}

// ── 标签页 ──
export function PrefsTabsSection({
  prefSection,
  matchesPref,
  preferences,
  setPreferences,
  prefsSearch,
}: PrefsSectionBaseProps & Readonly<{ prefsSearch: string }>) {
  return (
    <PreferenceSection title={prefSection('标签页')}>

      {/* ── 多标签页 ── */}
      {matchesPref(['多标签页', '标签页', '标签', '启用标签']) && (
      <PreferenceControl path="enableTabs">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>启用多标签页</span>
        <Switch checked={preferences.enableTabs} onChange={(v) => setPreferences({ enableTabs: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['保存标签', '恢复标签', '标签页', '标签']) && (
      <PreferenceControl path="keepTabs">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          保存标签页
          <Tooltip content="刷新页面或重新登录后，自动恢复上次打开的标签页" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.keepTabs ?? true} onChange={(v) => setPreferences({ keepTabs: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['页面缓存', 'keepalive', 'keep-alive', '缓存', '标签页', '标签']) && (
      <PreferenceControl path="enablePageCache">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          页面缓存
          <Tooltip content="菜单管理中开启「页面缓存」的页面，切换标签页时保留状态（搜索条件、滚动位置等），关闭标签页时释放" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.enablePageCache ?? true} onChange={(v) => setPreferences({ enablePageCache: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['标签图标', '图标', '标签页', '标签']) && (
      <PreferenceControl path="showTabIcon">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>标签页显示图标</span>
        <Switch checked={preferences.showTabIcon} onChange={(v) => setPreferences({ showTabIcon: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['紧凑标签', '紧凑模式', '页签密度', '标签页', '标签']) && (
      <PreferenceControl path="compactTabs">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          紧凑标签页
          <Tooltip content="减少标签栏的高度与页签间距，适合同时打开较多页面" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch checked={preferences.compactTabs ?? true} onChange={(v) => setPreferences({ compactTabs: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['标签切换器', '切换器', 'chevron', '标签页', '标签']) && (
      <PreferenceControl path="showTabSwitcher">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>显示标签切换器</span>
        <Switch checked={preferences.showTabSwitcher ?? true} onChange={(v) => setPreferences({ showTabSwitcher: v })} />
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['最大标签', '标签数量', '标签页', '标签']) && (
      <PreferenceControl path="tabsMaxCount">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>最大标签数</span>
        <InputNumber
          min={5}
          max={50}
          value={preferences.tabsMaxCount}
          onChange={(v) => setPreferences({ tabsMaxCount: v as number })}
          style={{ width: 100 }}
        />
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['超限策略', 'FIFO', 'LRU', '关闭策略', '标签页', '标签']) && (
      <PreferenceControl path="tabEvictPolicy">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          超限关闭策略
          <Tooltip content="FIFO: 关闭最早打开的标签；LRU: 关闭最久未使用的标签" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.tabEvictPolicy ?? 'fifo'}
          onChange={(e) => setPreferences({ tabEvictPolicy: e.target.value as 'fifo' | 'lru' })}
        >
          <Radio value="fifo">FIFO</Radio>
          <Radio value="lru">LRU</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['插入位置', '新标签位置', '标签插入', '标签页', '标签']) && (
      <PreferenceControl path="openTabBehavior">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          新标签插入位置
          <Tooltip content="末尾：新标签始终排在最右侧；当前后方：新标签紧跟在当前标签之后插入" position="right">
            <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <RadioGroup
          type="button"
          value={preferences.openTabBehavior ?? 'append'}
          onChange={(e) => setPreferences({ openTabBehavior: e.target.value as 'append' | 'insert-next' })}
        >
          <Radio value="append">末尾</Radio>
          <Radio value="insert-next">当前后方</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['双击标签', '双击', '标签行为', '标签页', '标签']) && (
      <PreferenceControl path="tabDoubleClickAction">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>双击标签行为</span>
        <RadioGroup
          type="button"
          value={preferences.tabDoubleClickAction ?? 'refresh'}
          onChange={(e) => setPreferences({ tabDoubleClickAction: e.target.value as 'refresh' | 'close' | 'none' })}
        >
          <Radio value="refresh">刷新</Radio>
          <Radio value="close">关闭</Radio>
          <Radio value="none">无</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['标签风格', '风格', '线条', '胶囊', '卡片', 'chrome', '谷歌', '标签页', '标签']) && (
      <PreferenceControl path="tabStyle">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>标签页风格</span>
        <RadioGroup
          type="button"
          value={preferences.tabStyle ?? 'line'}
          onChange={(e) => setPreferences({ tabStyle: e.target.value as TabStyle })}
        >
          <Radio value="line">线条</Radio>
          <Radio value="pill">胶囊</Radio>
          <Radio value="card">卡片</Radio>
          <Radio value="chrome">谷歌</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
      {(preferences.enableTabs || !!prefsSearch.trim()) && matchesPref(['标签动画', '动画', '淡入', '滑入', '缩放', '标签页', '标签']) && (
      <PreferenceControl path="tabAnimation">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>标签页动画</span>
        <RadioGroup
          type="button"
          value={preferences.tabAnimation ?? 'none'}
          onChange={(e) => setPreferences({ tabAnimation: e.target.value as 'none' | 'fade' | 'slide' | 'scale' })}
        >
          {(['none', 'fade', 'slide', 'scale'] as const).map((anim) => {
            const labels: Record<string, string> = { none: '无', fade: '淡入', slide: '滑入', scale: '缩放' };
            const radio = <Radio key={anim} value={anim}>{labels[anim]}</Radio>;
            if (anim === 'none') return radio;
            return (
              <Popover
                key={anim}
                trigger="hover"
                position="bottom"
                mouseEnterDelay={100}
                mouseLeaveDelay={100}
                content={
                  <div className="tab-anim-preview" data-anim={anim}>
                    <span className="tab-anim-preview__pill">首页</span>
                    <span className="tab-anim-preview__pill tab-anim-preview__pill--active">用户管理</span>
                    <span className="tab-anim-preview__pill tab-anim-preview__demo">角色管理</span>
                  </div>
                }
              >
                {radio}
              </Popover>
            );
          })}
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
      {matchesPref(['路由动画', '切换动画', '动画', '淡入', '上滑', '左滑']) && (
      <PreferenceControl path="routeAnimation">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>路由切换动画</span>
        <RadioGroup
          type="button"
          value={preferences.routeAnimation ?? 'fade'}
          onChange={(e) => setPreferences({ routeAnimation: e.target.value as RouteAnimation })}
        >
          <Radio value="none">无</Radio>
          <Radio value="fade">淡入</Radio>
          <Radio value="slide-up">上滑</Radio>
          <Radio value="slide-left">左滑</Radio>
        </RadioGroup>
      </div>
      </PreferenceControl>
      )}
    </PreferenceSection>
  );
}

// ── 复制 / 导入 / 导出 / 重置 ──
export function PrefsActionsSection({
  handleCopyPreferences,
  onOpenImport,
  onExportPreferences,
  resetPreferences,
}: Readonly<{
  handleCopyPreferences: () => void;
  onOpenImport: () => void;
  onExportPreferences: () => void;
  resetPreferences: () => void;
}>) {
  return (
    <div className="prefs-reset-btn" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SplitButtonGroup style={{ display: 'flex' }}>
        <Button
          theme="light"
          icon={<Copy size={14} />}
          onClick={handleCopyPreferences}
          style={{ flex: 1 }}
        >
          复制偏好
        </Button>
        <Dropdown
          trigger="click"
          position="bottomRight"
          clickToHide
          render={(
            <Dropdown.Menu>
              <Dropdown.Item icon={<ClipboardPaste size={14} />} onClick={onOpenImport}>
                导入偏好
              </Dropdown.Item>
              <Dropdown.Item icon={<Download size={14} />} onClick={onExportPreferences}>
                导出配置文件
              </Dropdown.Item>
            </Dropdown.Menu>
          )}
        >
          <Button theme="light" icon={<ChevronDown size={14} />} aria-label="更多偏好操作" />
        </Dropdown>
      </SplitButtonGroup>
      <Button
        type="danger"
        theme="light"
        block
        onClick={() => {
          confirmDanger({
            title: '恢复系统默认',
            content: '清除个人偏好覆盖，重新跟随系统当前默认值。确定恢复吗？',
            okText: '重置',
            cancelText: '取消',
            onOk: () => {
              resetPreferences();
            },
          });
        }}
      >
        恢复系统默认
      </Button>
    </div>
  );
}
