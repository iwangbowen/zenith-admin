import type { ReactNode } from 'react';
import { SideSheet, Select, InputNumber, Button, Typography, Divider, Switch } from '@douyinfe/semi-ui';
import { RotateCcw } from 'lucide-react';
import { useTerminalPreferences, defaultTerminalPreferences } from './useTerminalPreferences';
import { DARK_THEMES, LIGHT_THEMES, FONT_FAMILY_PRESETS } from './themes';
import ThemePicker from './ThemePicker';

interface ShellOption {
  id: string;
  label: string;
}

interface TerminalSettingsProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly shells: ShellOption[];
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 6 }}>
        {label}
      </Typography.Text>
      {children}
    </div>
  );
}

export default function TerminalSettings({ visible, onClose, shells }: TerminalSettingsProps) {
  const { terminal, setTerminalPref } = useTerminalPreferences();

  return (
    <SideSheet title="终端设置" visible={visible} onCancel={onClose} width={400} placement="right">
      <Field label="默认 Shell">
        <Select
          value={shells.some((s) => s.id === terminal.defaultShell) ? terminal.defaultShell : ''}
          onChange={(v) => setTerminalPref({ defaultShell: typeof v === 'string' ? v : '' })}
          style={{ width: '100%' }}
        >
          <Select.Option value="">服务器默认</Select.Option>
          {shells.map((s) => (
            <Select.Option key={s.id} value={s.id}>
              {s.label}
            </Select.Option>
          ))}
        </Select>
      </Field>

      <Divider margin="12px" />

      <Field label="标签栏位置">
        <Select
          value={terminal.tabPosition ?? 'top'}
          onChange={(v) => setTerminalPref({ tabPosition: (v as 'top' | 'right' | 'bottom') ?? 'top' })}
          style={{ width: '100%' }}
        >
          <Select.Option value="top">顶部（默认）</Select.Option>
          <Select.Option value="left">左侧</Select.Option>
          <Select.Option value="right">右侧（VS Code 风格）</Select.Option>
          <Select.Option value="bottom">底部</Select.Option>
        </Select>
      </Field>

      {(terminal.tabPosition === 'right' || terminal.tabPosition === 'left') && (
        <Field label="右侧标签栏折叠为图标">
          <Switch
            checked={terminal.tabCollapsed ?? false}
            onChange={(v) => setTerminalPref({ tabCollapsed: v })}
          />
        </Field>
      )}

      <Divider margin="12px" />

      <Field label="暗色模式主题">
        <ThemePicker
          themes={DARK_THEMES}
          value={terminal.themeDark}
          onChange={(id) => setTerminalPref({ themeDark: id })}
        />
      </Field>

      <Field label="亮色模式主题">
        <ThemePicker
          themes={LIGHT_THEMES}
          value={terminal.themeLight}
          onChange={(id) => setTerminalPref({ themeLight: id })}
        />
      </Field>

      <Typography.Text size="small" type="quaternary" style={{ display: 'block', marginTop: -8, marginBottom: 12 }}>
        主题随应用明暗模式自动切换，可分别为亮 / 暗模式指定配色。
      </Typography.Text>

      <Divider margin="12px" />

      <Field label="字体">
        <Select
          value={terminal.fontFamily}
          onChange={(v) => setTerminalPref({ fontFamily: typeof v === 'string' ? v : terminal.fontFamily })}
          style={{ width: '100%' }}
          filter
          allowCreate
        >
          {FONT_FAMILY_PRESETS.map((f) => (
            <Select.Option key={f.label} value={f.value}>
              {f.label}
            </Select.Option>
          ))}
        </Select>
      </Field>

      <Field label="字号">
        <InputNumber
          value={terminal.fontSize}
          min={10}
          max={28}
          step={1}
          onChange={(v) => setTerminalPref({ fontSize: Number(v) || 14 })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label="行高">
        <InputNumber
          value={terminal.lineHeight}
          min={1}
          max={2}
          step={0.1}
          onChange={(v) => setTerminalPref({ lineHeight: Number(v) || 1.2 })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label="滚回行数">
        <InputNumber
          value={terminal.scrollback ?? 5000}
          min={100}
          max={100000}
          step={1000}
          onChange={(v) => setTerminalPref({ scrollback: Number(v) || 5000 })}
          style={{ width: '100%' }}
          formatter={(v) => `${v} 行`}
          parser={(v) => (v ? v.replace(' 行', '') : '')}
        />
      </Field>

      <Divider margin="12px" />

      <Field label="光标样式">
        <Select
          value={terminal.cursorStyle ?? 'block'}
          onChange={(v) => setTerminalPref({ cursorStyle: (v as 'block' | 'underline' | 'bar') ?? 'block' })}
          style={{ width: '100%' }}
        >
          <Select.Option value="block">块状（默认）</Select.Option>
          <Select.Option value="underline">下划线</Select.Option>
          <Select.Option value="bar">竖线（VS Code 风格）</Select.Option>
        </Select>
      </Field>

      <Field label="光标闪烁">
        <Switch
          checked={terminal.cursorBlink ?? true}
          onChange={(v) => setTerminalPref({ cursorBlink: v })}
        />
      </Field>

      <Divider margin="12px" />

      <Field label="选中文字自动复制">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch
            checked={terminal.copyOnSelect ?? false}
            onChange={(v) => setTerminalPref({ copyOnSelect: v })}
          />
          <Typography.Text size="small" type="tertiary">选中即复制到剪贴板</Typography.Text>
        </div>
      </Field>

      <Field label="渲染模式">
        <Select
          value={terminal.rendererType ?? 'canvas'}
          onChange={(v) => setTerminalPref({ rendererType: (v as 'canvas' | 'webgl') ?? 'canvas' })}
          style={{ width: '100%' }}
        >
          <Select.Option value="canvas">Canvas（默认，兼容性好）</Select.Option>
          <Select.Option value="webgl">WebGL（高性能，GPU 加速）</Select.Option>
        </Select>
        <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 4 }}>
          WebGL 模式在大量输出时帧率更高，需重新打开终端生效。
        </Typography.Text>
      </Field>

      <Field label="快速滚动倍率（Alt+滚轮）">
        <InputNumber
          value={terminal.fastScrollSensitivity ?? 5}
          min={1}
          max={20}
          step={1}
          onChange={(v) => setTerminalPref({ fastScrollSensitivity: Number(v) || 5 })}
          style={{ width: '100%' }}
          formatter={(v) => `${v}x`}
          parser={(v) => (v ? v.replace('x', '') : '')}
        />
      </Field>

      <Divider margin="12px" />

      <Field label="字母间距">
        <InputNumber
          value={terminal.letterSpacing ?? 0}
          min={0}
          max={8}
          step={0.5}
          onChange={(v) => setTerminalPref({ letterSpacing: Number(v) || 0 })}
          style={{ width: '100%' }}
          formatter={(v) => `${v} px`}
          parser={(v) => (v ? v.replace(' px', '') : '')}
        />
      </Field>

      <Field label="字体粗细">
        <Select
          value={terminal.fontWeight ?? 'normal'}
          onChange={(v) => setTerminalPref({ fontWeight: typeof v === 'string' ? v : 'normal' })}
          style={{ width: '100%' }}
        >
          <Select.Option value="normal">正常</Select.Option>
          <Select.Option value="bold">粗体</Select.Option>
          <Select.Option value="600">半粗（600）</Select.Option>
          <Select.Option value="300">细体（300）</Select.Option>
        </Select>
      </Field>

      <Field label="响铃方式">
        <Select
          value={terminal.bellStyle ?? 'none'}
          onChange={(v) => setTerminalPref({ bellStyle: (v as 'none' | 'visual' | 'sound') ?? 'none' })}
          style={{ width: '100%' }}
        >
          <Select.Option value="none">不响铃（默认）</Select.Option>
          <Select.Option value="visual">闪屏</Select.Option>
          <Select.Option value="sound">声音</Select.Option>
        </Select>
        <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 4 }}>
          服务端输出 \a 时触发。声音需浏览器允许自动播放。
        </Typography.Text>
      </Field>

      <Field label="右键选词">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch
            checked={terminal.rightClickSelectsWord ?? false}
            onChange={(v) => setTerminalPref({ rightClickSelectsWord: v })}
          />
          <Typography.Text size="small" type="tertiary">开启后右键选中光标处单词，关闭则弹出浏览器菜单</Typography.Text>
        </div>
      </Field>

      <Field label="最小对比度">
        <InputNumber
          value={terminal.minimumContrastRatio ?? 1}
          min={1}
          max={21}
          step={1}
          onChange={(v) => setTerminalPref({ minimumContrastRatio: Number(v) || 1 })}
          style={{ width: '100%' }}
          formatter={(v) => (Number(v) <= 1 ? `${v}（不限制）` : `${v}:1`)}
          parser={(v) => (v ? v.replace(/（.*|\s*:1.*/, '') : '')}
        />
        <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 4 }}>
          强制前景色与背景色的对比度达标（WCAG AA = 4.5，AAA = 7）。
        </Typography.Text>
      </Field>

      <Divider margin="12px" />

      <Button icon={<RotateCcw size={14} />} onClick={() => setTerminalPref({ ...defaultTerminalPreferences, favorites: terminal.favorites })} block>
        恢复默认（保留收藏）
      </Button>
    </SideSheet>
  );
}
