import { MP_MATERIAL_TYPES, mpMaterialContract, type MpMaterial, type MpMaterialType } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockMpMaterials, getNextMpMaterialId } from '@/mocks/data/mp-materials';
import { mockDateTime } from '@/mocks/utils/date';

export const mpMaterialsHandlers = [
  mock(mpMaterialContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpMaterials.filter((m) => {
      if (m.accountId !== query.accountId) return false;
      if (query.type && m.type !== query.type) return false;
      if (query.keyword && !m.name.includes(query.keyword)) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(mpMaterialContract.sync, ({ body, ok }) => {
    const total = mockMpMaterials.filter((m) => m.accountId === body.accountId).length;
    return ok({ success: true, created: 0, updated: total, total }, '同步完成');
  }),

  // 上传：body 为原始 FormData，字段以字符串提交，与服务端同样先做基本校验再登记本地素材
  mock(mpMaterialContract.upload, ({ body, ok }) => {
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('请选择要上传的文件', { status: 400 });
    const accountId = Number(body.get('accountId'));
    if (!Number.isInteger(accountId) || accountId <= 0) return badRequest('公众号参数无效', { status: 400 });
    const type = String(body.get('type') ?? '');
    if (!(MP_MATERIAL_TYPES as readonly string[]).includes(type)) return badRequest('素材类型无效', { status: 400 });
    const name = String(body.get('name') ?? '') || file.name;
    const now = mockDateTime();
    const item: MpMaterial = {
      id: getNextMpMaterialId(), accountId, type: type as MpMaterialType, name,
      wechatMediaId: `mock_media_${Date.now()}`, url: null, fileSize: file.size, createdAt: now, updatedAt: now,
    };
    mockMpMaterials.push(item);
    return ok(item, '上传成功');
  }),

  mock(mpMaterialContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const item: MpMaterial = {
      id: getNextMpMaterialId(), accountId: body.accountId, type: body.type, name: body.name,
      wechatMediaId: null, url: body.url ?? null, fileSize: body.fileSize ?? null, createdAt: now, updatedAt: now,
    };
    mockMpMaterials.push(item);
    return ok(item, '创建成功');
  }),

  mock(mpMaterialContract.update, ({ params, body, ok }) => {
    const m = mockMpMaterials.find((x) => x.id === params.id);
    if (!m) return notFound('素材不存在', { status: 404 });
    m.name = body.name;
    m.updatedAt = mockDateTime();
    return ok(m, '更新成功');
  }),

  mock(mpMaterialContract.remove, ({ params, ok }) => {
    const idx = mockMpMaterials.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('素材不存在', { status: 404 });
    mockMpMaterials.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
