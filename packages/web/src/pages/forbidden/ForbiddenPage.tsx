import { useNavigate } from 'react-router-dom';
import { Button, Typography } from '@douyinfe/semi-ui';
import './ForbiddenPage.css';

const { Title, Text } = Typography;

export default function ForbiddenPage() {
  const navigate = useNavigate();

  return (
    <div className="forbidden-page">
      <div className="forbidden-code">403</div>
      <Title heading={3} style={{ margin: '16px 0 8px', color: 'var(--color-text)' }}>
        没有访问权限
      </Title>
      <Text type="tertiary" style={{ marginBottom: 32, display: 'block' }}>
        您没有权限访问此页面，请联系管理员分配权限
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
