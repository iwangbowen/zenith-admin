import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Skeleton, Tag } from '@douyinfe/semi-ui';
import { ChevronLeft, ChevronRight, Monitor } from 'lucide-react';
import type { WorkflowDefinition } from '@zenith/shared';
import { canLaunchOnMobile } from '../lib/launch';
import { usePublishedDefinitions } from '../lib/queries';

export default function LaunchListPage() {
  const navigate = useNavigate();
  const defsQuery = usePublishedDefinitions();
  const defs = defsQuery.data ?? [];

  const groups = useMemo(() => {
    const map = new Map<string, WorkflowDefinition[]>();
    for (const def of defsQuery.data ?? []) {
      const key = def.categoryName ?? '未分类';
      const arr = map.get(key) ?? [];
      arr.push(def);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [defsQuery.data]);

  return (
    <div className="ap-page">
      <div className="ap-header">
        <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
        <span className="ap-header__title">发起申请</span>
      </div>
      <div className="ap-body">
        {defsQuery.isLoading && <Skeleton placeholder={<Skeleton.Paragraph rows={5} />} loading active />}
        {!defsQuery.isLoading && defs.length === 0 && <Empty description="暂无可发起的流程" style={{ paddingTop: 60 }} />}
        {groups.map(([category, list]) => (
          <div key={category}>
            <div className="ap-section-title">{category}</div>
            {list.map((def) => {
              const mobileOk = canLaunchOnMobile(def);
              return (
                <div
                  key={def.id}
                  className="ap-card"
                  style={mobileOk ? undefined : { opacity: 0.65, cursor: 'default' }}
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (mobileOk) navigate(`/launch/${def.id}`); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && mobileOk) navigate(`/launch/${def.id}`); }}
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
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
