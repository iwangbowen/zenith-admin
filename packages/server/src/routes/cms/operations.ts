import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsOperationsContract } from '@zenith/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCmsEditorialWorkspace } from '../../services/cms/cms-editorial-workspace.service';
import { getCmsAttribution } from '../../services/cms/cms-attribution.service';
import { getCmsFeedbackDetail, getCmsFormHandlingPolicy, handleCmsFeedback, listCmsFeedback, listCmsOperationsAssignees, listCmsHandlingWorkflows, saveCmsFormHandlingPolicy } from '../../services/cms/cms-feedback.service';
import { getCmsFeedbackWorkflowContext, previewCmsFeedbackWorkflow, submitCmsFeedbackWorkflow } from '../../services/cms/cms-feedback-workflow.service';
import { createCmsEditorialTask, getCmsEditorialTask, listCmsEditorialTasks, updateCmsEditorialTask } from '../../services/cms/cms-editorial-tasks.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([
  defineContractRoute(cmsOperationsContract.assignees, { handler: async (c) => c.json(okBody(await listCmsOperationsAssignees()), 200) }),
  defineContractRoute(cmsOperationsContract.handlingWorkflows, { handler: async (c) => c.json(okBody(await listCmsHandlingWorkflows()), 200) }),
  defineContractRoute(cmsOperationsContract.workspace, { handler: async (c) => c.json(okBody(await getCmsEditorialWorkspace(c.req.valid('query'))), 200) }),
  defineContractRoute(cmsOperationsContract.feedback, { handler: async (c) => c.json(okBody(await listCmsFeedback(c.req.valid('query'))), 200) }),
  defineContractRoute(cmsOperationsContract.feedbackDetail, { handler: async (c) => c.json(okBody(await getCmsFeedbackDetail(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsOperationsContract.handleFeedback, { handler: async (c) => c.json(okBody(await handleCmsFeedback(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsOperationsContract.handlingPolicy, { handler: async (c) => c.json(okBody(await getCmsFormHandlingPolicy(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsOperationsContract.saveHandlingPolicy, { handler: async (c) => c.json(okBody(await saveCmsFormHandlingPolicy(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsOperationsContract.workflowPreview, { handler: async (c) => c.json(okBody(await previewCmsFeedbackWorkflow(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsOperationsContract.workflowContext, { handler: async (c) => c.json(okBody(await getCmsFeedbackWorkflowContext(c.req.valid('param').id, c.req.valid('query').instanceId ?? undefined)), 200) }),
  defineContractRoute(cmsOperationsContract.submitWorkflow, { handler: async (c) => c.json(okBody(await submitCmsFeedbackWorkflow(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsOperationsContract.approvalDetail, { handler: async (c) => c.json(okBody(await getCmsFeedbackDetail(c.req.valid('param').id, { approvalInstanceId: c.req.valid('query').instanceId })), 200) }),
  defineContractRoute(cmsOperationsContract.tasks, { handler: async (c) => c.json(okBody(await listCmsEditorialTasks(c.req.valid('query'))), 200) }),
  defineContractRoute(cmsOperationsContract.taskDetail, { handler: async (c) => c.json(okBody(await getCmsEditorialTask(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsOperationsContract.createTask, { handler: async (c) => c.json(okBody(await createCmsEditorialTask(c.req.valid('json'))), 200) }),
  defineContractRoute(cmsOperationsContract.updateTask, { handler: async (c) => c.json(okBody(await updateCmsEditorialTask(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsOperationsContract.attribution, { handler: async (c) => c.json(okBody(await getCmsAttribution(c.req.valid('query'))), 200) }),
]);
export default router;
