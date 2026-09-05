/** 矩阵量表：多行共用一组选项，值为 { 行: 选中列 } */
import { Radio, Typography, withField } from '@douyinfe/semi-ui';

interface MatrixInputProps {
  value?: Record<string, string>;
  onChange?: (value: Record<string, string>) => void;
  rows: string[];
  cols: string[];
  disabled?: boolean;
}

function MatrixInput({ value, onChange, rows, cols, disabled }: Readonly<MatrixInputProps>) {
  const val = value ?? {};
  if (rows.length === 0 || cols.length === 0) {
    return <Typography.Text type="tertiary">请在设计器中配置矩阵的行与列</Typography.Text>;
  }
  return (
    <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--semi-color-fill-0)' }}>
            <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 12, color: 'var(--semi-color-text-1)' }} />
            {cols.map((c) => (
              <th key={c} style={{ padding: '8px 6px', fontSize: 12, color: 'var(--semi-color-text-1)', fontWeight: 600, textAlign: 'center' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r} style={{ borderTop: '1px solid var(--semi-color-border)' }}>
              <td style={{ padding: '8px 10px', fontSize: 13 }}>{r}</td>
              {cols.map((c) => (
                <td key={c} style={{ padding: '8px 6px', textAlign: 'center' }}>
                  <Radio
                    checked={val[r] === c}
                    disabled={disabled}
                    onChange={() => onChange?.({ ...val, [r]: c })}
                    aria-label={`${r}-${c}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const FormMatrix = withField(MatrixInput);
