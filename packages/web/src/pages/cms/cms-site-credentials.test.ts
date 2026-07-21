import { CMS_SECRET_MASK } from '@zenith/shared';
import { describe, expect, it } from 'vitest';
import { cmsCredentialWriteValue } from './cms-site-credentials';

describe('CMS site credential form semantics', () => {
  it('sends null only for an explicit clear action', () => {
    expect(cmsCredentialWriteValue('new-secret', true)).toBeNull();
  });

  it('keeps blank and masked values for the server preserve semantics', () => {
    expect(cmsCredentialWriteValue('', false)).toBe('');
    expect(cmsCredentialWriteValue(CMS_SECRET_MASK, false)).toBe(CMS_SECRET_MASK);
  });
});
