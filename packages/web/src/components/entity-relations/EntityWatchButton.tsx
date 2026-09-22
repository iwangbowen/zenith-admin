import { Button, Tooltip } from '@douyinfe/semi-ui';
import { Bell, BellOff } from 'lucide-react';
import { isWatchableEntityType, type CanonicalEntityRef } from '@zenith/shared/platform';
import { useAuth } from '@/hooks/useAuth';
import { useEntityWatch, useFollowEntity, useUnfollowEntity } from '@/hooks/queries/entity-watches';

export default function EntityWatchButton({ entityRef }: { readonly entityRef: CanonicalEntityRef }) {
  const { impersonation } = useAuth();
  const query = useEntityWatch(entityRef);
  const follow = useFollowEntity();
  const unfollow = useUnfollowEntity();
  if (!isWatchableEntityType(entityRef.type) || impersonation || (query.data && !query.data.supported)) return null;
  if (query.isError) return <Tooltip content="重新获取关注状态"><Button size="small" theme="borderless" aria-label="重新获取关注状态" icon={<Bell size={14} />} onClick={() => void query.refetch()} /></Tooltip>;
  const watching = query.data?.watching === true;
  const label = watching ? '取消关注' : '关注业务变化';
  return <Tooltip content={watching ? '已关注，点击后停止接收后续提醒' : '关注关键业务变化，提醒发送到通知中心'}>
    <Button size="small" theme="borderless" aria-label={label} aria-pressed={watching}
      disabled={!query.data} loading={follow.isPending || unfollow.isPending}
      icon={watching ? <BellOff size={14} /> : <Bell size={14} />}
      onClick={() => { if (watching) unfollow.mutate({ params: entityRef }); else follow.mutate({ params: entityRef }); }} />
  </Tooltip>;
}
