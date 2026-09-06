/**
 * 敏感字段契约与脱敏原语单测：
 * 原语 fail-closed、契约声明 → 静态发现（嵌套 / 数组 / 分页 / 包装类型）、载荷打码与回写检测。
 */
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { paginated } from './api-schemas';
import {
  applyMask,
  collectSensitiveFields,
  looksMasked,
  maskAddress,
  maskAtPath,
  maskBankCard,
  maskCustom,
  maskEmail,
  maskIdCard,
  maskName,
  maskPhone,
  previewMask,
  REDACTED_TEXT,
  sensitive,
  sensitiveKeyOf,
  sensitiveKindOf,
  valuesAtPath,
} from './sensitive';

describe('脱敏原语', () => {
  it('手机号：标准 11 位与带国家码', () => {
    expect(maskPhone('13812341234')).toBe('138****1234');
    expect(maskPhone('+8613812341234')).toBe('+86138****1234');
  });

  it('手机号：非标准格式不放行明文（fail-closed）', () => {
    expect(maskPhone('12345')).toBe('***45');
    expect(maskPhone('010-12345678')).toBe('********5678');
  });

  it('邮箱：保留本地名前 1/3 与域名，本地名短时至少保留 1 位并至少打 3 个码', () => {
    expect(maskEmail('admin@example.com')).toBe('ad***@example.com');
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
    expect(maskEmail('verylongname@example.com')).toBe('ver*********@example.com');
  });

  it('邮箱：无 @ 不放行明文', () => {
    expect(maskEmail('not-an-email')).toBe('**********il');
  });

  it('身份证：15 / 18 位保留前 6 后 4，其余尾部保留', () => {
    expect(maskIdCard('110101199001011234')).toBe('110101********1234');
    expect(maskIdCard('11010119900101123X')).toBe('110101********123X');
    expect(maskIdCard('1234567890')).toBe('******7890');
  });

  it('姓名：按字数保留首尾，单字全遮蔽', () => {
    expect(maskName('张三丰')).toBe('张*丰');
    expect(maskName('张三')).toBe('张*');
    expect(maskName('张')).toBe('*');
    expect(maskName('欧阳锋大侠')).toBe('欧***侠');
  });

  it('银行卡 / 地址', () => {
    expect(maskBankCard('6222021234567890')).toBe('************7890');
    expect(maskBankCard('1234')).toBe('**34');
    expect(maskAddress('北京市朝阳区建国路 88 号')).toBe('北京市朝阳区****');
    expect(maskAddress('北京')).toBe('*京');
  });

  it('自定义规则：保留位数不足时全部遮蔽；掩码字符可配置；emoji 按码点处理', () => {
    expect(maskCustom('ABCDEFGH', { prefixKeep: 2, suffixKeep: 2 })).toBe('AB****GH');
    expect(maskCustom('ABCDEF', { prefixKeep: 2, suffixKeep: 0 })).toBe('AB****');
    expect(maskCustom('ABCDEF', { prefixKeep: 1, suffixKeep: 1, maskChar: '#' })).toBe('A####F');
    expect(maskCustom('ABC', { prefixKeep: 2, suffixKeep: 2 })).toBe('***');
    expect(maskCustom('😀😃😄😁', { prefixKeep: 1, suffixKeep: 1 })).toBe('😀**😁');
  });

  it('applyMask：非字符串 / 空串透传，redact 固定输出，custom 缺规则用兜底规则', () => {
    expect(applyMask(null, 'phone')).toBeNull();
    expect(applyMask(undefined, 'phone')).toBeUndefined();
    expect(applyMask('', 'phone')).toBe('');
    expect(applyMask(123, 'phone')).toBe(123);
    expect(applyMask('whatever', 'redact')).toBe(REDACTED_TEXT);
    expect(applyMask('ABCDEFGH', 'custom')).toBe('A******H');
  });

  it('looksMasked：识别脱敏输出，拒绝把掩码值回写', () => {
    expect(looksMasked('138****1234', 'phone')).toBe(true);
    expect(looksMasked('13812341234', 'phone')).toBe(false);
    expect(looksMasked('ad***@example.com', 'email')).toBe(true);
    expect(looksMasked(REDACTED_TEXT, 'redact')).toBe(true);
    expect(looksMasked('A##F', 'custom', { prefixKeep: 1, suffixKeep: 1, maskChar: '#' })).toBe(true);
    expect(looksMasked('C#', 'custom', { prefixKeep: 1, suffixKeep: 1, maskChar: '#' })).toBe(false);
    expect(looksMasked(42, 'phone')).toBe(false);
  });

  it('previewMask 由真实实现计算', () => {
    expect(previewMask('phone')).toBe('138****1234');
    expect(previewMask('custom', { prefixKeep: 2, suffixKeep: 1, maskChar: '#' })).toBe('AB#####H');
  });
});

describe('契约声明与静态发现', () => {
  const contactSchema = z.object({
    email: sensitive(z.string().nullable(), 'email'),
  }).meta({ id: 'Contact' });

  const userSchema = z.object({
    id: z.int(),
    nickname: z.string(),
    phone: sensitive(z.string(), 'phone', '手机号码').nullable().optional(),
    email: sensitive(z.string().nullable(), 'email'),
    owner: z.object({ contactPhone: sensitive(z.string(), 'phone') }).nullable(),
    contacts: z.array(contactSchema),
  }).meta({ id: 'ProbeUser' });

  it('sensitive() 写入元数据并保留原 schema 类型', () => {
    expect(sensitiveKindOf(sensitive(z.string(), 'phone'))).toBe('phone');
    expect(sensitiveKindOf(z.string())).toBeUndefined();
    expect(sensitive(z.string(), 'phone').parse('x')).toBe('x');
  });

  it('收集实体下的字段、嵌套匿名对象与嵌套实体，路径含数组段', () => {
    const refs = collectSensitiveFields(paginated(userSchema));
    expect(refs.map((r) => ({ key: sensitiveKeyOf(r), path: r.path.join('/'), kind: r.kind, label: r.label }))).toEqual([
      { key: 'ProbeUser.phone', path: 'list/[]/phone', kind: 'phone', label: '手机号码' },
      { key: 'ProbeUser.email', path: 'list/[]/email', kind: 'email', label: '邮箱' },
      { key: 'ProbeUser.owner.contactPhone', path: 'list/[]/owner/contactPhone', kind: 'phone', label: '手机号' },
      { key: 'Contact.email', path: 'list/[]/contacts/[]/email', kind: 'email', label: '邮箱' },
    ]);
  });

  it('extend / pick 派生的实体继承字段声明，实体名取派生对象自己的 meta.id', () => {
    const profile = userSchema.pick({ id: true, email: true }).meta({ id: 'ProbeProfile' });
    expect(collectSensitiveFields(profile).map(sensitiveKeyOf)).toEqual(['ProbeProfile.email']);
  });

  it('敏感字段所在对象缺少 meta.id 时抛错', () => {
    expect(() => collectSensitiveFields(z.object({ phone: sensitive(z.string(), 'phone') }))).toThrow(/meta\.id/);
  });

  it('无敏感字段的 schema 返回空数组', () => {
    expect(collectSensitiveFields(z.object({ id: z.int() }))).toEqual([]);
    expect(collectSensitiveFields(z.null())).toEqual([]);
  });
});

describe('载荷打码', () => {
  it('沿路径写时复制打码，数组元素逐个处理，缺失节点跳过，原对象不被修改', () => {
    const payload = {
      list: [
        { phone: '13812341234', contacts: [{ email: 'admin@example.com' }, { email: null }] },
        { phone: null, contacts: [] },
      ],
      total: 2,
    };
    const snapshot = structuredClone(payload);
    let masked = maskAtPath(payload, ['list', '[]', 'phone'], { maskType: 'phone' });
    masked = maskAtPath(masked, ['list', '[]', 'contacts', '[]', 'email'], { maskType: 'email' });
    const untouched = maskAtPath(masked, ['list', '[]', 'missing', 'x'], { maskType: 'phone' });
    expect(untouched).toBe(masked);
    expect(masked).toEqual({
      list: [
        { phone: '138****1234', contacts: [{ email: 'ad***@example.com' }, { email: null }] },
        { phone: null, contacts: [] },
      ],
      total: 2,
    });
    expect(payload).toEqual(snapshot);
    expect(masked.list[1].contacts).toBe(payload.list[1].contacts);
  });

  it('valuesAtPath 展开数组读取全部值', () => {
    expect(valuesAtPath({ list: [{ phone: 'a' }, { phone: 'b' }] }, ['list', '[]', 'phone'])).toEqual(['a', 'b']);
    expect(valuesAtPath({ phone: 'x' }, ['phone'])).toEqual(['x']);
    expect(valuesAtPath(null, ['phone'])).toEqual([]);
  });
});
