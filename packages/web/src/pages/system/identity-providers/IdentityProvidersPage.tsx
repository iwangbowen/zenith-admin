import { useEffect, useState } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { useQueryClient } from '@tanstack/react-query';
import { Col, Form, Modal, Row, SideSheet, Spin, Table, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { IdentityProviderType, TenantIdentityProvider } from '@zenith/shared/identity';
import { IDENTITY_PROVIDER_STATUSES, IDENTITY_PROVIDER_TYPES, SUPER_ADMIN_CODE, identityProviderContract } from '@zenith/shared/identity';
import { enumValueOf, type BodyOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { useAllRoles } from '@/hooks/queries/roles';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
import {
  identityProviderKeys,
  useDeleteIdentityProviders,
  useIdentityProviderDetail,
  useIdentityProviderList,
  useIdentityProviderTenants,
  useSaveIdentityProvider,
  useSearchLdapDirectoryUsers,
  useSyncIdentityProviderDirectory,
  useTestIdentityProviderConnection,
} from '@/hooks/queries/identity-providers';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { CreateButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';

interface SearchParams {
  keyword: string;
  type?: string;
  status?: string;
  tenantId: string;
}

const defaultSearchParams: SearchParams = {
  keyword: '',
  type: undefined,
  status: undefined,
  tenantId: '',
};

/** 保存载荷：创建入参的部分形态；表单以带点号的扁平键维护属性映射，提交前在 beforeSave 收敛 */
type IdentityProviderSavePayload = Partial<BodyOf<typeof identityProviderContract.create>>;

const providerTypeOptions = [
  { value: 'oidc', label: 'OIDC' },
  { value: 'saml', label: 'SAML' },
  { value: 'ldap', label: 'LDAP' },
  { value: 'ad', label: 'Active Directory' },
];

const providerTypeLabels: Record<IdentityProviderType, string> = {
  oidc: 'OIDC',
  saml: 'SAML',
  ldap: 'LDAP',
  ad: 'AD',
};

const defaultMapping = {
  subject: 'sub',
  email: 'email',
  username: 'preferred_username',
  nickname: 'name',
  phone: 'phone_number',
  department: 'department',
};

const samlDefaultMapping = {
  subject: 'NameID',
  email: 'email',
  username: 'username',
  nickname: 'displayName',
  phone: 'phone',
  department: 'department',
};

const ldapDefaultMapping = {
  subject: 'entryUUID',
  email: 'mail',
  username: 'uid',
  nickname: 'cn',
  phone: 'telephoneNumber',
  department: 'ou',
};

const adDefaultMapping = {
  subject: 'objectGUID',
  email: 'mail',
  username: 'sAMAccountName',
  nickname: 'displayName',
  phone: 'telephoneNumber',
  department: 'department',
};

function isDirectoryType(type: IdentityProviderType) {
  return type === 'ldap' || type === 'ad';
}

function mappingForType(type: IdentityProviderType) {
  if (type === 'saml') return samlDefaultMapping;
  if (type === 'ldap') return ldapDefaultMapping;
  if (type === 'ad') return adDefaultMapping;
  return defaultMapping;
}

export default function IdentityProvidersPage() {
  const { options: statusOptions } = useDictItems('common_status');
  const queryClient = useQueryClient();
  const [providerType, setProviderType] = useState<IdentityProviderType>('oidc');
  const [ldapSearchVisible, setLdapSearchVisible] = useState(false);
  const [ldapSearchProvider, setLdapSearchProvider] = useState<TenantIdentityProvider | null>(null);
  const [ldapSearchKeyword, setLdapSearchKeyword] = useState('');
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: identityProviderKeys.lists });
  const listQuery = useIdentityProviderList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: enumValueOf(IDENTITY_PROVIDER_TYPES, submittedParams.type),
    status: enumValueOf(IDENTITY_PROVIDER_STATUSES, submittedParams.status),
    tenantId: submittedParams.tenantId ? Number(submittedParams.tenantId) : undefined,
  });
  // 归属租户只有平台管理员可选；租户管理员的身份源由服务端强制落到自身租户
  const isPlatformAdmin = useIsPlatformAdmin();
  const tenantsQuery = useIdentityProviderTenants({ enabled: isPlatformAdmin });
  const rolesQuery = useAllRoles();
  const tenantOptions = (tenantsQuery.data ?? []).map((item) => ({ value: item.id, label: `${item.name}（${item.code}）` }));
  // 自动建号永不授予平台保留角色（服务端同样拒绝），下拉里直接不给选
  const roleOptions = (rolesQuery.data ?? [])
    .filter((item) => item.code !== SUPER_ADMIN_CODE)
    .map((item) => ({ value: item.id, label: item.name }));
  const saveMutation = useSaveIdentityProvider();
  const modal = useEditModal<TenantIdentityProvider, Record<string, unknown>, IdentityProviderSavePayload>({
    entityName: '企业身份源',
    save: saveMutation,
    useDetail: useIdentityProviderDetail,
    defaults: {
      type: 'oidc',
      status: 'disabled',
      scopes: 'openid profile email',
      ldapStartTls: false,
      ldapSkipTlsVerify: false,
      ldapTimeoutMs: 5000,
      ldapUserFilter: '(&(objectClass=person)(|(uid={{username}})(sAMAccountName={{username}})(mail={{username}})))',
      ldapUserSearchFilter: '(&(objectClass=person)(|(cn=*{{keyword}}*)(displayName=*{{keyword}}*)(uid=*{{keyword}}*)(sAMAccountName=*{{keyword}}*)(mail=*{{keyword}}*)))',
      ldapSyncFilter: '(&(objectClass=person)(|(uid=*)(sAMAccountName=*)(mail=*)))',
      jitEnabled: false,
      autoLinkByEmail: false,
      defaultRoleIds: [],
      ...Object.fromEntries(Object.entries(defaultMapping).map(([key, value]) => [`attributeMapping.${key}`, value])),
    },
    toValues: (provider) => {
      const initMapping = mappingForType(provider.type);
      return {
        ...provider,
        tenantId: provider.tenantId ?? undefined,
        defaultRoleIds: provider.defaultRoleIds ?? [],
        'attributeMapping.subject': provider.attributeMapping?.subject || initMapping.subject,
        'attributeMapping.email': provider.attributeMapping?.email || initMapping.email,
        'attributeMapping.username': provider.attributeMapping?.username || initMapping.username,
        'attributeMapping.nickname': provider.attributeMapping?.nickname || initMapping.nickname,
        'attributeMapping.phone': provider.attributeMapping?.phone || initMapping.phone,
        'attributeMapping.department': provider.attributeMapping?.department || initMapping.department,
      };
    },
    beforeSave: (values): IdentityProviderSavePayload => {
      const activeMapping = mappingForType(providerType);
      const { tenantId, ...rest } = values;
      // 属性映射在表单里是带点号的扁平字段；空值回落到该类型的默认映射
      const mapped = (key: keyof typeof activeMapping): string => {
        const value = values[`attributeMapping.${key}`];
        return typeof value === 'string' && value ? value : activeMapping[key];
      };
      return {
        ...(rest as IdentityProviderSavePayload),
        // 非平台管理员不提交 tenantId：服务端会强制落到自身租户，显式传值反而会被 403 拒绝
        ...(isPlatformAdmin ? { tenantId: (tenantId as number | null | undefined) ?? null } : {}),
        type: providerType,
        attributeMapping: {
          subject: mapped('subject'),
          email: mapped('email'),
          username: mapped('username'),
          nickname: mapped('nickname'),
          phone: mapped('phone'),
          department: mapped('department'),
        },
        defaultRoleIds: Array.isArray(values.defaultRoleIds) ? (values.defaultRoleIds as number[]) : [],
      };
    },
    labelWidth: 130,
  });
  const toggleStatusMutation = useSaveIdentityProvider();
  const deleteMutation = useDeleteIdentityProviders();
  const testConnectionMutation = useTestIdentityProviderConnection();
  const ldapSearchMutation = useSearchLdapDirectoryUsers();
  const syncDirectoryMutation = useSyncIdentityProviderDirectory();
  const ldapSearchUsers = ldapSearchMutation.data ?? [];
  const status = useStatusToggle<TenantIdentityProvider>({
    toggle: (row, enabled) => toggleStatusMutation.mutateAsync({ id: row.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
  });

  useEffect(() => {
    if (modal.editing) setProviderType(modal.editing.type);
  }, [modal.editing]);

  function openCreate() {
    setProviderType('oidc');
    modal.openCreate();
  }

  function handleProviderTypeChange(value: unknown) {
    const nextType = (value === 'saml' || value === 'ldap' || value === 'ad') ? value : 'oidc';
    setProviderType(nextType);
    const nextMapping = mappingForType(nextType);
    modal.formApi.current?.setValues({
      'attributeMapping.subject': nextMapping.subject,
      'attributeMapping.email': nextMapping.email,
      'attributeMapping.username': nextMapping.username,
      'attributeMapping.nickname': nextMapping.nickname,
      'attributeMapping.phone': nextMapping.phone,
      'attributeMapping.department': nextMapping.department,
    });
  }

  function openEdit(row: TenantIdentityProvider) {
    setProviderType(row.type);
    modal.openEdit(row);
  }

  async function handleTestConnection(row: TenantIdentityProvider) {
    try {
      const result = await testConnectionMutation.mutateAsync({ params: { id: row.id } });
      if (result.ok) Toast.success(result.message);
      else Toast.error(result.message);
    } catch (err) {
      Toast.error((err as Error).message);
    }
  }

  function openLdapSearch(row: TenantIdentityProvider) {
    setLdapSearchProvider(row);
    setLdapSearchKeyword('');
    ldapSearchMutation.reset();
    setLdapSearchVisible(true);
  }

  async function handleLdapSearch() {
    if (!ldapSearchProvider) return;
    try {
      await ldapSearchMutation.mutateAsync({ params: { id: ldapSearchProvider.id }, query: { limit: 20, keyword: ldapSearchKeyword || undefined } });
    } catch (err) {
      Toast.error((err as Error).message);
    }
  }

  function handleSyncDirectory(row: TenantIdentityProvider) {
    Modal.confirm({
      title: `同步「${row.name}」目录用户？`,
      content: '将按同步过滤器读取目录用户，并创建、绑定或更新本地账号基础资料。',
      onOk: async () => {
        try {
          const result = await syncDirectoryMutation.mutateAsync({ params: { id: row.id }, body: { limit: 500 } });
          if (result.status === 'failed') Toast.error(result.message);
          else Toast.success(result.message);
          void queryClient.invalidateQueries({ queryKey: identityProviderKeys.lists });
        } catch (err) {
          Toast.error((err as Error).message);
        }
      },
    });
  }

  const columns: ColumnProps<TenantIdentityProvider>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 130, render: renderEllipsis },
    { title: '租户', dataIndex: 'tenantName', width: 160, render: (value) => renderEllipsis(value || '平台') },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (value: IdentityProviderType) => <Tag color={isDirectoryType(value) ? 'green' : value === 'oidc' ? 'blue' : 'violet'}>{providerTypeLabels[value]}</Tag>,
    },
    {
      title: '端点 / Base DN',
      dataIndex: 'issuer',
      width: 280,
      render: (_value, row) => renderEllipsis(isDirectoryType(row.type) ? (row.ldapUrl || row.ldapBaseDn) : row.type === 'oidc' ? row.issuer : row.samlEntityId),
    },
    createdAtColumn,
    status.column(),
    createOperationColumn<TenantIdentityProvider>({
      width: 240,
      desktopInlineKeys: ['edit', 'test', 'delete'],
      actions: (row) => [
        { key: 'edit', label: '编辑', onClick: () => { void openEdit(row); } },
        { key: 'test', label: '测试', hidden: !isDirectoryType(row.type), onClick: () => { void handleTestConnection(row); } },
        { key: 'searchUsers', label: '搜索用户', hidden: !isDirectoryType(row.type), onClick: () => openLdapSearch(row) },
        { key: 'sync', label: '同步', hidden: !isDirectoryType(row.type), onClick: () => handleSyncDirectory(row) },
        deleteAction({ title: `确认删除身份源「${row.name}」？`, content: '删除后，已绑定的企业身份账号关系也会被移除。', run: () => deleteMutation.mutateAsync([row.id]) }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索名称/编码" {...bindKeyword('keyword')} />}
        filters={<><FilterSelect
          placeholder="全部类型"
          items={providerTypeOptions}
          {...bind('type')}
        /><StatusSelect
          items={statusOptions}
          {...bind('status')}
        /></>}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton onClick={openCreate} />}
        filterTitle="身份源筛选"
      />

      <ConfigurableTable<TenantIdentityProvider>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={780}
        footer={<ModalFooter {...modal.footerProps} okText="保存" />}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            key={modal.formKey} {...modal.formProps}
          >
            <Form.Section text="基础信息">
              <Row gutter={16}>
                <Col span={12}><Form.Input field="name" label="名称" placeholder="Azure AD / Okta" rules={[{ required: true, message: '请输入名称' }]} /></Col>
                <Col span={12}><Form.Input field="code" label="编码" placeholder="azure_ad" rules={[{ required: true, message: '请输入编码' }]} /></Col>
              </Row>
              <Row gutter={16}>
                {isPlatformAdmin && (
                  <Col span={12}>
                    <Form.Select
                      field="tenantId"
                      label="租户"
                      placeholder="平台级身份源"
                      optionList={tenantOptions}
                      showClear
                      style={{ width: '100%' }}
                    />
                  </Col>
                )}
                <Col span={12}>
                  <Form.Select
                    field="type"
                    label="类型"
                    optionList={providerTypeOptions}
                    style={{ width: '100%' }}
                    onChange={handleProviderTypeChange}
                  />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}><Form.Select field="status" label="状态" optionList={statusOptions} style={{ width: '100%' }} /></Col>
              </Row>
            </Form.Section>

            <Form.Section text={`${providerTypeLabels[providerType]} 连接配置`}>
              {providerType === 'oidc' && (
                <>
                  <Form.Input field="issuer" label="Issuer" placeholder="https://login.example.com" />
                  <Form.Input field="authorizationEndpoint" label="授权端点" placeholder="https://.../authorize" rules={[{ required: providerType === 'oidc', message: '请输入授权端点' }]} />
                  <Form.Input field="tokenEndpoint" label="Token 端点" placeholder="https://.../token" rules={[{ required: providerType === 'oidc', message: '请输入 Token 端点' }]} />
                  <Form.Input field="userinfoEndpoint" label="UserInfo 端点" placeholder="https://.../userinfo" rules={[{ required: providerType === 'oidc', message: '请输入 UserInfo 端点' }]} />
                  <Form.Input field="jwksUri" label="JWKS URI" placeholder="https://.../jwks" />
                  <Row gutter={16}>
                    <Col span={12}><Form.Input field="clientId" label="Client ID" /></Col>
                    <Col span={12}><Form.Input field="clientSecret" label="Client Secret" type="password" /></Col>
                  </Row>
                  <Form.Input field="scopes" label="Scopes" placeholder="openid profile email" />
                </>
              )}

              {providerType === 'saml' && (
                <>
                  <Form.Input field="issuer" label="IdP Issuer" placeholder="https://idp.example.com/saml/metadata" />
                  <Form.Input field="samlSsoUrl" label="SSO URL" placeholder="https://idp.example.com/sso" rules={[{ required: providerType === 'saml', message: '请输入 SSO URL' }]} />
                  <Form.Input field="samlEntityId" label="SP Entity ID" placeholder="https://zenith.example.com/saml/sp" />
                  <Form.TextArea field="samlCertificate" label="证书" placeholder="-----BEGIN CERTIFICATE-----" rows={4} />
                </>
              )}

              {isDirectoryType(providerType) && (
                <>
                  <Form.Input field="ldapUrl" label="LDAP URL" placeholder="ldap://ad.example.com:389" rules={[{ required: true, message: '请输入 LDAP URL' }]} />
                  <Row gutter={16}>
                    <Col span={12}><Form.Switch field="ldapStartTls" label="StartTLS" /></Col>
                    <Col span={12}><Form.Switch field="ldapSkipTlsVerify" label="跳过证书校验" /></Col>
                  </Row>
                  <Form.Input field="ldapBaseDn" label="Base DN" placeholder="dc=example,dc=com" rules={[{ required: true, message: '请输入 Base DN' }]} />
                  <Row gutter={16}>
                    <Col span={12}><Form.Input field="ldapBindDn" label="绑定 DN" placeholder="cn=readonly,dc=example,dc=com" /></Col>
                    <Col span={12}><Form.Input field="ldapBindPassword" label="绑定密码" type="password" /></Col>
                  </Row>
                  <Form.InputNumber field="ldapTimeoutMs" label="超时(ms)" min={1000} max={60000} step={1000} style={{ width: '100%' }} />
                  <Form.TextArea field="ldapUserFilter" label="登录过滤器" rows={2} />
                  <Form.TextArea field="ldapUserSearchFilter" label="搜索过滤器" rows={2} />
                  <Form.TextArea field="ldapSyncFilter" label="同步过滤器" rows={2} />
                  <Row gutter={16}>
                    <Col span={12}><Form.Input field="ldapGroupBaseDn" label="组 Base DN" placeholder="ou=groups,dc=example,dc=com" /></Col>
                    <Col span={12}><Form.Input field="ldapGroupFilter" label="组过滤器" placeholder="(member={{dn}})" /></Col>
                  </Row>
                </>
              )}
            </Form.Section>

            <Form.Section text="属性映射（切换类型时按该类型默认值自动填充）">
              <Row gutter={16}>
                <Col span={12}><Form.Input field="attributeMapping.subject" label="主体字段" placeholder={isDirectoryType(providerType) ? 'entryUUID / objectGUID' : 'sub / NameID'} /></Col>
                <Col span={12}><Form.Input field="attributeMapping.email" label="邮箱字段" placeholder="email" /></Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}><Form.Input field="attributeMapping.username" label="用户名字段" placeholder={isDirectoryType(providerType) ? 'uid / sAMAccountName' : 'preferred_username'} /></Col>
                <Col span={12}><Form.Input field="attributeMapping.nickname" label="昵称字段" placeholder={isDirectoryType(providerType) ? 'cn / displayName' : 'name'} /></Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}><Form.Input field="attributeMapping.phone" label="手机字段" placeholder="telephoneNumber" /></Col>
                <Col span={12}><Form.Input field="attributeMapping.department" label="部门字段" placeholder="department / ou" /></Col>
              </Row>
            </Form.Section>

            <Form.Section text="账号开通">
              <Form.Switch field="jitEnabled" label="JIT 创建" extraText="首次登录时按属性映射自动创建本地账号" />
              <Form.Switch
                field="autoLinkByEmail"
                label="按邮箱自动关联"
                extraText={providerType === 'oidc'
                  ? '首次登录时把 IdP 断言为已验证（email_verified）的邮箱关联到本租户内唯一匹配的既有账号；默认关闭，平台超管永不自动关联'
                  : '首次登录时按目录邮箱关联到本租户内唯一匹配的既有账号，并允许目录同步覆盖本地邮箱；默认关闭，平台超管永不自动关联'}
              />
              <Form.Select
                field="defaultRoleIds"
                label="默认角色"
                multiple
                optionList={roleOptions}
                style={{ width: '100%' }}
                extraText="自动建号只授予本租户的普通角色；平台保留角色需由平台管理员手动分配"
              />
              <Form.TextArea field="remark" label="备注" rows={3} />
            </Form.Section>
          </Form>
        </Spin>
      </SideSheet>

      <SideSheet
        title={ldapSearchProvider ? `搜索目录用户 · ${ldapSearchProvider.name}` : '搜索目录用户'}
        visible={ldapSearchVisible}
        onCancel={() => setLdapSearchVisible(false)}
        closeOnEsc
        width={900}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <KeywordInput placeholder="输入用户名、姓名或邮箱关键字" value={ldapSearchKeyword} onChange={setLdapSearchKeyword} onSearch={handleLdapSearch} />
          <SearchButton onClick={handleLdapSearch} loading={ldapSearchMutation.isPending}>搜索</SearchButton>
        </div>
        <Table
          size="small"
          loading={ldapSearchMutation.isPending}
          dataSource={ldapSearchUsers}
          rowKey="dn"
          pagination={false}
          columns={[
            { title: '用户名', dataIndex: 'username', width: 140, render: renderEllipsis },
            { title: '昵称', dataIndex: 'nickname', width: 140, render: renderEllipsis },
            { title: '邮箱', dataIndex: 'email', width: 190, render: renderEllipsis },
            { title: '部门', dataIndex: 'department', width: 140, render: renderEllipsis },
            { title: 'DN', dataIndex: 'dn', render: renderEllipsis },
          ]}
        />
      </SideSheet>
    </div>
  );
}
