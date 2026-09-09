/**
 * 广告渲染凭证线格式黄金测试：`rp1.<base64url(JSON)>.<base64url(HMAC-SHA256(secret, "rp1." + data))>`。
 * 凭证随已渲染页面下发到浏览器，实现重构不得改变一个字节。
 */
import { createHmac } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { config } from '../../config';
import { signCmsAdRenderProof, verifyCmsAdRenderProof, type CmsAdRenderProofPayload } from './cms-ad-render-proof';

const payload: CmsAdRenderProofPayload = { version: 1, siteId: 3, siteCode: 'main-site', adIds: [9, 12], path: '/news/?from=home' };

function golden(p: CmsAdRenderProofPayload): string {
  const data = Buffer.from(JSON.stringify(p)).toString('base64url');
  const sig = createHmac('sha256', config.jwtSecret).update(`rp1.${data}`).digest('base64url');
  return `rp1.${data}.${sig}`;
}

function rejects(token: string) {
  expect(() => verifyCmsAdRenderProof(token)).toThrow(HTTPException);
  try {
    verifyCmsAdRenderProof(token);
  } catch (error) {
    expect((error as HTTPException).status).toBe(403);
    expect((error as HTTPException).message).toBe('广告渲染凭证无效');
  }
}

describe('CMS ad render proof wire format', () => {
  it('签发结果与原始公式逐字节一致并可还原', () => {
    const token = signCmsAdRenderProof(payload);
    expect(token).toBe(golden(payload));
    expect(token.split('.')).toHaveLength(3);
    expect(verifyCmsAdRenderProof(token)).toEqual(payload);
  });

  it('版本 / 签名 / 段数不符一律 403', () => {
    const [, data, sig] = golden(payload).split('.');
    rejects(`v1.${data}.${sig}`);
    rejects(`rp1.${data}.${sig.slice(0, -1)}A`);
    rejects(`rp1.${data}x.${sig}`);
    rejects(`rp1.${data}.${sig}.extra`);
    rejects(`rp1.${data}`);
    rejects(`rp1..${sig}`);
    rejects('');
  });

  it('载荷不合法一律 403', () => {
    rejects(golden({ ...payload, version: 2 as never }));
    rejects(golden({ ...payload, siteCode: 'Main Site' }));
    rejects(golden({ ...payload, adIds: [] }));
    rejects(golden({ ...payload, adIds: [0] }));
    rejects(golden({ ...payload, path: 'news' }));
    rejects(golden({ ...payload, path: '//evil' }));
    rejects(golden({ ...payload, path: `/${'a'.repeat(500)}` }));
  });
});
