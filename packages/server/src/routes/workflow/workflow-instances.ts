// 工作流实例路由 — 路由常量已按业务域拆分至 instances/ 子模块。
// 本文件仅负责聚合注册；⚠️ 三段 openapiRoutes 的注册顺序不可调整
// （RegExpRouter 按注册顺序解析，静态路径必须先于同前缀的参数化路径）。
import { OpenAPIHono } from '@hono/zod-openapi';
import { validationHook } from '../../lib/openapi-schemas';
import {
  listRoute, pendingMineRoute, pendingMineCountRoute, allRoute, ccMineRoute, handledMineRoute,
  ccUnreadCountRoute, relationOptionsRoute, detailRoute, analyticsRoute, overdueRoute,
} from './instances/queries';
import {
  createInstanceRoute, withdrawRoute, cancelInstanceRoute, deleteInstanceRoute,
  updateDraftRoute, submitDraftRoute, resubmitRoute,
} from './instances/lifecycle';
import { approveRoute, selectableNextApproversRoute, rejectRoute } from './instances/task-actions';
import { transferRoute, delegateRoute, addSignRoute, reduceSignRoute, returnRoute } from './instances/task-routing';
import {
  ccReadRoute, forwardRoute, urgeRoute, listTaskUrgesRoute,
  listInstanceUrgesRoute, urgeInstanceRoute, addInstanceCcRoute,
} from './instances/cc-urge';
import {
  listCommentsRoute, addCommentRoute, consultRoute, myConsultsRoute, replyConsultRoute,
} from './instances/comments-consults';
import { batchApproveRoute, batchRejectRoute, batchWithdrawRoute, batchUrgeRoute } from './instances/batch';
import { diagnosticsRoute, traceRoute, tokensRoute, diagnosticBundleRoute } from './instances/diagnostics';
import { suspendInstanceRoute, resumeInstanceRoute, handoverPreviewRoute, handoverRoute } from './instances/admin-ops';
import {
  tokenSkipRoute, tokenReplayRoute, batchSkipStuckRoute,
  jumpInstanceRoute, reassignRoute, recallRoute,
} from './instances/admin-ops';
import { migratePreflightRoute, migrateRoute, migrationsRoute, migrateBatchRoute } from './instances/migration';
import {
  compensationsRoute, compensationResolveRoute, compensationDetailRoute,
  compensationNoteRoute, compensationRetryRoute, compensationResumeRoute,
} from './instances/compensation';

const router = new OpenAPIHono({ defaultHook: validationHook });

router.openapiRoutes([listRoute, pendingMineRoute, pendingMineCountRoute, allRoute, ccMineRoute, handledMineRoute, ccUnreadCountRoute, relationOptionsRoute, analyticsRoute, overdueRoute, myConsultsRoute, batchWithdrawRoute, batchUrgeRoute, ccReadRoute, diagnosticsRoute, traceRoute, tokensRoute, diagnosticBundleRoute, detailRoute, listCommentsRoute, addCommentRoute, createInstanceRoute, updateDraftRoute, submitDraftRoute, resubmitRoute] as const);
router.openapiRoutes([withdrawRoute, forwardRoute, cancelInstanceRoute, jumpInstanceRoute, suspendInstanceRoute, resumeInstanceRoute, handoverPreviewRoute, handoverRoute, tokenSkipRoute, tokenReplayRoute, batchSkipStuckRoute, deleteInstanceRoute, batchApproveRoute, batchRejectRoute, approveRoute, selectableNextApproversRoute, rejectRoute, transferRoute, reassignRoute, recallRoute, consultRoute, replyConsultRoute, delegateRoute, addSignRoute, reduceSignRoute, returnRoute, urgeRoute, listTaskUrgesRoute, listInstanceUrgesRoute, urgeInstanceRoute, addInstanceCcRoute] as const);
// 静态路径 /compensation/list 必须在参数化 /compensation/{id} 之前注册（RegExpRouter 按注册顺序解析）
router.openapiRoutes([migratePreflightRoute, migrateRoute, migrationsRoute, migrateBatchRoute, compensationsRoute, compensationResolveRoute, compensationNoteRoute, compensationRetryRoute, compensationResumeRoute, compensationDetailRoute] as const);

export default router;
