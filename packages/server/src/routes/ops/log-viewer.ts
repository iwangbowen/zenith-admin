import { OpenAPIHono } from '@hono/zod-openapi';
import { stream } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import { logViewerContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  readLastLines, followLogLines, openLogForDownload, resolveAllowedLogPath, assertTailable, getLocalLogRoots, getRemoteLogRoots,
} from '../../services/ops/log-viewer.service';
import { TAIL_REPLAY_LINES } from '../../services/ops/log-reader';
import { assertRemoteHostAccess } from '../../lib/host-access';
import { streamLogTail } from '../../lib/http-stream';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:log:view' })] as const;

// SSE 实时跟踪：先回放末尾 100 行，再持续推送新增行（与 /api/log-files/{filename}/tail 同协议）
const tailRoute = defineContractRoute(logViewerContract.tail, {
  middleware: view,
  handler: async (c) => {
    const { path: filePath, hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    // 白名单 / 存在性校验放在开流之前，错误以 JSON 状态码返回而不是流式正文
    assertTailable(await resolveAllowedLogPath(filePath, hostId));
    return streamLogTail(c, {
      replay: () => readLastLines(filePath, TAIL_REPLAY_LINES, hostId),
      follow: (signal, emit) => followLogLines(filePath, hostId, signal, emit),
    });
  },
});

const downloadRoute = defineContractRoute(logViewerContract.download, {
  middleware: view,
  handler: async (c) => {
    const { path: filePath, hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    let file: Awaited<ReturnType<typeof openLogForDownload>>;
    try {
      file = await openLogForDownload(filePath, 100 * 1024 * 1024, hostId);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      throw new HTTPException(400, { message: (e as Error).message });
    }
    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    c.header('Content-Length', String(file.size));
    return stream(c, async (s) => {
      s.onAbort(() => { file.stream.destroy(); });
      try {
        for await (const chunk of file.stream) {
          await s.write(chunk as Uint8Array);
        }
      } catch { /* client disconnected */ } finally {
        file.stream.destroy();
      }
    });
  },
});

const contentRoute = defineContractRoute(logViewerContract.content, {
  middleware: view,
  handler: async (c) => {
    const { path: filePath, lines, keyword, context, hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    const result = await readLastLines(filePath, lines ?? 500, hostId, { keyword, context });
    return c.json(okBody({ lines: result }), 200);
  },
});

const rootsRoute = defineContractRoute(logViewerContract.roots, {
  middleware: view,
  handler: async (c) => {
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody({ roots: hostId == null ? getLocalLogRoots() : getRemoteLogRoots() }), 200);
  },
});

router.openapiRoutes([tailRoute, downloadRoute, contentRoute, rootsRoute] as const);

export default router;
