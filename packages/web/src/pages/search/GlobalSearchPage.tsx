import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Empty, Input, List, Select, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { Search, Bookmark } from 'lucide-react';
import { globalSearchTypes, type GlobalSearchType } from '@zenith/shared/platform';
import { useGlobalSearch } from '@/hooks/queries/global-search';
import { renderLucideIcon } from '@/utils/icons';
import { GLOBAL_SEARCH_TYPE_LABELS, GLOBAL_SEARCH_TYPE_OPTIONS, isSafeInternalSearchRoute } from '@/utils/global-search';

const TYPE_LABELS = GLOBAL_SEARCH_TYPE_LABELS;
const TYPE_OPTIONS = GLOBAL_SEARCH_TYPE_OPTIONS;
const SAVED_KEY = 'zenith:global-search:saved';
type SavedSearch = { q: string; type?: GlobalSearchType; label: string };

function loadSaved(): SavedSearch[] {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((item): item is SavedSearch => !!item && typeof item === 'object' && typeof (item as SavedSearch).q === 'string') : [];
  } catch { return []; }
}

export default function GlobalSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState(searchParams.get('q') ?? '');
  const [type, setType] = useState<GlobalSearchType | undefined>(() => {
    const value = searchParams.get('type');
    return value && globalSearchTypes.includes(value as GlobalSearchType) ? value as GlobalSearchType : undefined;
  });
  const [limit, setLimit] = useState(10);
  const [sort, setSort] = useState<'relevance' | 'type'>('relevance');
  const [saved, setSaved] = useState<SavedSearch[]>(loadSaved);
  const search = useGlobalSearch(draft, true, type ? [type] : undefined, limit);
  const query = draft.trim();
  const urlType = searchParams.get('type');
  const urlQuery = searchParams.get('q') ?? '';

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (query) next.set('q', query); else next.delete('q');
    if (type) next.set('type', type); else next.delete('type');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [query, type, searchParams, setSearchParams]);

  useEffect(() => {
    const normalizedType = urlType && globalSearchTypes.includes(urlType as GlobalSearchType)
      ? urlType as GlobalSearchType
      : undefined;
    if (urlQuery !== query) setDraft(urlQuery);
    if (normalizedType !== type) setType(normalizedType);
  }, [urlQuery, urlType]);

  useEffect(() => { setLimit(10); }, [query, type]);

  const results = useMemo(() => {
    const list = [...(search.data?.results ?? [])];
    if (sort === 'type') list.sort((a, b) => TYPE_LABELS[a.type].localeCompare(TYPE_LABELS[b.type], 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN'));
    return list;
  }, [search.data?.results, sort]);

  function saveCurrent() {
    const q = draft.trim();
    if (!q) return;
    const next = [{ q, type, label: `${q}${type ? ` · ${TYPE_LABELS[type]}` : ''}` }, ...saved.filter((item) => item.q !== q || item.type !== type)].slice(0, 10);
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  }

  function removeSaved(item: SavedSearch) {
    const next = saved.filter((candidate) => candidate !== item);
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Search size={20} />
        <Typography.Title heading={4} style={{ margin: 0 }}>搜索中心</Typography.Title>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <Input prefix={<Search size={16} />} value={draft} onChange={setDraft} onEnterPress={() => setDraft(draft.trim())} placeholder="全局搜索" showClear style={{ width: 420 }} />
        <Select placeholder="全部类型" value={type} onChange={(value) => setType(value as GlobalSearchType | undefined)} optionList={TYPE_OPTIONS} showClear style={{ width: 160 }} />
        <Select value={sort} onChange={(value) => setSort(value as 'relevance' | 'type')} optionList={[{ value: 'relevance', label: '按相关性' }, { value: 'type', label: '按类型' }]} style={{ width: 130 }} />
        <Button icon={<Bookmark size={14} />} onClick={saveCurrent} disabled={!query}>保存条件</Button>
      </div>

      {saved.length > 0 && <Space wrap spacing={8} style={{ marginBottom: 16 }}>
        {saved.map((item) => <Tag key={`${item.q}-${item.type ?? 'all'}`} closable onClose={() => removeSaved(item)} onClick={() => { setDraft(item.q); setType(item.type); }}>{item.label}</Tag>)}
      </Space>}

      {search.isFetching && <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spin /></div>}
      {!search.isFetching && search.error && <Empty description="搜索暂时不可用，请稍后重试" />}
      {!search.isFetching && !search.error && query.length >= 2 && results.length === 0 && <Empty description="没有找到匹配结果" />}
      {!search.isFetching && !search.error && query.length < 2 && <Empty description="输入至少 2 个字符开始搜索" />}

      {!search.isFetching && results.length > 0 && <List
        size="default"
        split
        dataSource={results}
        renderItem={(item) => (
          <List.Item
            key={`${item.type}-${item.id}`}
            onClick={() => { if (isSafeInternalSearchRoute(item.route)) navigate(item.route); }}
            style={{ cursor: 'pointer', padding: '12px 8px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'var(--semi-color-fill-1)', color: 'var(--semi-color-primary)', flexShrink: 0 }}>{item.icon ? renderLucideIcon(item.icon, 16) : <Search size={16} />}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text strong ellipsis>{item.title}</Typography.Text>
                <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>{[TYPE_LABELS[item.type], item.subtitle, item.description].filter(Boolean).join(' · ')}</div>
                {item.highlights[0] && <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>命中：{item.highlights[0].text}</div>}
              </span>
            </div>
          </List.Item>
        )}
      />}

      {!search.isFetching && results.length >= limit && limit < 50 && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}><Button onClick={() => setLimit((value) => Math.min(value + 10, 50))}>加载更多</Button></div>}
      {search.data?.partial && <Typography.Text type="tertiary" style={{ display: 'block', marginTop: 12 }}>部分结果暂时不可用</Typography.Text>}
    </div>
  );
}
