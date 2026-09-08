/**
 * 汇总 import 所有 jobType handler，触发各自的 registerJobHandler 自注册。
 * 由 registerWorkflowJobWorker() 在 worker 启动时引入。
 */
import './delay-wake';
import './task-timeout';
import './trigger-dispatch';
import './external-dispatch';
import './subprocess-spawn';
import './subprocess-join';
import './event-dispatch';
import './webhook-delivery';
import './compensation-action';
