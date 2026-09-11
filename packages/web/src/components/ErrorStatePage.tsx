import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Empty } from '@douyinfe/semi-ui';
import { trackEvent } from '@/utils/tracker';

interface ErrorStatePageProps {
  readonly image: ReactNode;
  readonly darkModeImage: ReactNode;
  readonly title: string;
  readonly description: string;
  /** 进入页面时上报的语义事件名（如 page_not_found / page_forbidden），载荷带当前路径以便按页面统计 */
  readonly trackEventName: string;
}

/** 整页错误态（403 / 404）：插画 + 文案 + 「返回首页 / 返回上一页」，并上报一次语义事件 */
export default function ErrorStatePage({ image, darkModeImage, title, description, trackEventName }: ErrorStatePageProps) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    trackEvent(trackEventName, { path: location.pathname });
  }, [trackEventName, location.pathname]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Empty
        image={image}
        darkModeImage={darkModeImage}
        title={title}
        description={description}
      >
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
          <Button type="primary" onClick={() => navigate('/')}>返回首页</Button>
          <Button onClick={() => navigate(-1)}>返回上一页</Button>
        </div>
      </Empty>
    </div>
  );
}
