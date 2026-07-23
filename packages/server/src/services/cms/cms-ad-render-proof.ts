import { createHmac, timingSafeEqual } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { config } from '../../config';

const PROOF_VERSION = 'rp1';

export interface CmsAdRenderProofPayload {
  version: 1;
  siteId: number;
  siteCode: string;
  adIds: number[];
  path: string;
}

function signature(encoded: string): string {
  return createHmac('sha256', config.jwtSecret)
    .update(`${PROOF_VERSION}.${encoded}`)
    .digest('base64url');
}

export function resolveCmsRenderedPagePath(input: {
  baseUrl: string;
  canonical: string | null;
}): string {
  let canonicalPath = '/';
  if (input.canonical) {
    try {
      const parsed = new URL(input.canonical, 'https://cms.invalid');
      canonicalPath = `${parsed.pathname}${parsed.search}`;
    } catch {
      canonicalPath = '/';
    }
  }
  const base = input.baseUrl.replace(/\/+$/, '');
  return `${base}${canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`}` || '/';
}

export function signCmsAdRenderProof(payload: CmsAdRenderProofPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${PROOF_VERSION}.${encoded}.${signature(encoded)}`;
}

export function verifyCmsAdRenderProof(token: string): CmsAdRenderProofPayload {
  const [version, encoded, actualSignature, ...extra] = token.split('.');
  if (version !== PROOF_VERSION || !encoded || !actualSignature || extra.length > 0) {
    throw new HTTPException(403, { message: '广告渲染凭证无效' });
  }
  const expected = Buffer.from(signature(encoded));
  const actual = Buffer.from(actualSignature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HTTPException(403, { message: '广告渲染凭证无效' });
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CmsAdRenderProofPayload;
    if (
      payload.version !== 1
      || !Number.isInteger(payload.siteId)
      || !/^[a-z0-9-]+$/.test(payload.siteCode)
      || !Array.isArray(payload.adIds)
      || payload.adIds.length === 0
      || payload.adIds.some((id) => !Number.isInteger(id) || id <= 0)
      || !payload.path.startsWith('/')
      || payload.path.startsWith('//')
      || payload.path.length > 500
    ) {
      throw new Error('invalid proof');
    }
    return payload;
  } catch {
    throw new HTTPException(403, { message: '广告渲染凭证无效' });
  }
}
