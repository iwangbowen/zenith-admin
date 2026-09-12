import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Form, Tabs, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Save } from 'lucide-react';
import type { LoginRiskEvent } from '@zenith/shared/identity';
import { identitySecuritySettingsSchema, type IdentitySecuritySettings } from '@zenith/shared/settings';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { identitySecurityKeys, useLoginRiskEventList } from '@/hooks/queries/identity-security';
import { useSaveSettings, useSettings } from '@/hooks/queries/settings';
import { ApiError } from '@/lib/query';
import { RefreshButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';

import { useUrlTabState } from '@/hooks/useUrlTabState';
const { TabPane } = Tabs;

// 默认值以 shared schema 为唯一真相（通用设置页与服务端同源）
const defaultPolicy: IdentitySecuritySettings = identitySecuritySettingsSchema.parse({});

export default function IdentitySecurityPage() {
  const { hasPermission } = usePermission();
  const canManagePolicy = hasPermission('system:identity-security:manage');
  const canReadRiskEvents = hasPermission('system:login-risk:list');
  const tabs: Array<'policy' | 'risk'> = [
    ...(canManagePolicy ? ['policy' as const] : []),
    ...(canReadRiskEvents ? ['risk' as const] : []),
  ];
  const [activeTab, setActiveTab] = useUrlTabState(tabs, canManagePolicy ? 'policy' : 'risk');
  const formApi = useRef<FormApi | null>(null);
  const [policy, setPolicy] = useState<IdentitySecuritySettings>(defaultPolicy);
  const { page, pageSize, buildPagination, bindKeyword, submittedParams, handleSearch, handleReset } = useListSearch({
    defaults: { keyword: '' }, listKey: identitySecurityKeys.riskLists,
  });
  // 页面级全局配置表单（无弹窗、保存后不关闭），不走 useEditModal；策略由运行时设置 identitySecurity 模块承载
  const policyQuery = useSettings('identitySecurity', canManagePolicy && activeTab === 'policy');
  const savePolicyMutation = useSaveSettings('identitySecurity');
  const riskQuery = useLoginRiskEventList(
    { page, pageSize, keyword: submittedParams.keyword.trim() || undefined },
    canReadRiskEvents && activeTab === 'risk',
  );

  useEffect(() => {
    if (policyQuery.data) setPolicy(policyQuery.data.effective);
  }, [policyQuery.data]);

  async function handleSavePolicy() {
    let values: IdentitySecuritySettings;
    try {
      values = await formApi.current?.validate() as IdentitySecuritySettings;
    } catch {
      return;
    }
    try {
      const saved = await savePolicyMutation.mutateAsync({ body: { version: policyQuery.data?.version ?? 0, data: values } });
      setPolicy(saved.effective);
      Toast.success('身份安全策略已保存');
    } catch (err) {
      // 409 = 他人已修改：请求层已提示，重载最新值供比对后再保存
      if (err instanceof ApiError && err.code === 409) void policyQuery.refetch();
    }
  }

  const riskColumns: ColumnProps<LoginRiskEvent>[] = [
    { title: '账号', dataIndex: 'username', width: 140 },
    {
      title: '风险等级',
      dataIndex: 'riskLevel',
      width: 100,
      render: (value: LoginRiskEvent['riskLevel']) => ({ low: '低', medium: '中', high: '高' }[value]),
    },
    { title: '处置动作', dataIndex: 'action', width: 110, render: (value: LoginRiskEvent['action']) => ({ allow: '放行', challenge: '二次验证', block: '阻断' }[value]) },
    { title: '原因', dataIndex: 'reason', width: 180 },
    { title: 'IP', dataIndex: 'ip', width: 140, render: (value) => value || EMPTY_PLACEHOLDER },
    { title: '位置', dataIndex: 'location', width: 160, render: renderEllipsis },
    dateTimeColumn('时间', 'createdAt'),
  ];

  if (tabs.length === 0) return <Empty description="无访问权限" />;

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" keepDOM={false} activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        {canManagePolicy && <TabPane tab="策略配置" itemKey="policy">
          <SearchToolbar>
            <Button type="primary" icon={<Save size={14} />} loading={savePolicyMutation.isPending} onClick={handleSavePolicy}>保存</Button>
            <RefreshButton onClick={() => void policyQuery.refetch()} loading={policyQuery.isFetching}>重载</RefreshButton>
          </SearchToolbar>
          <div style={{ maxWidth: 760, padding: '4px 0' }}>
            <Form
              key={JSON.stringify(policy)}
              initValues={policy}
              getFormApi={(api) => { formApi.current = api; }}
              labelPosition="left"
              labelWidth={150}
            >
              <div className="section-title">密码策略</div>
              <Form.InputNumber field="password.minLength" label="最小长度" min={6} max={64} />
              <Form.Switch field="password.requireUppercase" label="必须包含大写" />
              <Form.Switch field="password.requireSpecialChar" label="必须包含特殊字符" />
              <Form.Switch field="password.expiryEnabled" label="启用密码过期" />
              <Form.InputNumber field="password.expiryDays" label="过期天数" min={1} max={3650} />

              <div className="section-title" style={{ marginTop: 24 }}>账号锁定</div>
              <Form.InputNumber field="lockout.maxAttempts" label="失败次数阈值" min={1} max={100} />
              <Form.InputNumber field="lockout.durationMinutes" label="锁定时长（分钟）" min={1} max={1440} />

              <div className="section-title" style={{ marginTop: 24 }}>MFA 策略</div>
              <Form.Switch field="mfa.enabled" label="启用 MFA" />
              <Form.Select
                field="mfa.mode"
                label="MFA 模式"
                style={{ width: 220 }}
                optionList={[
                  { value: 'off', label: '关闭' },
                  { value: 'optional', label: '用户自愿绑定' },
                  { value: 'required', label: '已绑定用户必需验证' },
                ]}
              />
              <Form.InputNumber field="mfa.rememberDeviceDays" label="可信设备天数" min={1} max={365} />

              <div className="section-title" style={{ marginTop: 24 }}>登录风险</div>
              <Form.Switch field="risk.enabled" label="启用风险策略" />
              <Form.Select
                field="risk.newDeviceAction"
                label="新设备登录"
                style={{ width: 220 }}
                optionList={[
                  { value: 'allow', label: '允许登录' },
                  { value: 'challenge', label: '要求 MFA' },
                ]}
              />
            </Form>
          </div>
        </TabPane>}

        {canReadRiskEvents && <TabPane tab="风险事件" itemKey="risk">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="搜索账号、IP、原因" {...bindKeyword('keyword')} />}
            onSearch={handleSearch}
            onReset={handleReset}
          />
          <ConfigurableTable<LoginRiskEvent>
            columns={riskColumns}
            {...listTableProps(riskQuery, { pagination: buildPagination })}
          />
        </TabPane>}
      </Tabs>
    </div>
  );
}
