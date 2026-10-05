import { executeWorkflowAutomationAction, settleWorkflowAutomationAction } from '../../../services/workflow/workflow-automation-runtime';
import { registerJobHandler, registerJobSettlementHandler } from '../registry';

registerJobHandler('automation_action', executeWorkflowAutomationAction);
registerJobSettlementHandler('automation_action', settleWorkflowAutomationAction);
