import ErrorStatePage from '@/components/ErrorStatePage';
import { emptyIllustration } from '@/components/EmptyIllustration';

export default function ForbiddenPage() {
  // 越权访问语义事件：让 403 拦截在事件分析中可按 page_forbidden 单独统计
  return (
    <ErrorStatePage
      {...emptyIllustration('NoAccess', 200)}
      title="没有访问权限"
      description="您没有权限访问此页面，请联系管理员分配权限"
      trackEventName="page_forbidden"
    />
  );
}
