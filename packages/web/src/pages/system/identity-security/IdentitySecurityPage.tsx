import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Tabs, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Save, Search } from 'lucide-react';
import type { IdentitySecurityPolicy, LoginRiskEvent } from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import {
  identitySecurityKeys,
  useIdentitySecurityPolicy,
  useLoginRiskEventList,
  useSaveIdentitySecurityPolicy,
} from '@/hooks/queries/identity-security';

const { TabPane } = Tabs;

const defaultPolicy: IdentitySecurityPolicy = {
  password: {
    minLength: 6,
    requireUppercase: false,
    requireSpecialChar: false,
    expiryEnabled: false,
    expiryDays: 90,
  },
  lockout: {
    maxAttempts: 10,
    durationMinutes: 30,
  },
  mfa: {
    enabled: false,
    mode: 'off',
    rememberDeviceDays: 30,
  },
  risk: {
    enabled: false,
    newDeviceAction: 'allow',
  },
};

export default function IdentitySecurityPage() {
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const [policy, setPolicy] = useState<IdentitySecurityPolicy>(defaultPolicy);
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const policyQuery = useIdentitySecurityPolicy();
  const savePolicyMutation = useSaveIdentitySecurityPolicy();
  const riskQuery = useLoginRiskEventList({ page, pageSize, keyword: submittedKeyword.trim() || undefined });
  const riskData = riskQuery.data ?? null;

  useEffect(() => {
    if (policyQuery.data) setPolicy(policyQuery.data);
  }, [policyQuery.data]);

  async function handleSavePolicy() {
    let values: IdentitySecurityPolicy;
    try {
      values = await formApi.current?.validate() as IdentitySecurityPolicy;
    } catch {
      return;
    }
    const saved = await savePolicyMutation.mutateAsync(values);
    setPolicy(saved);
    Toast.success('身份安全策略已保存');
  }

  function handleRiskSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: identitySecurityKeys.riskLists });
  }

  function handleRiskReset() {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: identitySecurityKeys.riskLists });
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
    { title: 'IP', dataIndex: 'ip', width: 140, render: (value) => value || '-' },
    { title: '位置', dataIndex: 'location', width: 160, render: (value) => value || '-' },
    { title: '时间', dataIndex: 'createdAt', width: 170, render: (value) => formatDateTime(value as string) },
  ];

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" keepDOM={false}>
        <TabPane tab="策略配置" itemKey="policy">
          <SearchToolbar>
            <Button type="primary" icon={<Save size={14} />} loading={savePolicyMutation.isPending} onClick={handleSavePolicy}>保存</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} loading={policyQuery.isFetching} onClick={() => void policyQuery.refetch()}>重载</Button>
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
        </TabPane>

        <TabPane tab="风险事件" itemKey="risk">
          <SearchToolbar>
            <Input
              prefix={<Search size={14} />}
              value={draftKeyword}
              onChange={setDraftKeyword}
              onEnterPress={handleRiskSearch}
              placeholder="搜索账号、IP、原因"
              showClear
              style={{ width: 220 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleRiskSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleRiskReset}>重置</Button>
          </SearchToolbar>
          <ConfigurableTable
            bordered
            columns={riskColumns}
            dataSource={riskData?.list ?? []}
            rowKey="id"
            loading={riskQuery.isFetching}
            onRefresh={() => void riskQuery.refetch()}
            refreshLoading={riskQuery.isFetching}
            pagination={buildPagination(riskData?.total ?? 0)}
          />
        </TabPane>
      </Tabs>
    </div>
  );
}
