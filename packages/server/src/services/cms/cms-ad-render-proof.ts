import { HTTPException } from 'hono/http-exception';
import { createSignedTokenCodec } from '../../lib/signed-token';

const PROOF_VERSION = 'rp1';

export interface CmsAdRenderProofPayload {
  version: 1;
  siteId: number;
  siteCode: string;
  adIds: number[];
  path: string;
}

const codec = createSignedTokenCodec<CmsAdRenderProofPayload>({ version: PROOF_VERSION });

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
  return codec.encode(payload);
}

export function verifyCmsAdRenderProof(token: string): CmsAdRenderProofPayload {
  const payload = codec.decode(token);
  if (!payload) throw new HTTPException(403, { message: '广告渲染凭证无效' });
  try {
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
