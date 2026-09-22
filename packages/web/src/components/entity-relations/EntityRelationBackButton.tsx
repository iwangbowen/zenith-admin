import { ArrowLeft } from 'lucide-react';
import { Button, Tooltip } from '@douyinfe/semi-ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { entityRelationFrameUrl, readEntityRelationStack } from './entity-navigation';

/** Restores the source detail URL after opening a related object full-page. */
export default function EntityRelationBackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const stack = readEntityRelationStack(location.state);
  if (stack.length === 0) return null;
  const frame = stack[stack.length - 1];
  const goBack = () => {
    const remaining = stack.slice(0, -1);
    navigate(entityRelationFrameUrl(frame), {
      replace: true,
      state: remaining.length > 0 ? { entityRelation: { stack: remaining } } : null,
    });
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.admin-content')?.scrollTo({ top: frame.scrollTop, behavior: 'auto' });
    });
  };
  return <Tooltip content="返回关联对象">
    <Button theme="borderless" size="small" icon={<ArrowLeft size={16} />} aria-label="返回关联对象" onClick={goBack} />
  </Tooltip>;
}
