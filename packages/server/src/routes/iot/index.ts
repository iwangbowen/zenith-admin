import { upgradeWebSocket } from '@hono/node-server';
import {
  iotAlarmContract, iotAlarmRuleContract, iotAutomationContract, iotBatchContract, iotDashboardContract,
  iotDeviceContract, iotDeviceGroupContract, iotFirmwareContract, iotForwardRuleContract, iotIngestContract,
  iotMaintenanceWindowContract, iotOtaTaskContract, iotProductContract, iotScheduleContract, iotWhitelistContract,
} from '@zenith/shared/iot';
import { defineRouteDomain } from '../_kit';
import iotProductsRoutes from './iot-products';
import iotDevicesRoutes from './iot-devices';
import iotGroupsRoutes from './iot-groups';
import iotBatchRoutes from './batch';
import { iotAlarmsRouter, iotAlarmRulesRouter, iotMaintenanceWindowsRouter } from './iot-alarms';
import { iotAutomationsRouter } from './iot-automations';
import { iotForwardRulesRouter } from './iot-forwards';
import { iotSchedulesRouter } from './iot-schedules';
import { iotWhitelistRouter } from './iot-register';
import { iotDashboardRouter, iotFirmwaresRouter, iotOtaTasksRouter } from './iot-ota';
import ingestRoutes from './ingest';
import { createIotWsRoute } from './ws';

export default defineRouteDomain({
  name: 'iot',
  licensing: { feature: 'iot' },
  mounts: () => [
    [iotDashboardContract.basePath, iotDashboardRouter],
    [iotProductContract.basePath, iotProductsRoutes],
    [iotDeviceContract.basePath, iotDevicesRoutes],
    [iotDeviceGroupContract.basePath, iotGroupsRoutes],
    [iotBatchContract.basePath, iotBatchRoutes],
    [iotAlarmContract.basePath, iotAlarmsRouter],
    [iotAlarmRuleContract.basePath, iotAlarmRulesRouter],
    [iotMaintenanceWindowContract.basePath, iotMaintenanceWindowsRouter],
    [iotAutomationContract.basePath, iotAutomationsRouter],
    [iotForwardRuleContract.basePath, iotForwardRulesRouter],
    [iotScheduleContract.basePath, iotSchedulesRouter],
    [iotWhitelistContract.basePath, iotWhitelistRouter],
    [iotFirmwareContract.basePath, iotFirmwaresRouter],
    [iotOtaTaskContract.basePath, iotOtaTasksRouter],
    // 设备侧接入通道（HMAC 鉴权，无管理端 token）
    [iotIngestContract.basePath, ingestRoutes, { licenseExempt: '设备侧接入通道保留 HMAC 鉴权与现有持续接入行为' }],
    ['/api/iot/ws', createIotWsRoute(upgradeWebSocket), { licenseExempt: '设备侧 WebSocket 接入保留设备鉴权' }],
  ],
});
