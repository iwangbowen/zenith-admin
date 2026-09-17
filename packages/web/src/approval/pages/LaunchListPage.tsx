import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Skeleton, Tag } from '@douyinfe/semi-ui';
import { ChevronLeft, ChevronRight, Clock, Monitor } from 'lucide-react';
import type { WorkflowDefinition } from '@zenith/shared/workflow';
import { canLaunchOnMobile } from '../lib/launch';
import { getRecentDefinitionIds } from '../lib/recent';
import { usePublishedDefinitions } from '../lib/queries';
import { KeywordInput } from '@/components/search-filters';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { textMatches } from '@/utils/pinyin';

function DefCard({ def, onOpen }: Readonly<{ def: WorkflowDefinition; onOpen: () => void }>) {
  const mobileOk = canLaunchOnMobile(def);
  return (
    <div
      className="ap-card"
      style={mobileOk ? undefined : { opacity: 0.65, cursor: 'default' }}
      role="button"
      tabIndex={0}
      onClick={() => { if (mobileOk) onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && mobileOk) onOpen(); }}
    >
      <div className="ap-card__title-row">
        <span className="ap-card__title">{def.name}</span>
        {mobileOk
          ? <ChevronRight size={16} color="var(--semi-color-text-2)" />
          : <Tag size="small" color="grey" prefixIcon={<Monitor size={12} />}>请到桌面端发起</Tag>}
      </div>
      {def.description && <div className="ap-card__meta">{def.description}</div>}
    </div>
  );
}

export default function LaunchListPage() {
  const navigate = useNavigate();
  const defsQuery = usePublishedDefinitions();
  const [keyword, setKeyword] = useState('');
  const defs = useMemo(() => defsQuery.data ?? [], [defsQuery.data]);
  // 拼音词典就绪后重算过滤，补上已输入关键字的拼音命中；pinyinReady 仅作为重算信号
  const pinyinReady = usePinyinReady();

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return defs;
    return defs.filter((d) =>
      textMatches(d.name, kw) || textMatches(d.description ?? '', kw));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, keyword, pinyinReady]);

  // 最近使用：仅在未搜索时展示，按 localStorage 顺序取仍已发布的定义
  const recent = useMemo(() => {
    if (keyword.trim()) return [];
    const ids = getRecentDefinitionIds();
    return ids
      .map((id) => defs.find((d) => d.id === id))
      .filter((d): d is WorkflowDefinition => d != null);
  }, [defs, keyword]);

  const groups = useMemo(() => {
    const map = new Map<string, WorkflowDefinition[]>();
    for (const def of filtered) {
      const key = def.categoryName ?? '未分类';
      const arr = map.get(key) ?? [];
      arr.push(def);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="ap-page">
      <div className="ap-header">
        <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
        <span className="ap-header__title">发起申请</span>
      </div>
      <div className="ap-search">
        <KeywordInput placeholder="搜索流程名称" value={keyword} onChange={setKeyword} />
      </div>
      <div className="ap-body">
        {defsQuery.isLoading && <Skeleton placeholder={<Skeleton.Paragraph rows={5} />} loading active />}
        {!defsQuery.isLoading && filtered.length === 0 && (
          <Empty description={keyword ? '没有匹配的流程' : '暂无可发起的流程'} style={{ paddingTop: 60 }} />
        )}
        {recent.length > 0 && (
          <div>
            <div className="ap-section-title"><Clock size={12} style={{ verticalAlign: -1, marginRight: 4 }} />最近使用</div>
            {recent.map((def) => (
              <DefCard key={`recent-${def.id}`} def={def} onOpen={() => navigate(`/launch/${def.id}`)} />
            ))}
          </div>
        )}
        {groups.map(([category, list]) => (
          <div key={category}>
            <div className="ap-section-title">{category}</div>
            {list.map((def) => (
              <DefCard key={def.id} def={def} onOpen={() => navigate(`/launch/${def.id}`)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
