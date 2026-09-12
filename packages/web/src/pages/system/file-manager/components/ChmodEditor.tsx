/** chmod 权限编辑器：勾选矩阵 ⇄ 八进制输入双向联动，附符号表示预览 */
import React from 'react';
import { Checkbox, Input, Typography } from '@douyinfe/semi-ui';
import { modeToOctal, modeToSymbolic, octalToMode } from '../fs-utils';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

interface ChmodEditorProps {
  readonly value: string;
  readonly onChange: (v: string) => void;
}

export default function ChmodEditor({ value, onChange }: Readonly<ChmodEditorProps>) {
  const mode = octalToMode(value);
  const toggle = (bit: number) => onChange(modeToOctal(mode ^ bit));
  const symbolic = value ? modeToSymbolic(mode) : EMPTY_PLACEHOLDER;
  const headers = ['', '所有者', '群组', '其他用户'];
  const rows = [
    { label: '读 (r)', bits: [0o400, 0o040, 0o004] as const },
    { label: '写 (w)', bits: [0o200, 0o020, 0o002] as const },
    { label: '执行 (x)', bits: [0o100, 0o010, 0o001] as const },
  ];
  const center: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0' };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '76px 1fr 1fr 1fr', marginBottom: 14 }}>
        {headers.map((h) => (
          <div key={h} style={{ ...center, fontSize: 12, color: 'var(--semi-color-text-2)', fontWeight: h ? 500 : 400, paddingBottom: 8, justifyContent: h ? 'center' : 'flex-start' }}>{h}</div>
        ))}
        {rows.map((row) => (
          <React.Fragment key={row.label}>
            <div style={{ ...center, fontSize: 13, color: 'var(--semi-color-text-1)', justifyContent: 'flex-start' }}>{row.label}</div>
            {row.bits.map((bit) => (
              <div key={bit} style={center}>
                <Checkbox checked={(mode & bit) !== 0} onChange={() => toggle(bit)} />
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 4 }}>八进制值</Typography.Text>
          <Input value={value} onChange={onChange} placeholder="755" maxLength={4} style={{ fontFamily: 'monospace' }} />
        </div>
        <div style={{ flex: 1 }}>
          <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 4 }}>符号表示</Typography.Text>
          <div style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2, color: 'var(--semi-color-text-0)', height: 32, display: 'flex', alignItems: 'center' }}>{symbolic}</div>
        </div>
      </div>
    </div>
  );
}
