import { describe, expect, it } from 'vitest';
import { sanitizeCmsHtml } from './cms-html-sanitizer';

describe('CMS untrusted HTML sanitizer', () => {
  it('removes executable tags, event handlers and dangerous URL schemes', () => {
    const dirty = [
      '<script>alert(1)</script>',
      '<style>body{display:none}</style>',
      '<iframe src="https://evil.example"></iframe>',
      '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
      '<img src="data:text/html;base64,PHNjcmlwdD4=" onerror="alert(1)">',
      '<a href="javascript:alert(1)" onclick="alert(2)">click</a>',
      '<p style="background:url(javascript:alert(3))">safe text</p>',
    ].join('');
    const clean = sanitizeCmsHtml(dirty);

    expect(clean).not.toMatch(/script|style=|iframe|svg|onerror|onclick|javascript:|data:/i);
    expect(clean).toContain('<p>safe text</p>');
  });

  it('keeps common rich-text markup and safe links', () => {
    const clean = sanitizeCmsHtml(
      '<h2>Title</h2><p><strong>Body</strong> <a href="https://example.com" target="_blank">link</a></p>',
    );
    expect(clean).toContain('<h2>Title</h2>');
    expect(clean).toContain('<strong>Body</strong>');
    expect(clean).toContain('rel="noopener noreferrer"');
  });
});
