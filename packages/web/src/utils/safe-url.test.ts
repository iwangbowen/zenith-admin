import { describe, expect, it } from 'vitest';
import { iframeSandboxFor, safeHttpUrl, safeLinkUrl } from './safe-url';

describe('safe-url', () => {
  it('safeLinkUrl keeps http(s) and in-site paths, drops dangerous schemes', () => {
    expect(safeLinkUrl('/api/files/1/content')).toBe('/api/files/1/content');
    expect(safeLinkUrl('  https://cdn.example.com/a.png ')).toBe('https://cdn.example.com/a.png');
    expect(safeLinkUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeLinkUrl('file://attacker/share/x.exe')).toBeUndefined();
    expect(safeLinkUrl('//evil.example/x')).toBeUndefined();
    expect(safeLinkUrl(null)).toBeUndefined();
  });

  it('safeHttpUrl rejects in-site paths too', () => {
    expect(safeHttpUrl('https://grafana.example.com/d/1')).toBe('https://grafana.example.com/d/1');
    expect(safeHttpUrl('/system/db-admin')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,x')).toBeUndefined();
  });

  it('iframeSandboxFor drops allow-same-origin for same-origin embeds only', () => {
    expect(iframeSandboxFor(`${window.location.origin}/login`)).toBe('allow-scripts allow-popups allow-forms');
    expect(iframeSandboxFor('/public/dashboards/1')).toBe('allow-scripts allow-popups allow-forms');
    expect(iframeSandboxFor('https://grafana.example.com/d/1')).toBe('allow-scripts allow-popups allow-forms allow-same-origin');
  });
});
