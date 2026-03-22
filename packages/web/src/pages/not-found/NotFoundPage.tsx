import { useNavigate } from 'react-router-dom';
import { Button, Typography } from '@douyinfe/semi-ui';
import './NotFoundPage.css';

const { Title, Text } = Typography;

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="not-found-page">
      <div className="not-found-code">404</div>
      <Title heading={3} style={{ margin: '16px 0 8px', color: 'var(--color-text)' }}>
        页面不存在
      </Title>
      <Text type="tertiary" style={{ marginBottom: 32, display: 'block' }}>
        您访问的页面不存在或已被移除，请检查地址是否正确
      </Text>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button type="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
        <Button onClick={() => navigate(-1)}>返回上一页</Button>
      </div>
    </div>
  );
}
