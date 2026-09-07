import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { drivePublicShareContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { parseRangeHeader, rangeNotSatisfiable, supportsRange } from '../../lib/http-range';
import {
  createDriveShareSession,
  getDrivePublicShareMeta,
  listDrivePublicChildren,
  prepareDrivePublicContent,
  openDrivePublicContent,
  saveFromDriveShare,
} from '../../services/drive/drive-share.service';
import { binaryResponses, streamStoredContent } from './drive-nodes';

/**
 * 外链匿名访问：契约上为 public，不挂认证中间件；
 * 防密码枚举由路径绑定限流规则 drive_public_share 按 IP 限速。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });

/** 会话可经 header `session` 或查询串 `session`（<a download> 无法带自定义头） */
function readSession(headerValue: string | undefined, queryValue: string | undefined): string {
  const session = headerValue ?? queryValue;
  if (!session) throw new HTTPException(401, { message: '缺少外链访问会话' });
  return session;
}

const accessRoute = defineContractRoute(drivePublicShareContract.access, {
  middleware: [],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await createDriveShareSession(token, body.password)), 200, { 'Cache-Control': 'private, no-store' });
  },
});

const metaRoute = defineContractRoute(drivePublicShareContract.meta, {
  middleware: [],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const session = c.req.header('session') ?? c.req.query('session');
    return c.json(okBody(await getDrivePublicShareMeta(token, session)), 200, { 'Cache-Control': 'private, no-store' });
  },
});

const childrenRoute = defineContractRoute(drivePublicShareContract.children, {
  middleware: [],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const { parentId, session: querySession } = c.req.valid('query');
    const session = readSession(c.req.header('session'), querySession);
    return c.json(okBody(await listDrivePublicChildren(token, session, parentId)), 200, { 'Cache-Control': 'private, no-store' });
  },
});

const contentRoute = defineContractRoute(drivePublicShareContract.content, {
  middleware: [],
  responses: binaryResponses,
  handler: async (c) => {
    const { token, nodeId } = c.req.valid('param');
    const { download, session: querySession } = c.req.valid('query');
    const session = readSession(c.req.header('session'), querySession);
    const prepared = await prepareDrivePublicContent(token, session, nodeId, !!download);
    const range = supportsRange(prepared.file.provider) ? parseRangeHeader(c.req.header('range'), prepared.file.size) : null;
    if (range === 'invalid') {
      return rangeNotSatisfiable(prepared.file.size, { 'Cache-Control': 'private, no-store' });
    }
    const first = await openDrivePublicContent(prepared, range);
    return streamStoredContent({
      stream: first.stored.stream, contentType: first.stored.contentType, fileName: first.node.name, size: first.file.size,
      provider: first.file.provider, range, download: !!download, etag: `"s${first.file.id}-${first.file.size}"`,
    });
  },
});

const saveRoute = defineContractRoute(drivePublicShareContract.save, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:upload', audit: { description: '外链转存到网盘', module: '企业网盘' } })],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const session = readSession(c.req.header('session'), c.req.query('session'));
    const copied = await saveFromDriveShare(token, session, c.req.valid('json'));
    return c.json(okBody(null, `已转存 ${copied} 个节点`), 200);
  },
});

router.openapiRoutes([accessRoute, metaRoute, childrenRoute, contentRoute, saveRoute] as const);

export default router;
