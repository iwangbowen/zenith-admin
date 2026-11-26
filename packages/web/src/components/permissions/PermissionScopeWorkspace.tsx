import { useMemo, useState } from 'react';
import { Banner, Button, Space, Spin, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared/identity';
import { PermissionScopePageTree } from './PermissionScopePageTree';
import { PermissionScopePermissionList } from './PermissionScopePermissionList';
import type { PermissionScopeData, PermissionScopeValue } from './scope-types';

type Props = Readonly<{
  data: PermissionScopeData;
  value: PermissionScopeValue;
  onChange: (value: PermissionScopeValue) => void;
  readonly?: boolean;
  onlySelected?: boolean;
  height?: number;
  loading?: boolean;
  error?: string;
  coveredPermissionCodes?: string[];
  showBanner?: boolean;
  showSummary?: boolean;
  showPolicy?: boolean;
  autoExpandSelected?: boolean;
  pageSuffix?: Record<string, React.ReactNode>;
}>;

function flatten(nodes: Menu[]): Menu[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}

/** 已授权但该页面有操作权限、却一项都没选的页面数量。 */
function unconfiguredPageCount(data: PermissionScopeData, pageIds: number[], permissionCodes: string[]): number {
  const selectedPages = new Set(pageIds);
  const selectedCodes = new Set(permissionCodes);
  const operationsByPage = new Map<number, number>();
  const selectedOperationsByPage = new Map<number, number>();
  for (const item of data.permissions) {
    if (item.pageId === null || item.surface !== 'operation') continue;
    operationsByPage.set(item.pageId, (operationsByPage.get(item.pageId) ?? 0) + 1);
    if (selectedCodes.has(item.code)) {
      selectedOperationsByPage.set(item.pageId, (selectedOperationsByPage.get(item.pageId) ?? 0) + 1);
    }
  }
  return flatten(data.pages).filter(page => page.type === 'menu'
    && selectedPages.has(page.id)
    && (operationsByPage.get(page.id) ?? 0) > 0
    && (selectedOperationsByPage.get(page.id) ?? 0) === 0).length;
}

function ScopeSummary({
  data,
  value,
  coveredPermissionCodes,
}: {
  data: PermissionScopeData;
  value: PermissionScopeValue;
  coveredPermissionCodes: string[];
}) {
  const unconfigured = unconfiguredPageCount(data, value.pageIds, value.permissionCodes);
  return (
    <Space wrap spacing={6} style={{ marginBottom: 8 }}>
      <Typography.Text strong>已选授权</Typography.Text>
      <Tag size="small" color="blue">页面 {value.pageIds.length}</Tag>
      <Tag size="small" color="green">独立权限 {value.permissionCodes.length}</Tag>
      {unconfigured > 0 && <Tag size="small" color="orange">{unconfigured} 个页面未配置操作</Tag>}
      {coveredPermissionCodes.length > 0 && <Typography.Text type="tertiary" size="small">角色覆盖 {coveredPermissionCodes.length} 项</Typography.Text>}
    </Space>
  );
}

/**
 * 页面为主、操作权限为页面属性的统一授权工作区。
 *
 * 保留“页面访问 / 操作权限”独立存储语义，但不再把两者拆成两个平行入口：
 * 页面行下面直接展开该页面的页面读权限和操作权限。仅接口权限放在次级页签。
 */
export function PermissionScopeWorkspace({
  data,
  value,
  onChange,
  readonly = false,
  onlySelected = false,
  height = 420,
  loading = false,
  error,
  coveredPermissionCodes = [],
  showBanner = true,
  showSummary = true,
  showPolicy = false,
  autoExpandSelected = true,
  pageSuffix,
}: Props) {
  const [activeTab, setActiveTab] = useState('pages');
  const apiOnlyItems = useMemo(
    () => data.permissions.filter(item => item.pageId === null),
    [data.permissions],
  );
  const selectable = useMemo(() => new Set(data.selectablePageIds), [data.selectablePageIds]);
  const selectableCodes = useMemo(() => new Set(data.permissions.filter(item => item.requestable).map(item => item.code)), [data.permissions]);
  const availableValue = {
    pageIds: data.selectablePageIds ? value.pageIds.filter(id => selectable.has(id)) : value.pageIds,
    permissionCodes: value.permissionCodes.filter(code => selectableCodes.has(code)),
  };
  const unavailable = value.pageIds.length + value.permissionCodes.length - availableValue.pageIds.length - availableValue.permissionCodes.length;
  const pageTree = (
    <PermissionScopePageTree
      data={data}
      value={value}
      onChange={onChange}
      readonly={readonly}
      height={height}
      onlySelected={onlySelected}
      autoExpandSelected={autoExpandSelected}
      pageSuffix={pageSuffix}
      showPolicy={showPolicy}
    />
  );

  if (error) return <Banner type="danger" closeIcon={null} description={error} />;
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  return (
    <div>
      {showBanner && (
        <Banner
          type="info"
          fullMode={false}
          closeIcon={null}
          style={{ marginBottom: 8 }}
          description="页面是主导航入口；页面读权限随页面自动授予，操作权限在页面下按需勾选。未授权页面仍可选择操作权限作为仅接口能力。"
        />
      )}
      {showSummary && <ScopeSummary data={data} value={value} coveredPermissionCodes={coveredPermissionCodes} />}
      {!readonly && unavailable > 0 && (
        <Banner type="warning" closeIcon={null} description={
          <Space wrap>当前选择含 {unavailable} 项不可用授权。<Button size="small" onClick={() => onChange(availableValue)}>移除不可用项</Button></Space>
        } />
      )}
      {apiOnlyItems.length === 0 ? pageTree : (
        <Tabs activeKey={activeTab} onChange={setActiveTab} collapsible="auto">
          <TabPane tab="页面与操作" itemKey="pages">{pageTree}</TabPane>
          <TabPane tab={`仅接口权限 ${apiOnlyItems.length}`} itemKey="api-only">
            <PermissionScopePermissionList
              items={apiOnlyItems}
              selectedPermissionCodes={value.permissionCodes}
              onChange={readonly ? undefined : (permissionCodes) => onChange({ ...value, permissionCodes })}
              readonly={readonly}
              onlySelected={onlySelected}
              height={height}
              showPolicy={showPolicy}
            />
          </TabPane>
        </Tabs>
      )}
    </div>
  );
}
