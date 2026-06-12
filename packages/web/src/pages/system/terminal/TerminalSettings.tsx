import type { ReactNode } from 'react';
import { SideSheet, Select, InputNumber, Button, Typography, Divider } from '@douyinfe/semi-ui';
import { RotateCcw } from 'lucide-react';
import { useTerminalPreferences, defaultTerminalPreferences } from './useTerminalPreferences';
import { DARK_THEMES, LIGHT_THEMES, FONT_FAMILY_PRESETS } from './themes';

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
    <SideSheet title="终端设置" visible={visible} onCancel={onClose} width={360} placement="right">
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

      <Field label="暗色模式主题">
        <Select
          value={terminal.themeDark}
          onChange={(v) => setTerminalPref({ themeDark: typeof v === 'string' ? v : terminal.themeDark })}
          style={{ width: '100%' }}
        >
          {DARK_THEMES.map((t) => (
            <Select.Option key={t.id} value={t.id}>
              {t.name}
            </Select.Option>
          ))}
        </Select>
      </Field>

      <Field label="亮色模式主题">
        <Select
          value={terminal.themeLight}
          onChange={(v) => setTerminalPref({ themeLight: typeof v === 'string' ? v : terminal.themeLight })}
          style={{ width: '100%' }}
        >
          {LIGHT_THEMES.map((t) => (
            <Select.Option key={t.id} value={t.id}>
              {t.name}
            </Select.Option>
          ))}
        </Select>
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

      <Divider margin="12px" />

      <Button icon={<RotateCcw size={14} />} onClick={() => setTerminalPref({ ...defaultTerminalPreferences, favorites: terminal.favorites })} block>
        恢复默认（保留收藏）
      </Button>
    </SideSheet>
  );
}
