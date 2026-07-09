import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Switch,
  Table,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type {
  IdentityProviderType,
  TenantIdentityProvider,
} from '@zenith/shared';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import { usePagination } from '@/hooks/usePagination';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { useAllRoles } from '@/hooks/queries/roles';
import {
  identityProviderKeys,
  useDeleteIdentityProvider,
  useIdentityProviderDetail,
  useIdentityProviderList,
  useIdentityProviderTenants,
  useSaveIdentityProvider,
  useSearchLdapDirectoryUsers,
  useSyncIdentityProviderDirectory,
  useTestIdentityProviderConnection,
} from '@/hooks/queries/identity-providers';
import { useDictItems } from '@/hooks/useDictItems';

interface SearchParams {
  keyword: string;
  type: string;
  status: string;
  tenantId: string;
}

const defaultSearchParams: SearchParams = {
  keyword: '',
  type: '',
  status: '',
  tenantId: '',
};

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
  const { items: statusItems } = useDictItems('common_status');
  const statusOptions = statusItems.map((i) => ({ value: i.value, label: i.label }));
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<TenantIdentityProvider | null>(null);
  const [providerType, setProviderType] = useState<IdentityProviderType>('oidc');
  const [ldapSearchVisible, setLdapSearchVisible] = useState(false);
  const [ldapSearchProvider, setLdapSearchProvider] = useState<TenantIdentityProvider | null>(null);
  const [ldapSearchKeyword, setLdapSearchKeyword] = useState('');
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const listQuery = useIdentityProviderList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: submittedParams.type || undefined,
    status: submittedParams.status || undefined,
    tenantId: submittedParams.tenantId || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useIdentityProviderDetail(editing?.id, modalVisible);
  const editingDetail = editing ? (detailQuery.data ?? editing) : null;
  const tenantsQuery = useIdentityProviderTenants();
  const rolesQuery = useAllRoles();
  const tenantOptions = (tenantsQuery.data ?? []).map((item) => ({ value: item.id, label: `${item.name}（${item.code}）` }));
  const roleOptions = (rolesQuery.data ?? []).map((item) => ({ value: item.id, label: item.name }));
  const saveMutation = useSaveIdentityProvider();
  const toggleStatusMutation = useSaveIdentityProvider();
  const deleteMutation = useDeleteIdentityProvider();
  const testConnectionMutation = useTestIdentityProviderConnection();
  const ldapSearchMutation = useSearchLdapDirectoryUsers();
  const syncDirectoryMutation = useSyncIdentityProviderDirectory();
  const ldapSearchUsers = ldapSearchMutation.data ?? [];

  useEffect(() => {
    if (detailQuery.data) setProviderType(detailQuery.data.type);
  }, [detailQuery.data]);

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: identityProviderKeys.lists });
  }

  function handleReset() {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: identityProviderKeys.lists });
  }

  function openCreate() {
    setEditing(null);
    setProviderType('oidc');
    setModalVisible(true);
  }

  function handleProviderTypeChange(value: unknown) {
    const nextType = (value === 'saml' || value === 'ldap' || value === 'ad') ? value : 'oidc';
    setProviderType(nextType);
    const nextMapping = mappingForType(nextType);
    formApi.current?.setValues({
      'attributeMapping.subject': nextMapping.subject,
      'attributeMapping.email': nextMapping.email,
      'attributeMapping.username': nextMapping.username,
      'attributeMapping.nickname': nextMapping.nickname,
      'attributeMapping.phone': nextMapping.phone,
      'attributeMapping.department': nextMapping.department,
    });
  }

  function openEdit(row: TenantIdentityProvider) {
    setEditing(row);
    setProviderType(row.type);
    setModalVisible(true);
  }

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    const activeMapping = mappingForType(providerType);
    const payload = {
      ...values,
      tenantId: values.tenantId ?? null,
      type: providerType,
      attributeMapping: {
        subject: values['attributeMapping.subject'] || activeMapping.subject,
        email: values['attributeMapping.email'] || activeMapping.email,
        username: values['attributeMapping.username'] || activeMapping.username,
        nickname: values['attributeMapping.nickname'] || activeMapping.nickname,
        phone: values['attributeMapping.phone'] || activeMapping.phone,
        department: values['attributeMapping.department'] || activeMapping.department,
      },
      defaultRoleIds: Array.isArray(values.defaultRoleIds) ? values.defaultRoleIds : [],
    };
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
  }

  function handleToggleStatus(row: TenantIdentityProvider, checked: boolean) {
    toggleStatusMutation.mutate(
      { id: row.id, values: { status: checked ? 'enabled' : 'disabled' } },
      { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
    );
  }

  function handleDelete(row: TenantIdentityProvider) {
    Modal.confirm({
      title: `确认删除身份源「${row.name}」？`,
      content: '删除后，已绑定的企业身份账号关系也会被移除。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(row.id);
        Toast.success('删除成功');
      },
    });
  }

  async function handleTestConnection(row: TenantIdentityProvider) {
    try {
      const result = await testConnectionMutation.mutateAsync(row.id);
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
      await ldapSearchMutation.mutateAsync({ id: ldapSearchProvider.id, keyword: ldapSearchKeyword || undefined });
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
          const result = await syncDirectoryMutation.mutateAsync(row.id);
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
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
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
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: string, row) => (
        <Switch
          size="small"
          checked={value === 'enabled'}
          loading={toggleStatusMutation.isPending && toggleStatusMutation.variables?.id === row.id}
          onChange={(checked: boolean) => handleToggleStatus(row, checked)}
        />
      ),
    },
    createOperationColumn<TenantIdentityProvider>({
      width: 220,
      desktopInlineKeys: ['edit', 'test', 'delete'],
      actions: (row) => [
        { key: 'edit', label: '编辑', onClick: () => { void openEdit(row); } },
        { key: 'test', label: '测试', hidden: !isDirectoryType(row.type), onClick: () => { void handleTestConnection(row); } },
        { key: 'searchUsers', label: '搜索用户', hidden: !isDirectoryType(row.type), onClick: () => openLdapSearch(row) },
        { key: 'sync', label: '同步', hidden: !isDirectoryType(row.type), onClick: () => handleSyncDirectory(row) },
        { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(row) },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称/编码"
      value={draftParams.keyword}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
      onEnterPress={handleSearch}
      style={{ width: 220, maxWidth: '100%' }}
      showClear
    />
  );

  const renderTypeFilter = () => (
    <Select
      placeholder="类型"
      value={draftParams.type || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, type: (value as string) ?? '' }))}
      style={{ width: 130, maxWidth: '100%' }}
      optionList={[{ value: '', label: '全部类型' }, ...providerTypeOptions]}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="状态"
      value={draftParams.status || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
      style={{ width: 130, maxWidth: '100%' }}
      optionList={[{ value: '', label: '全部状态' }, ...statusOptions]}
    />
  );

  const initMapping = mappingForType(editingDetail?.type ?? 'oidc');
  const initValues = editingDetail ? {
    ...editingDetail,
    tenantId: editingDetail.tenantId ?? undefined,
    defaultRoleIds: editingDetail.defaultRoleIds ?? [],
    'attributeMapping.subject': editingDetail.attributeMapping?.subject || initMapping.subject,
    'attributeMapping.email': editingDetail.attributeMapping?.email || initMapping.email,
    'attributeMapping.username': editingDetail.attributeMapping?.username || initMapping.username,
    'attributeMapping.nickname': editingDetail.attributeMapping?.nickname || initMapping.nickname,
    'attributeMapping.phone': editingDetail.attributeMapping?.phone || initMapping.phone,
    'attributeMapping.department': editingDetail.attributeMapping?.department || initMapping.department,
  } : {
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
    defaultRoleIds: [],
    ...Object.fromEntries(Object.entries(defaultMapping).map(([key, value]) => [`attributeMapping.${key}`, value])),
  };

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderTypeFilter()}
            {renderStatusFilter()}
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
          </>
        )}
        mobileFilters={<>{renderTypeFilter()}{renderStatusFilter()}</>}
        filterTitle="身份源筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal
        title={editing ? '编辑企业身份源' : '新增企业身份源'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditing(null);
        }}
        onOk={handleModalOk}
        closeOnEsc
        width={760}
      >
        <Form
          key={editingDetail?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={initValues}
          labelPosition="left"
          labelWidth={110}
        >
          <Row gutter={16}>
            <Col span={12}><Form.Input field="name" label="名称" placeholder="Azure AD / Okta" rules={[{ required: true, message: '请输入名称' }]} /></Col>
            <Col span={12}><Form.Input field="code" label="编码" placeholder="azure_ad" rules={[{ required: true, message: '请输入编码' }]} /></Col>
          </Row>
          <Row gutter={16}>
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
            <Col span={12}><Form.Switch field="jitEnabled" label="JIT 创建" /></Col>
          </Row>

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
          <Form.Select
            field="defaultRoleIds"
            label="默认角色"
            multiple
            optionList={roleOptions}
            style={{ width: '100%' }}
          />
          <Form.TextArea field="remark" label="备注" rows={3} />
        </Form>
      </AppModal>

      <AppModal
        title={ldapSearchProvider ? `搜索目录用户 - ${ldapSearchProvider.name}` : '搜索目录用户'}
        visible={ldapSearchVisible}
        onCancel={() => setLdapSearchVisible(false)}
        onOk={handleLdapSearch}
        okText="搜索"
        closeOnEsc
        width={860}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            prefix={<Search size={14} />}
            placeholder="输入用户名、姓名或邮箱关键字"
            value={ldapSearchKeyword}
            onChange={setLdapSearchKeyword}
            onEnterPress={handleLdapSearch}
            showClear
          />
          <Button type="primary" icon={<Search size={14} />} loading={ldapSearchMutation.isPending} onClick={handleLdapSearch}>搜索</Button>
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
      </AppModal>
    </div>
  );
}
