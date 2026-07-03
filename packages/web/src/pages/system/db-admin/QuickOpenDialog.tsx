import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Modal, Tag, Typography } from '@douyinfe/semi-ui';
import { Search, Table as TableIcon, Eye } from 'lucide-react';
import { quickOpenScore, type QuickOpenTable } from './quick-open-score';

const { Text } = Typography;

export type { QuickOpenTable };

interface QuickOpenDialogProps {
  visible: boolean;
  tables: QuickOpenTable[];
  onClose: () => void;
  onSelect: (table: QuickOpenTable) => void;
}

/** Ctrl+P 快速打开：模糊搜索表并跳转（借鉴 dbx QuickOpenDialog） */
export function QuickOpenDialog({ visible, tables, onClose, onSelect }: Readonly<QuickOpenDialogProps>) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setActiveIdx(0);
    }
  }, [visible]);

  const matches = useMemo(() => {
    const scored: Array<{ table: QuickOpenTable; score: number }> = [];
    for (const t of tables) {
      const s = quickOpenScore(query, t);
      if (s !== null) scored.push({ table: t, score: s });
    }
    scored.sort((a, b) => b.score - a.score || a.table.name.localeCompare(b.table.name));
    return scored.slice(0, 50).map((x) => x.table);
  }, [tables, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [matches]);

  const commit = useCallback((t: QuickOpenTable | undefined) => {
    if (!t) return;
    onSelect(t);
    onClose();
  }, [onSelect, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(matches[activeIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={520}
      style={{ top: 90 }}
      bodyStyle={{ padding: 8 }}
    >
      <Input
        autoFocus
        size="large"
        prefix={<Search size={16} />}
        placeholder="搜索表名 / schema / 注释…（↑↓ 选择，Enter 打开）"
        value={query}
        onChange={setQuery}
        onKeyDown={handleKeyDown}
      />
      <div ref={listRef} style={{ maxHeight: 380, overflow: 'auto', marginTop: 8 }}>
        {matches.length === 0 && (
          <Text type="tertiary" size="small" style={{ display: 'block', padding: 16, textAlign: 'center' }}>
            无匹配的表
          </Text>
        )}
        {matches.map((t, i) => (
          <button
            key={`${t.schema}.${t.name}`}
            type="button"
            data-idx={i}
            onClick={() => commit(t)}
            onMouseEnter={() => setActiveIdx(i)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              textAlign: 'left',
              background: i === activeIdx ? 'var(--semi-color-primary-light-default)' : 'transparent',
            }}
          >
            {t.kind === 'table'
              ? <TableIcon size={14} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
              : <Eye size={14} style={{ color: 'var(--semi-color-info)', flexShrink: 0 }} />}
            <Text strong size="small">{t.name}</Text>
            {t.schema !== 'public' && <Tag size="small">{t.schema}</Tag>}
            {t.kind !== 'table' && <Tag size="small" color="cyan">{t.kind === 'view' ? '视图' : '物化视图'}</Tag>}
            {t.comment && (
              <Text type="tertiary" size="small" ellipsis style={{ flex: 1, minWidth: 0 }}>
                {t.comment}
              </Text>
            )}
          </button>
        ))}
      </div>
    </Modal>
  );
}

QuickOpenDialog.displayName = 'QuickOpenDialog';
