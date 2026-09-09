import { describe, expect, it } from 'vitest';
import { attachmentDisposition, contentDisposition, inlineOrAttachmentDisposition, SAFE_INLINE_MIME_TYPES } from './content-disposition';

describe('contentDisposition', () => {
  it('ASCII 文件名：回退名与扩展名一致，同时给出 RFC 5987 形态', () => {
    expect(attachmentDisposition('report.xlsx')).toBe(`attachment; filename="report.xlsx"; filename*=UTF-8''report.xlsx`);
  });

  it('中文文件名：回退名替换为下划线保留扩展名，filename* 为 UTF-8 百分号编码', () => {
    expect(attachmentDisposition('月报.xlsx')).toBe(`attachment; filename="__.xlsx"; filename*=UTF-8''%E6%9C%88%E6%8A%A5.xlsx`);
  });

  it('引号 / 反斜杠 / 分号不会破坏头部语法；RFC 5987 额外编码 !\'()*', () => {
    const header = attachmentDisposition(`a"b;c\\d (1)'*!.txt`);
    expect(header.startsWith('attachment; filename="a_b_c_d (1)\'*!.txt"; ')).toBe(true);
    expect(header).toContain(`filename*=UTF-8''a%22b%3Bc%5Cd%20%281%29%27%2A%21.txt`);
  });

  it('全非 ASCII 且无扩展名时回退为 download', () => {
    expect(contentDisposition('inline', '报表')).toBe(`inline; filename="download"; filename*=UTF-8''%E6%8A%A5%E8%A1%A8`);
  });
});

describe('inlineOrAttachmentDisposition', () => {
  it('白名单 MIME 内联，主类型比较忽略参数与大小写', () => {
    expect(inlineOrAttachmentDisposition('Image/PNG; charset=binary', 'a.png')).toMatch(/^inline; /);
    expect(inlineOrAttachmentDisposition('application/pdf', 'a.pdf')).toMatch(/^inline; /);
  });

  it('可能内嵌脚本的类型强制附件；forceAttachment 覆盖白名单', () => {
    expect(inlineOrAttachmentDisposition('image/svg+xml', 'a.svg')).toMatch(/^attachment; /);
    expect(inlineOrAttachmentDisposition('text/html', 'a.html')).toMatch(/^attachment; /);
    expect(inlineOrAttachmentDisposition('image/png', 'a.png', true)).toMatch(/^attachment; /);
  });

  it('白名单不含脚本载体类型', () => {
    for (const mime of ['image/svg+xml', 'text/html', 'application/xml', 'text/javascript', 'application/javascript']) {
      expect(SAFE_INLINE_MIME_TYPES.has(mime)).toBe(false);
    }
  });
});
