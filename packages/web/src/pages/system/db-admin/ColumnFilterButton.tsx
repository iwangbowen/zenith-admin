import { useEffect, useState } from 'react';
import { Button, Input, Popover, Select, Space } from '@douyinfe/semi-ui';
import { Filter } from 'lucide-react';
import { BASIC_COMPARISON_OPERATOR_OPTIONS } from '@zenith/shared';

const OPS = [
  { label: '包含 (ILIKE)', value: 'ilike' },
  ...BASIC_COMPARISON_OPERATOR_OPTIONS,
  { label: '为空 IS NULL', value: 'isnull' },
  { label: '非空 IS NOT NULL', value: 'notnull' },
];

function parseEncoded(s: string): { op: string; value: string } {
  const m = /^(eq|neq|gt|gte|lt|lte|like|ilike|isnull|notnull)\|([\s\S]*)$/.exec(s);
  if (m) return { op: m[1], value: m[2] };
  return { op: 'ilike', value: s };
}

interface ColumnFilterButtonProps {
  columnName: string;
  /** 当前筛选编码串（`op|value`），空串表示未筛选 */
  value: string;
  onChange: (encoded: string | null) => void;
}

/** 表头漏斗筛选按钮：Popover 内选择操作符 + 输入值，编码格式与后端 filters 协议一致 */
export function ColumnFilterButton({ columnName, value, onChange }: ColumnFilterButtonProps) {
  const [visible, setVisible] = useState(false);
  const [op, setOp] = useState('ilike');
  const [keyword, setKeyword] = useState('');
  const active = value.length > 0;

  useEffect(() => {
    if (visible) {
      const parsed = parseEncoded(value);
      setOp(parsed.op);
      setKeyword(parsed.value);
    }
  }, [visible, value]);

  const needsValue = op !== 'isnull' && op !== 'notnull';

  const apply = () => {
    if (needsValue && keyword.trim().length === 0) {
      onChange(null);
    } else {
      onChange(`${op}|${needsValue ? keyword.trim() : ''}`);
    }
    setVisible(false);
  };

  const reset = () => {
    onChange(null);
    setVisible(false);
  };

  const content = (
    <div style={{ padding: 8, width: 260 }}>
      <Space vertical align="start" style={{ width: '100%' }}>
        <Select
          size="small"
          value={op}
          onChange={(v) => setOp(String(v))}
          style={{ width: '100%' }}
          optionList={OPS}
        />
        {needsValue && (
          <Input
            size="small"
            autoFocus
            value={keyword}
            onChange={setKeyword}
            onEnterPress={apply}
            placeholder={`筛选 ${columnName}……`}
          />
        )}
      </Space>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Button size="small" theme="borderless" onClick={reset}>重置</Button>
        <Button size="small" theme="solid" type="primary" onClick={apply}>筛选</Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="custom"
      visible={visible}
      onVisibleChange={setVisible}
      onClickOutSide={() => setVisible(false)}
      position="bottomRight"
      getPopupContainer={() => document.body}
    >
      <button
        type="button"
        className="dg-cell-action"
        aria-label={`筛选 ${columnName}`}
        style={active ? { color: 'var(--semi-color-primary)', background: 'var(--semi-color-primary-light-default)' } : undefined}
        onClick={(e) => { e.stopPropagation(); setVisible((v) => !v); }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Filter size={11} fill={active ? 'currentColor' : 'none'} />
      </button>
    </Popover>
  );
}
