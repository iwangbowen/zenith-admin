import { authHandlers } from './auth';
import { usersHandlers } from './users';
import { rolesHandlers } from './roles';
import { menusHandlers } from './menus';
import { departmentsHandlers } from './departments';
import { positionsHandlers } from './positions';
import { dictsHandlers } from './dicts';
import { systemConfigsHandlers } from './system-configs';
import { noticesHandlers } from './notices';
import { filesHandlers } from './files';
import { cronJobsHandlers } from './cron-jobs';
import { monitorHandlers } from './monitor';
import { loginLogsHandlers } from './login-logs';
import { operationLogsHandlers } from './operation-logs';
import { sessionsHandlers } from './sessions';
import { regionsHandlers } from './regions';

export const handlers = [
  ...authHandlers,
  ...usersHandlers,
  ...rolesHandlers,
  ...menusHandlers,
  ...departmentsHandlers,
  ...positionsHandlers,
  ...dictsHandlers,
  ...systemConfigsHandlers,
  ...noticesHandlers,
  ...filesHandlers,
  ...cronJobsHandlers,
  ...monitorHandlers,
  ...loginLogsHandlers,
  ...operationLogsHandlers,
  ...sessionsHandlers,
  ...regionsHandlers,
];
