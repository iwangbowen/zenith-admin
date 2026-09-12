import ErrorStatePage from '@/components/ErrorStatePage';
import { emptyIllustration } from '@/components/EmptyIllustration';

export default function NotFoundPage() {
  // 失败导航语义事件：让 404 访问在事件分析中可按 page_not_found 单独统计
  return (
    <ErrorStatePage
      {...emptyIllustration('NotFound', 200)}
      title="页面不存在"
      description="您访问的页面不存在或已被移除，请检查地址是否正确"
      trackEventName="page_not_found"
    />
  );
}
