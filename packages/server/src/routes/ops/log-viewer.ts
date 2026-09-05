import { OpenAPIHono } from '@hono/zod-openapi';
import { stream } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import { logViewerContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { readLastLines, spawnTailFollow, openLogForDownload, resolveAllowedLogPath, getLocalLogRoots, getRemoteLogRoots } from '../../services/ops/log-viewer.service';
import { assertRemoteHostAccess } from '../../lib/host-access';
import { streamProcessOutput } from '../../lib/http-stream';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:log:view' })] as const;

// tail -f 逐行流式输出
const streamRoute = defineContractRoute(logViewerContract.stream, {
  middleware: view,
  handler: async (c) => {
    const { path: filePath, hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    // 白名单 / 存在性校验放在开流之前，错误以 JSON 状态码返回而不是流式正文
    await resolveAllowedLogPath(filePath, hostId);
    return streamProcessOutput(c, (onData, onExit) => spawnTailFollow(filePath, onData, onExit, hostId));
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
    const { path: filePath, lines, hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    const lineCount = Math.min(Number.parseInt(lines ?? '500', 10) || 500, 5000);
    const content = await readLastLines(filePath, lineCount, hostId);
    return c.json(okBody({ content }), 200);
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

router.openapiRoutes([streamRoute, downloadRoute, contentRoute, rootsRoute] as const);

export default router;
