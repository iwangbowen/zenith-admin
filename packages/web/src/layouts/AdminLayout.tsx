import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Nav, Avatar, Dropdown, Button, Typography } from '@douyinfe/semi-ui';
import {
  IconHome,
  IconUser,
  IconGridView,
  IconShrinkScreenStroked,
  IconExpand,
  IconExit,
  IconSetting,
} from '@douyinfe/semi-icons';
import type { User } from '@zenith/shared';
import './AdminLayout.css';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

interface AdminLayoutProps {
  user: Omit<User, 'password'>;
  onLogout: () => void;
}

const menuItems = [
  { itemKey: '/', text: '首页', icon: <IconHome /> },
  { itemKey: '/users', text: '用户管理', icon: <IconUser /> },
  { itemKey: '/components', text: '组件示例', icon: <IconGridView /> },
];

export default function AdminLayout({ user, onLogout }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        style={{
          background: 'var(--color-sidebar-bg)',
          overflow: 'auto',
          transition: 'width .2s ease',
        }}
      >
        <Nav
          selectedKeys={[location.pathname]}
          style={{ height: '100%' }}
          isCollapsed={collapsed}
          onSelect={({ itemKey }) => navigate(String(itemKey))}
          items={menuItems}
          header={{
            logo: (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                Z
              </div>
            ),
            text: 'Zenith Admin',
          }}
          footer={{
            collapseButton: true,
          }}
          onCollapseChange={(isCollapsed) => setCollapsed(isCollapsed ?? false)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            height: 'var(--header-height)',
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 20px',
            gap: 12,
          }}
        >
          <Button
            theme="borderless"
            icon={collapsed ? <IconExpand /> : <IconShrinkScreenStroked />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ color: 'var(--color-text-secondary)' }}
          />
          <Dropdown
            position="bottomRight"
            render={
              <Dropdown.Menu>
                <Dropdown.Item icon={<IconSetting />}>设置</Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item icon={<IconExit />} onClick={onLogout}>
                  退出登录
                </Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Avatar size="small" color="blue" style={{ fontSize: 12 }}>
                {user.nickname?.charAt(0)?.toUpperCase() || 'U'}
              </Avatar>
              <Text style={{ fontSize: 13 }}>{user.nickname}</Text>
            </div>
          </Dropdown>
        </Header>
        <Content
          style={{
            background: 'var(--color-bg)',
            overflow: 'auto',
            position: 'relative',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
