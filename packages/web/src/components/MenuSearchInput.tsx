import { useState, useCallback, useRef } from 'react';
import { AutoComplete } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { renderLucideIcon } from '@/utils/icons';

export interface FlatMenuItem {
  id: number;
  title: string;
  path: string;
  icon?: string;
  breadcrumb: string[];
}

interface MenuSearchInputProps {
  readonly menus: FlatMenuItem[];
}

export default function MenuSearchInput({ menus }: MenuSearchInputProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const justSelectedRef = useRef(false);

  const filteredData = useCallback(
    (query: string) => {
      if (!query.trim()) return [];
      const q = query.toLowerCase();
      return menus.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.breadcrumb.some((b) => b.toLowerCase().includes(q))
      ).slice(0, 10);
    },
    [menus]
  );

  const renderItem = (item: FlatMenuItem) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      {item.icon
        ? <span style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }}>{renderLucideIcon(item.icon, 14)}</span>
        : <Search size={14} style={{ color: 'var(--semi-color-text-3)', flexShrink: 0 }} />
      }
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--semi-color-text-0)', lineHeight: 1.4 }}>{item.title}</div>
        {item.breadcrumb.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--semi-color-text-3)', lineHeight: 1.3 }}>
            {item.breadcrumb.join(' / ')}
          </div>
        )}
      </div>
    </div>
  );

  const data = filteredData(value);

  return (
    <AutoComplete
      value={value}
      data={data.map((m) => ({ value: String(m.id), label: m.title, _id: m.id }))}
      style={{ width: 200 }}
      size="small"
      prefix={<Search size={13} style={{ color: 'var(--semi-color-text-3)' }} />}
      placeholder="搜索菜单..."
      showClear
      renderItem={(item) => {
        const raw = item as { value: string };
        const found = menus.find((m) => m.id === Number(raw.value));
        return found ? renderItem(found) : null;
      }}
      onSearch={(v) => setValue(v)}
      onChange={(v) => {
        if (justSelectedRef.current) {
          justSelectedRef.current = false;
          return;
        }
        setValue(v as string);
      }}
      onSelect={(v) => {
        justSelectedRef.current = true;
        const id = Number(v as string);
        const item = menus.find((m) => m.id === id);
        if (item?.path) {
          navigate(item.path);
        }
        setValue('');
      }}
    />
  );
}
