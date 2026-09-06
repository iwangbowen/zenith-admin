import {
  enterpriseAuthContract,
  identityProviderContract,
  type LdapDirectoryUser,
  type LoginResponse,
  type TenantIdentityProvider,
} from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

const directoryUsers: LdapDirectoryUser[] = [
  {
    dn: 'cn=Alice Chen,ou=users,dc=example,dc=com',
    subject: 'demo-guid-alice',
    username: 'alice.chen',
    nickname: 'Alice Chen',
    email: 'alice.chen@example.com',
    phone: '13800000001',
    department: '研发中心',
  },
  {
    dn: 'cn=Bob Li,ou=users,dc=example,dc=com',
    subject: 'demo-guid-bob',
    username: 'bob.li',
    nickname: 'Bob Li',
    email: 'bob.li@example.com',
    phone: '13800000002',
    department: '产品部',
  },
];

const providers: TenantIdentityProvider[] = [
  {
    id: 1,
    tenantId: 1,
    tenantName: '演示租户',
    name: '演示 OIDC',
    code: 'demo_oidc',
    type: 'oidc',
    status: 'enabled',
    issuer: 'https://idp.example.com',
    authorizationEndpoint: 'https://idp.example.com/oauth2/authorize',
    tokenEndpoint: 'https://idp.example.com/oauth2/token',
    userinfoEndpoint: 'https://idp.example.com/oauth2/userinfo',
    jwksUri: 'https://idp.example.com/.well-known/jwks.json',
    clientId: 'demo-client',
    clientSecret: '******',
    scopes: 'openid profile email',
    samlSsoUrl: null,
    samlEntityId: null,
    samlCertificate: '',
    ldapUrl: null,
    ldapStartTls: false,
    ldapSkipTlsVerify: false,
    ldapBaseDn: null,
    ldapBindDn: null,
    ldapBindPassword: '',
    ldapUserFilter: null,
    ldapUserSearchFilter: null,
    ldapSyncFilter: null,
    ldapGroupBaseDn: null,
    ldapGroupFilter: null,
    ldapTimeoutMs: 5000,
    attributeMapping: { subject: 'sub', email: 'email', username: 'preferred_username', nickname: 'name', phone: 'phone_number', department: 'department' },
    jitEnabled: true,
    autoLinkByEmail: false,
    defaultRoleIds: [2],
    remark: '演示身份源',
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
  {
    id: 2,
    tenantId: null,
    tenantName: null,
    name: '平台 SAML',
    code: 'platform_saml',
    type: 'saml',
    status: 'enabled',
    issuer: 'https://idp.example.com/saml/metadata',
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userinfoEndpoint: null,
    jwksUri: null,
    clientId: null,
    clientSecret: '',
    scopes: 'openid profile email',
    samlSsoUrl: 'https://idp.example.com/saml/sso',
    samlEntityId: 'https://zenith.example.com/saml/sp',
    samlCertificate: '******',
    ldapUrl: null,
    ldapStartTls: false,
    ldapSkipTlsVerify: false,
    ldapBaseDn: null,
    ldapBindDn: null,
    ldapBindPassword: '',
    ldapUserFilter: null,
    ldapUserSearchFilter: null,
    ldapSyncFilter: null,
    ldapGroupBaseDn: null,
    ldapGroupFilter: null,
    ldapTimeoutMs: 5000,
    attributeMapping: { subject: 'NameID', email: 'email', username: 'username', nickname: 'displayName', phone: 'phone', department: 'department' },
    jitEnabled: false,
    autoLinkByEmail: false,
    defaultRoleIds: [],
    remark: '',
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
  {
    id: 3,
    tenantId: null,
    tenantName: null,
    name: '平台 AD',
    code: 'platform_ad',
    type: 'ad',
    status: 'enabled',
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userinfoEndpoint: null,
    jwksUri: null,
    clientId: null,
    clientSecret: '',
    scopes: 'openid profile email',
    samlSsoUrl: null,
    samlEntityId: null,
    samlCertificate: '',
    ldapUrl: 'ldap://ad.example.com:389',
    ldapStartTls: true,
    ldapSkipTlsVerify: false,
    ldapBaseDn: 'dc=example,dc=com',
    ldapBindDn: 'cn=readonly,dc=example,dc=com',
    ldapBindPassword: '******',
    ldapUserFilter: '(&(objectClass=person)(|(sAMAccountName={{username}})(mail={{username}})))',
    ldapUserSearchFilter: '(&(objectClass=person)(|(displayName=*{{keyword}}*)(sAMAccountName=*{{keyword}}*)(mail=*{{keyword}}*)))',
    ldapSyncFilter: '(&(objectClass=person)(|(sAMAccountName=*)(mail=*)))',
    ldapGroupBaseDn: 'ou=groups,dc=example,dc=com',
    ldapGroupFilter: '(member={{dn}})',
    ldapTimeoutMs: 5000,
    attributeMapping: { subject: 'objectGUID', email: 'mail', username: 'sAMAccountName', nickname: 'displayName', phone: 'telephoneNumber', department: 'department' },
    jitEnabled: true,
    autoLinkByEmail: false,
    defaultRoleIds: [2],
    remark: '演示 AD 身份源',
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
];

/** 企业登录演示统一落到 admin 账号 */
function enterpriseLoginResult(tokenPrefix: string): LoginResponse {
  const { password: _, ...user } = mockUsers[0];
  return {
    user,
    token: { accessToken: `${tokenPrefix}-access-token`, refreshToken: `${tokenPrefix}-refresh-token` },
  };
}

export const identityProvidersHandlers = [
  mock(identityProviderContract.list, ({ query, ok, paginate }) => {
    const { keyword, type, status } = query;
    let list = [...providers];
    if (keyword) list = filterByKeyword(list, keyword, [(item) => item.name, (item) => item.code]);
    if (type) list = list.filter((item) => item.type === type);
    if (status) list = list.filter((item) => item.status === status);
    return ok(paginate(list));
  }),

  mock(identityProviderContract.detail, ({ params, ok }) => {
    const item = providers.find((provider) => provider.id === params.id);
    if (!item) return notFound('身份源不存在', { status: 404 });
    return ok(item);
  }),

  mock(identityProviderContract.create, ({ body, ok }) => {
    const item: TenantIdentityProvider = {
      ...body,
      id: nextIdFrom(providers),
      tenantId: body.tenantId ?? null,
      tenantName: body.tenantId ? '演示租户' : null,
      clientSecret: body.clientSecret ? '******' : '',
      samlCertificate: body.samlCertificate ? '******' : '',
      ldapBindPassword: body.ldapBindPassword ? '******' : '',
      remark: body.remark ?? '',
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    providers.unshift(item);
    return ok(item, '创建成功');
  }),

  mock(identityProviderContract.update, ({ params, body, ok }) => {
    const item = providers.find((provider) => provider.id === params.id);
    if (!item) return notFound('身份源不存在', { status: 404 });
    Object.assign(item, body, {
      tenantName: body.tenantId ? '演示租户' : null,
      clientSecret: body.clientSecret && body.clientSecret !== '******' ? '******' : item.clientSecret,
      samlCertificate: body.samlCertificate && body.samlCertificate !== '******' ? '******' : item.samlCertificate,
      ldapBindPassword: body.ldapBindPassword && body.ldapBindPassword !== '******' ? '******' : item.ldapBindPassword,
      updatedAt: mockDateTime(),
    });
    return ok(item, '更新成功');
  }),

  mock(identityProviderContract.test, ({ params, ok }) => {
    const item = providers.find((provider) => provider.id === params.id);
    if (!item) return notFound('身份源不存在', { status: 404 });
    return ok({ ok: item.type === 'ldap' || item.type === 'ad', message: '连接成功', sampleUsers: directoryUsers.slice(0, 2) });
  }),

  mock(identityProviderContract.ldapUsers, ({ params, query, ok }) => {
    const item = providers.find((provider) => provider.id === params.id);
    if (!item) return notFound('身份源不存在', { status: 404 });
    const keyword = (query.keyword ?? '').toLowerCase();
    const list = filterByKeyword(directoryUsers, keyword, [(user) => user.username, (user) => user.nickname, (user) => user.email, (user) => user.department], { caseInsensitive: true });
    return ok(list.slice(0, query.limit));
  }),

  mock(identityProviderContract.sync, ({ params, ok }) => {
    const item = providers.find((provider) => provider.id === params.id);
    if (!item) return notFound('身份源不存在', { status: 404 });
    return ok({
      logId: 1,
      status: 'success',
      total: directoryUsers.length,
      created: 1,
      linked: 0,
      updated: 1,
      skipped: 0,
      failed: 0,
      message: '同步完成：创建 1，绑定 0，更新 1，跳过 0，失败 0',
    }, '同步完成');
  }),

  mock(identityProviderContract.remove, ({ params, ok }) => {
    const index = providers.findIndex((provider) => provider.id === params.id);
    if (index === -1) return notFound('身份源不存在', { status: 404 });
    providers.splice(index, 1);
    return ok(null, '删除成功');
  }),

  mock(enterpriseAuthContract.providers, ({ query, ok }) => {
    const tenantCode = query.tenantCode ?? null;
    const visible = providers
      .filter((item) => item.status === 'enabled' && (tenantCode ? item.tenantId === 1 : item.tenantId === null))
      .map(({ id, name, code, type }) => ({ id, name, code, type }));
    return ok({ tenantCode, providers: visible });
  }),

  mock(enterpriseAuthContract.ldapLogin, ({ body, ok }) => {
    const provider = providers.find((item) => item.id === body.providerId);
    if (!provider || (provider.type !== 'ldap' && provider.type !== 'ad')) {
      return badRequest('身份源不可用', { status: 400 });
    }
    if (!body.username || !body.password) {
      return badRequest('目录账号或密码错误', { status: 400 });
    }
    return ok({
      redirectTo: body.redirectTo || '/',
      loginResult: enterpriseLoginResult('mock-ldap'),
    }, '登录成功');
  }),

  mock(enterpriseAuthContract.authUrl, ({ params, ok }) => {
    const provider = providers.find((item) => item.id === params.id);
    return ok({
      authUrl: provider?.type === 'saml'
        ? `/enterprise/callback?samlTicket=demo-saml-ticket-${params.id}`
        : `/enterprise/callback?code=demo-code&state=demo-state-${params.id}`,
      state: `demo-state-${params.id}`,
    });
  }),

  mock(enterpriseAuthContract.callback, ({ ok }) => {
    return ok({
      redirectTo: '/',
      loginResult: enterpriseLoginResult('mock-enterprise'),
    }, '登录成功');
  }),

  mock(enterpriseAuthContract.samlExchange, ({ ok }) => {
    return ok({
      redirectTo: '/',
      loginResult: enterpriseLoginResult('mock-saml'),
    }, '登录成功');
  }),
];
