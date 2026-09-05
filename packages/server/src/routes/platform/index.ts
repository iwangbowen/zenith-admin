import { upgradeWebSocket } from '@hono/node-server';
import { licensingContract } from '@zenith/shared/licensing';
import {
  cacheContract,
  dataMaskConfigContract,
  dictContract,
  healthContract,
  ipAccessLogContract,
  monitorAlertContract,
  monitorContract,
  operationLogContract,
  rateLimitContract,
  regionContract,
  systemConfigContract,
  tagContract,
  traceContract,
  userFeedbackContract,
} from '@zenith/shared/platform';
import {
  decisionFlowContract,
  decisionTableContract,
  ruleExecutionContract,
  ruleListContract,
  ruleScorecardContract,
} from '@zenith/shared/rules';
import { defineRouteDomain } from '../_kit';
import cacheRoutes from './cache';
import dataMaskConfigsRoutes from './data-mask-configs';
import dictsRoutes from './dicts';
import healthRoutes from './health';
import ipAccessLogsRoutes from './ip-access-logs';
import monitorAlertsRoutes from './monitor-alerts';
import monitorRoutes from './monitor';
import operationLogsRoutes from './operation-logs';
import rateLimitRoutes from './rate-limit';
import regionsRoutes from './regions';
import rulesExecutionsRoutes from './rules-executions';
import rulesFlowsRoutes from './rules-flows';
import rulesListsRoutes from './rules-lists';
import rulesScorecardsRoutes from './rules-scorecards';
import rulesRoutes from './rules';
import systemConfigsRoutes from './system-configs';
import licensingRoutes from './licensing';
import tagsRoutes from './tags';
import traceRoutes from './trace';
import userFeedbacksRoutes from './user-feedbacks';
import { createWsRoute } from './ws';

export default defineRouteDomain({
  name: 'platform',
  mounts: () => [
    [dictContract.basePath, dictsRoutes],
    [monitorContract.basePath, monitorRoutes],
    [monitorAlertContract.basePath, monitorAlertsRoutes],
    [operationLogContract.basePath, operationLogsRoutes],
    [ipAccessLogContract.basePath, ipAccessLogsRoutes],
    [systemConfigContract.basePath, systemConfigsRoutes],
    // License 管理面永不打 feature 标（受限模式下也必须可达，否则无法自救）
    [licensingContract.basePath, licensingRoutes],
    [userFeedbackContract.basePath, userFeedbacksRoutes],
    [dataMaskConfigContract.basePath, dataMaskConfigsRoutes],
    [regionContract.basePath, regionsRoutes],
    [cacheContract.basePath, cacheRoutes],
    [decisionTableContract.basePath, rulesRoutes, { feature: 'rules' }],
    [decisionFlowContract.basePath, rulesFlowsRoutes, { feature: 'rules' }],
    [ruleExecutionContract.basePath, rulesExecutionsRoutes, { feature: 'rules' }],
    [ruleListContract.basePath, rulesListsRoutes, { feature: 'rules' }],
    [ruleScorecardContract.basePath, rulesScorecardsRoutes, { feature: 'rules' }],
    [tagContract.basePath, tagsRoutes],
    [traceContract.basePath, traceRoutes],
    [rateLimitContract.basePath, rateLimitRoutes],
    ['/api/ws', createWsRoute(upgradeWebSocket)],
    [healthContract.basePath, healthRoutes],
  ],
});
