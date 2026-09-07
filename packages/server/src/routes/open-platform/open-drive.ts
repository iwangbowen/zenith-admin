/**
 * 企业网盘开放 API。
 *
 * 面向第三方应用的文件读取 / 上传通道：只暴露治理侧显式授权给应用的空间，空间内再按授权角色裁剪。
 * 鉴权链（签名 → 计量 → 限流）由 open-gateway 挂载，本模块只做 scope 校验与业务编排。
 *   - drive:read  空间列表 / 目录浏览 / 节点元数据 / 内容下载
 *   - drive:write 上传文件（授权角色需为 editor）
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { DRIVE_UPLOAD_CONFLICT_POLICIES, openDriveContract } from '@zenith/shared/drive';
import { defineContractRoute } from '../../lib/contract-route';
import { parseRangeHeader, rangeNotSatisfiable, supportsRange } from '../../lib/http-range';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { requireOpenScope } from '../../middleware/open-gateway';
import {
  getOpenDriveNode, listOpenDriveNodes, listOpenDriveSpaces, openOpenDriveContent, prepareOpenDriveContent, uploadOpenDriveFile,
} from '../../services/drive/drive-open.service';
import { binaryResponses, streamStoredContent } from '../drive/drive-nodes';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 各端点所需 scope；同时供端点目录展示 */
const OPEN_DRIVE_SCOPES = {
  spaces: 'drive:read',
  nodes: 'drive:read',
  node: 'drive:read',
  content: 'drive:read',
  upload: 'drive:write',
} as const satisfies Record<Exclude<keyof typeof openDriveContract, 'basePath'>, string>;

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '节点不存在或空间未授权' } } as const;

const spacesRoute = defineContractRoute(openDriveContract.spaces, {
  middleware: [requireOpenScope(OPEN_DRIVE_SCOPES.spaces)],
  handler: async (c) => c.json(okBody(await listOpenDriveSpaces(c.get('openPrincipal'))), 200),
});

const nodesRoute = defineContractRoute(openDriveContract.nodes, {
  middleware: [requireOpenScope(OPEN_DRIVE_SCOPES.nodes)],
  responses: notFound,
  handler: async (c) => c.json(okBody(await listOpenDriveNodes(c.get('openPrincipal'), c.req.valid('query'))), 200),
});

const nodeRoute = defineContractRoute(openDriveContract.node, {
  middleware: [requireOpenScope(OPEN_DRIVE_SCOPES.node)],
  responses: notFound,
  handler: async (c) => c.json(okBody(await getOpenDriveNode(c.get('openPrincipal'), c.req.valid('param').id)), 200),
});

const contentRoute = defineContractRoute(openDriveContract.content, {
  middleware: [requireOpenScope(OPEN_DRIVE_SCOPES.content)],
  responses: { ...binaryResponses, ...notFound },
  handler: async (c) => {
    const principal = c.get('openPrincipal');
    const prepared = await prepareOpenDriveContent(principal, c.req.valid('param').id);
    const range = supportsRange(prepared.file.provider) ? parseRangeHeader(c.req.header('range'), prepared.file.size) : null;
    if (range === 'invalid') return rangeNotSatisfiable(prepared.file.size, { 'Cache-Control': 'private, no-store' });
    const stored = await openOpenDriveContent(prepared, principal, range);
    return streamStoredContent({
      stream: stored.stream, contentType: stored.contentType, fileName: prepared.node.name, size: prepared.file.size,
      provider: prepared.file.provider, range, download: true, etag: `"o${prepared.file.id}-${prepared.file.size}"`,
    });
  },
});

const uploadRoute = defineContractRoute(openDriveContract.upload, {
  middleware: [requireOpenScope(OPEN_DRIVE_SCOPES.upload)],
  responses: { 409: { content: jsonContent(ErrorResponse), description: '同名文件已存在' }, ...notFound },
  handler: async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (typeof (file as File)?.arrayBuffer !== 'function') return c.json(errBody('请提供要上传的文件', 400), 400);
    const spaceId = Number(body.spaceId);
    if (!Number.isInteger(spaceId) || spaceId <= 0) return c.json(errBody('缺少 spaceId', 400), 400);
    const parentRaw = body.parentId ? Number(body.parentId) : null;
    const parentId = parentRaw && Number.isInteger(parentRaw) && parentRaw > 0 ? parentRaw : null;
    const policyRaw = typeof body.conflictPolicy === 'string' ? body.conflictPolicy : 'rename';
    const conflictPolicy = (DRIVE_UPLOAD_CONFLICT_POLICIES as readonly string[]).includes(policyRaw) ? policyRaw as typeof DRIVE_UPLOAD_CONFLICT_POLICIES[number] : 'rename';
    const node = await uploadOpenDriveFile(c.get('openPrincipal'), file as File, { spaceId, parentId, conflictPolicy });
    return c.json(okBody(node, '上传成功'), 200);
  },
});

router.openapiRoutes([spacesRoute, nodesRoute, nodeRoute, contentRoute, uploadRoute] as const);

export default router;

/** 网盘开放端点目录：由契约与 scope 表派生，供 API 调试台列出可调端点 */
export const OPEN_DRIVE_ENDPOINTS: Array<{ method: string; path: string; summary: string; scope: string | null }> =
  (Object.keys(OPEN_DRIVE_SCOPES) as Array<keyof typeof OPEN_DRIVE_SCOPES>).map((name) => {
    const operation = openDriveContract[name];
    return { method: operation.method.toUpperCase(), path: operation.fullPath, summary: operation.summary, scope: OPEN_DRIVE_SCOPES[name] };
  });
