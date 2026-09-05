/**
 * IoT 批量操作：提交批量指令 / 批量期望属性任务。
 *
 * 目标集在提交时展开（deviceIds ∪ groupId 成员），任务中心负责进度/重试/取消；
 * 设备名快照随 payload 传递供行级明细展示。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotBatchContract, IOT_BATCH_DEVICE_MAX } from '@zenith/shared/iot';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { resolveIotBatchTargets } from '../../services/iot/iot-groups.service';

const iotBatchRouter = new OpenAPIHono({ defaultHook: validationHook });

const batchCommandRoute = defineContractRoute(iotBatchContract.commands, {
  middleware: [authMiddleware, guard({
    permission: 'iot:device:batch',
    audit: { description: '批量下发 IoT 指令', module: 'IoT 设备' },
  })],
  handler: async (c) => {
    const input = c.req.valid('json');
    const targets = await resolveIotBatchTargets(input.deviceIds, input.groupId, IOT_BATCH_DEVICE_MAX);
    const row = await submitAsyncTask({
      taskType: 'iot-batch-command',
      title: `批量下发指令 ${input.service}（${targets.deviceIds.length} 台）`,
      payload: {
        deviceIds: targets.deviceIds,
        deviceNames: targets.deviceNames,
        service: input.service,
        params: input.params ?? null,
        ttlSeconds: input.ttlSeconds,
      },
    });
    return c.json(okBody(mapAsyncTask(row), '批量任务已提交，可在任务中心查看进度'), 200);
  },
});

const batchDesiredRoute = defineContractRoute(iotBatchContract.desired, {
  middleware: [authMiddleware, guard({
    permission: 'iot:device:batch',
    audit: { description: '批量设置 IoT 期望属性', module: 'IoT 设备' },
  })],
  handler: async (c) => {
    const input = c.req.valid('json');
    const targets = await resolveIotBatchTargets(input.deviceIds, input.groupId, IOT_BATCH_DEVICE_MAX);
    const row = await submitAsyncTask({
      taskType: 'iot-batch-desired',
      title: `批量设置期望属性（${targets.deviceIds.length} 台）`,
      payload: {
        deviceIds: targets.deviceIds,
        deviceNames: targets.deviceNames,
        desired: input.desired,
      },
    });
    return c.json(okBody(mapAsyncTask(row), '批量任务已提交，可在任务中心查看进度'), 200);
  },
});

iotBatchRouter.openapiRoutes([batchCommandRoute, batchDesiredRoute] as const);

export default iotBatchRouter;
