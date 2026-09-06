import { describe, expect, it } from 'vitest';
import { readFormOrJsonBody } from './body';

describe('readFormOrJsonBody', () => {
  it('reads form-urlencoded bodies', async () => {
    const request = new Request('https://example.test/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&client_id=demo',
    });
    await expect(readFormOrJsonBody(request)).resolves.toEqual({ grant_type: 'client_credentials', client_id: 'demo' });
  });

  it('reads JSON bodies otherwise', async () => {
    const request = new Request('https://example.test/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'abc' }),
    });
    await expect(readFormOrJsonBody(request)).resolves.toEqual({ token: 'abc' });
  });
});
