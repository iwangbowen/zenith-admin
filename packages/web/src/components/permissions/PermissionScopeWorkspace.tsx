import { useState } from 'react';
import { Banner, Space, Spin, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import { MenuPermissionPanel } from './MenuPermissionPanel';
import { PermissionScopePermissionList } from './PermissionScopePermissionList';
import type { PermissionScopeData, PermissionScopeValue } from './scope-types';

type Props = Readonly<{
  data: PermissionScopeData;
  value: PermissionScopeValue;
  onChange: (value: PermissionScopeValue) => void;
  layout?: 'tabs' | 'split';
  readonly?: boolean;
  onlySelected?: boolean;
  height?: number;
  loading?: boolean;
  coveredPermissionCodes?: string[];
  showBanner?: boolean;
  showSummary?: boolean;
  showPolicy?: boolean;
}>;

function ScopeSummary({ value, coveredPermissionCodes }: { value: PermissionScopeValue; coveredPermissionCodes: string[] }) {
  return (
    <Space wrap spacing={6} style={{ marginBottom: 8 }}>
      <Typography.Text strong>已选授权</Typography.Text>
      <Tag size="small" color="blue">页面 {value.pageIds.length}</Tag>
      <Tag size="small" color="green">操作权限 {value.permissionCodes.length}</Tag>
      {coveredPermissionCodes.length > 0 && <Typography.Text type="tertiary" size="small">角色覆盖 {coveredPermissionCodes.length} 项</Typography.Text>}
    </Space>
  );
}

/**
 * 页面与操作权限的统一选择工作区。
 *
 * 只负责选择/展示，不负责接口、保存和触发条件；不同入口通过 scope-adapters 适配数据，
 * 再用 PermissionScopeDrawer 或页面自己的 Modal/SideSheet 承载。
 */
export function PermissionScopeWorkspace({
  data,
  value,
  onChange,
  layout = 'tabs',
  readonly = false,
  onlySelected = false,
  height = 420,
  loading = false,
  coveredPermissionCodes = [],
  showBanner = true,
  showSummary = true,
  showPolicy = false,
}: Props) {
  const [activeTab, setActiveTab] = useState('pages');
  const pagePanel = (
    <MenuPermissionPanel
      allMenus={data.pages}
      checkedMenuIds={value.pageIds}
      onChange={readonly ? undefined : (pageIds) => onChange({ ...value, pageIds })}
      loading={loading}
      readonly={readonly}
      hideBanner
      height={height}
    />
  );
  const permissionPanel = (
    <PermissionScopePermissionList
      items={data.permissions}
      selectedPermissionCodes={value.permissionCodes}
      onChange={readonly ? undefined : (permissionCodes) => onChange({ ...value, permissionCodes })}
      pageIds={value.pageIds}
      coveredPermissionCodes={coveredPermissionCodes}
      readonly={readonly}
      onlySelected={onlySelected}
      height={height}
      showPolicy={showPolicy}
    />
  );

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  const content = layout === 'split' ? (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
      border: '1px solid var(--semi-color-border)',
      borderRadius: 'var(--semi-border-radius-medium)',
      overflow: 'hidden',
    }}>
      <div style={{ minWidth: 0, padding: 12, borderRight: '1px solid var(--semi-color-border)' }}>
        <Typography.Text strong>页面访问</Typography.Text>
        {pagePanel}
      </div>
      <div style={{ minWidth: 0, padding: 12 }}>
        <Typography.Text strong>操作权限</Typography.Text>
        {permissionPanel}
      </div>
    </div>
  ) : (
    <Tabs activeKey={activeTab} onChange={setActiveTab} collapsible="auto">
      <TabPane tab={`页面访问 ${value.pageIds.length}`} itemKey="pages">{pagePanel}</TabPane>
      <TabPane tab={`操作权限 ${value.permissionCodes.length}`} itemKey="permissions">{permissionPanel}</TabPane>
    </Tabs>
  );

  return (
    <div>
      {showBanner && (
        <Banner
          type="info"
          fullMode={false}
          closeIcon={null}
          style={{ marginBottom: 8 }}
          description="页面访问负责导航并自动携带页面读权限；操作权限独立授予，不会隐藏或带出页面。"
        />
      )}
      {showSummary && <ScopeSummary value={value} coveredPermissionCodes={coveredPermissionCodes} />}
      {content}
    </div>
  );
}
