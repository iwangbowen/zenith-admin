import {
  apiCatalogContract,
  apiTokenContract,
  authContract,
  departmentContract,
  directorySyncContract,
  directorySyncSourceContract,
  enterpriseAuthContract,
  identityProviderContract,
  identitySecurityContract,
  impersonationContract,
  loginLogContract,
  menuContract,
  oauthConfigContract,
  permissionMatrixContract,
  oauthContract,
  positionContract,
  roleContract,
  sessionContract,
  tenantContract,
  tenantPackageContract,
  userContract,
  userGroupContract,
} from '@zenith/shared/identity';
import { defineRouteDomain } from '../_kit';
import apiCatalogRoutes from './api-catalog';
import apiTokensRoutes from './api-tokens';
import authRoutes from './auth';
import departmentsRoutes from './departments';
import directorySyncRoutes from './directory-sync';
import directorySyncCallbacksRoutes from './directory-sync-callbacks';
import directorySyncSourcesRoutes from './directory-sync-sources';
import enterpriseAuthRoutes from './enterprise-auth';
import identityProvidersRoutes from './identity-providers';
import identitySecurityRoutes from './identity-security';
import impersonationRoutes from './impersonation';
import loginLogsRoutes from './login-logs';
import menusRoutes from './menus';
import oauthConfigRoutes from './oauth-config';
import permissionMatrixRoutes from './permission-matrix';
import oauthRoutes from './oauth';
import positionsRoutes from './positions';
import rolesRoutes from './roles';
import sessionsRoutes from './sessions';
import tenantPackagesRoutes from './tenant-packages';
import tenantsRoutes from './tenants';
import userGroupsRoutes from './user-groups';
import usersRoutes from './users';

export default defineRouteDomain({
  name: 'identity',
  licensing: { core: '身份、组织与权限管理是基础能力' },
  mounts: () => [
    [authContract.basePath, authRoutes],
    [userContract.basePath, usersRoutes],
    [departmentContract.basePath, departmentsRoutes],
    [positionContract.basePath, positionsRoutes],
    [userGroupContract.basePath, userGroupsRoutes],
    [menuContract.basePath, menusRoutes],
    [roleContract.basePath, rolesRoutes],
    [permissionMatrixContract.basePath, permissionMatrixRoutes],
    [apiCatalogContract.basePath, apiCatalogRoutes],
    [loginLogContract.basePath, loginLogsRoutes],
    [identitySecurityContract.basePath, identitySecurityRoutes],
    [impersonationContract.basePath, impersonationRoutes],
    [identityProviderContract.basePath, identityProvidersRoutes],
    [directorySyncSourceContract.basePath, directorySyncSourcesRoutes],
    [directorySyncContract.basePath, directorySyncRoutes],
    // 机器端点（平台回调 / SCIM）：公开路径，自带验签与 Bearer 校验；响应由平台协议决定，不走契约
    [directorySyncContract.basePath, directorySyncCallbacksRoutes],
    [sessionContract.basePath, sessionsRoutes],
    [tenantContract.basePath, tenantsRoutes],
    [tenantPackageContract.basePath, tenantPackagesRoutes],
    [oauthContract.basePath, oauthRoutes],
    [enterpriseAuthContract.basePath, enterpriseAuthRoutes],
    [oauthConfigContract.basePath, oauthConfigRoutes],
    // 个人访问令牌属于账号安全能力（入口在个人中心），归 identity 域
    [apiTokenContract.basePath, apiTokensRoutes],
  ],
});
