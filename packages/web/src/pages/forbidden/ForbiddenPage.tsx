import { useNavigate } from 'react-router-dom';
import { Button, Empty } from '@douyinfe/semi-ui';
import { IllustrationNoAccess, IllustrationNoAccessDark } from '@douyinfe/semi-illustrations';

export default function ForbiddenPage() {
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Empty
        image={<IllustrationNoAccess style={{ width: 200, height: 200 }} />}
        darkModeImage={<IllustrationNoAccessDark style={{ width: 200, height: 200 }} />}
        title="没有访问权限"
        description="您没有权限访问此页面，请联系管理员分配权限"
      >
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
          <Button type="primary" onClick={() => navigate('/')}>返回首页</Button>
          <Button onClick={() => navigate(-1)}>返回上一页</Button>
        </div>
      </Empty>
    </div>
  );
}
