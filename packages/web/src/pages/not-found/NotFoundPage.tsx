import { IllustrationNotFound, IllustrationNotFoundDark } from '@douyinfe/semi-illustrations';
import ErrorStatePage from '@/components/ErrorStatePage';

export default function NotFoundPage() {
  // 失败导航语义事件：让 404 访问在事件分析中可按 page_not_found 单独统计
  return (
    <ErrorStatePage
      image={<IllustrationNotFound style={{ width: 200, height: 200 }} />}
      darkModeImage={<IllustrationNotFoundDark style={{ width: 200, height: 200 }} />}
      title="页面不存在"
      description="您访问的页面不存在或已被移除，请检查地址是否正确"
      trackEventName="page_not_found"
    />
  );
}
