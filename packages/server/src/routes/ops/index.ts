import { upgradeWebSocket } from '@hono/node-server';
import {
  appArtifactContract,
  appReleaseContract,
  appReleaseStatsContract,
  clientAppContract,
  clientDeviceContract,
  dbAdminContract,
  dbBackupContract,
  dockerContract,
  firewallContract,
  hostFileContract,
  logFileContract,
  logViewerContract,
  maintenanceContract,
  networkDiagContract,
  nginxSiteContract,
  opsHostContract,
  opsOverviewContract,
  portContract,
  processContract,
  publicAppReleaseContract,
  pushDeviceContract,
  retentionPolicyContract,
  sshProfileContract,
  sshSftpContract,
  sslCertificateContract,
  systemdContract,
  terminalFileContract,
  terminalRecordingContract,
  terminalSessionContract,
} from '@zenith/shared/ops';
import { defineRouteDomain } from '../_kit';
import {
  appArtifactsRouter,
  appReleaseStatsRouter,
  appReleasesRouter,
  clientAppsRouter,
  clientDevicesRouter,
} from './app-releases';
import publicAppReleasesRoutes from './public-app-releases';
import { adminPushDevicesRouter } from './push-devices';
import dbAdminRoutes from './db-admin';
import dbBackupsRoutes from './db-backups';
import dockerRoutes from './docker';
import firewallRoutes from './firewall';
import hostFilesRoutes from './host-files';
import hostsRoutes from './hosts';
import logFilesRoutes from './log-files';
import logViewerRoutes from './log-viewer';
import maintenanceRoutes from './maintenance';
import networkDiagRoutes from './network-diag';
import nginxSitesRoutes from './nginx-sites';
import opsOverviewRoutes from './ops-overview';
import portsRoutes from './ports';
import processesRoutes from './processes';
import retentionRoutes from './retention';
import sshProfilesRoutes from './ssh-profiles';
import sshSftpRoutes from './ssh-sftp';
import sslCertificatesRoutes from './ssl-certificates';
import systemdRoutes from './systemd';
import terminalFilesRoutes from './terminal-files';
import terminalRecordingsRoutes from './terminal-recordings';
import terminalSessionsRoutes from './terminal-sessions';
import { createWsTerminalRoute, createWsTerminalMonitorRoute } from './ws-terminal';

export default defineRouteDomain({
  name: 'ops',
  mounts: () => [
    [maintenanceContract.basePath, maintenanceRoutes],
    [sslCertificateContract.basePath, sslCertificatesRoutes, { feature: 'ops' }],
    [dbBackupContract.basePath, dbBackupsRoutes, { feature: 'ops' }],
    [dbAdminContract.basePath, dbAdminRoutes, { feature: 'ops' }],
    ['/api/ws/terminal', createWsTerminalRoute(upgradeWebSocket), { feature: 'ops' }],
    ['/api/ws/terminal-monitor', createWsTerminalMonitorRoute(upgradeWebSocket), { feature: 'ops' }],
    [processContract.basePath, processesRoutes, { feature: 'ops' }],
    [terminalFileContract.basePath, terminalFilesRoutes, { feature: 'ops' }],
    [terminalRecordingContract.basePath, terminalRecordingsRoutes, { feature: 'ops' }],
    [sshProfileContract.basePath, sshProfilesRoutes, { feature: 'ops' }],
    [sshSftpContract.basePath, sshSftpRoutes, { feature: 'ops' }],
    [terminalSessionContract.basePath, terminalSessionsRoutes, { feature: 'ops' }],
    [portContract.basePath, portsRoutes, { feature: 'ops' }],
    [firewallContract.basePath, firewallRoutes, { feature: 'ops' }],
    [dockerContract.basePath, dockerRoutes, { feature: 'ops' }],
    [networkDiagContract.basePath, networkDiagRoutes, { feature: 'ops' }],
    [systemdContract.basePath, systemdRoutes, { feature: 'ops' }],
    [logViewerContract.basePath, logViewerRoutes, { feature: 'ops' }],
    [nginxSiteContract.basePath, nginxSitesRoutes, { feature: 'ops' }],
    [opsOverviewContract.basePath, opsOverviewRoutes, { feature: 'ops' }],
    [opsHostContract.basePath, hostsRoutes, { feature: 'ops' }],
    [hostFileContract.basePath, hostFilesRoutes, { feature: 'ops' }],
    [logFileContract.basePath, logFilesRoutes, { feature: 'ops' }],
    [retentionPolicyContract.basePath, retentionRoutes, { feature: 'ops' }],
    // 应用版本管理：静态子资源前缀先挂载，再挂载 /api/app-releases 根（看板统计）
    [clientAppContract.basePath, clientAppsRouter],
    [appReleaseContract.basePath, appReleasesRouter],
    [appArtifactContract.basePath, appArtifactsRouter],
    [clientDeviceContract.basePath, clientDevicesRouter],
    [appReleaseStatsContract.basePath, appReleaseStatsRouter],
    // 公开面（客户端检查更新 / 制品分发）不声明 feature：在网客户端必须始终可达
    [publicAppReleaseContract.basePath, publicAppReleasesRoutes],
    // 设备推送绑定（管理端 App，登录态即可）
    [pushDeviceContract.basePath, adminPushDevicesRouter],
  ],
});
