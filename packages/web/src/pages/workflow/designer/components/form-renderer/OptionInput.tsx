/** select / radio 「其他」可填 包装控件：选中「其他」后追加自由文本输入 */
import { useEffect, useState } from 'react';
import { Input, RadioGroup, Select, withField } from '@douyinfe/semi-ui';
import { optionLabelNode, type DisplayOption } from './field-utils';

const OTHER_VALUE = '__other__';

interface OptionInputProps {
  value?: string;
  onChange?: (v: string | undefined) => void;
  disabled?: boolean;
  mode: 'select' | 'radio';
  options: DisplayOption[];
  allowOther?: boolean;
  placeholder?: string;
}

function OptionInput({ value, onChange, disabled, mode, options, allowOther, placeholder }: Readonly<OptionInputProps>) {
  const known = new Set(options.map((o) => o.value));
  const valueIsOther = allowOther && value != null && value !== '' && !known.has(value);
  const [otherMode, setOtherMode] = useState(!!valueIsOther);
  useEffect(() => { if (valueIsOther) setOtherMode(true); }, [valueIsOther]);
  const showOther = !!allowOther && (otherMode || !!valueIsOther);
  const controlValue = showOther ? OTHER_VALUE : value;
  const pick = (v: string) => {
    if (v === OTHER_VALUE) { setOtherMode(true); onChange?.(''); }
    else { setOtherMode(false); onChange?.(v); }
  };
  const otherInput = showOther ? (
    <Input
      style={{ marginTop: 8 }}
      value={value ?? ''}
      onChange={(v) => onChange?.(v)}
      placeholder="请填写其他"
      disabled={disabled}
    />
  ) : null;

  if (mode === 'radio') {
    return (
      <div>
        <RadioGroup
          value={controlValue}
          disabled={disabled}
          onChange={(e) => pick(String(e.target.value))}
          options={[
            ...options.map((o) => ({ label: optionLabelNode(o), value: o.value, disabled: o.disabled })),
            ...(allowOther ? [{ label: '其他', value: OTHER_VALUE }] : []),
          ]}
        />
        {otherInput}
      </div>
    );
  }
  return (
    <div>
      <Select
        value={controlValue}
        disabled={disabled}
        placeholder={placeholder}
        style={{ width: '100%' }}
        onChange={(v) => pick(String(v))}
      >
        {options.map((o) => (
          <Select.Option key={o.value} value={o.value} disabled={o.disabled}>{optionLabelNode(o)}</Select.Option>
        ))}
        {allowOther && <Select.Option value={OTHER_VALUE}>其他…</Select.Option>}
      </Select>
      {otherInput}
    </div>
  );
}

export const FormOptionInput = withField(OptionInput);
