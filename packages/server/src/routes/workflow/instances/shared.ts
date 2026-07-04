// ─── 路由级公共参数 schema（拆分自 workflow-instances.ts 路由）───
import { z } from '@hono/zod-openapi';

export const taskIdParam = z.object({ taskId: z.coerce.number().openapi({ param: { name: 'taskId', in: 'path' }, example: 1 }) });
