/**
 * 数据脱敏工具单测（PII 保护，纯函数）。
 *
 * 覆盖：手机号/邮箱/身份证/姓名/银行卡/自定义规则六类脱敏 + applyMask 统一分发与空值透传。
 */
import { describe, it, expect } from 'vitest';
import {
  maskPhone,
  maskEmail,
  maskIdCard,
  maskName,
  maskBankCard,
  maskCustom,
  applyMask,
} from './masking';

describe('maskPhone', () => {
  it('11 位手机号：保留前 3 + 后 4', () => {
    expect(maskPhone('13812341234')).toBe('138****1234');
  });

  it('非标准格式（过短）原样返回', () => {
    expect(maskPhone('12345')).toBe('12345');
  });
});

describe('maskEmail', () => {
  it('保留本地名前 1/3（向上取整）+ 完整域名', () => {
    expect(maskEmail('admin@example.com')).toBe('ad***@example.com');
  });

  it('单字符本地名至少保留 1 位', () => {
    expect(maskEmail('a@b.com')).toBe('a@b.com');
  });

  it('无 @ 或 @ 开头原样返回', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
    expect(maskEmail('@example.com')).toBe('@example.com');
  });
});

describe('maskIdCard', () => {
  it('18 位身份证：保留前 6 + 后 4', () => {
    expect(maskIdCard('110101199001011234')).toBe('110101********1234');
  });

  it('长度 ≤ 10 原样返回', () => {
    expect(maskIdCard('1234567890')).toBe('1234567890');
  });
});

describe('maskName', () => {
  it('三字姓名：保留首尾', () => {
    expect(maskName('张三丰')).toBe('张*丰');
  });

  it('两字姓名：保留首字', () => {
    expect(maskName('张三')).toBe('张*');
  });

  it('单字原样返回', () => {
    expect(maskName('张')).toBe('张');
  });

  it('长姓名中间全部打码', () => {
    expect(maskName('欧阳锋大侠')).toBe('欧***侠');
  });
});

describe('maskBankCard', () => {
  it('仅保留后 4 位', () => {
    expect(maskBankCard('6222021234567890')).toBe('************7890');
  });

  it('长度 ≤ 4 原样返回', () => {
    expect(maskBankCard('1234')).toBe('1234');
  });
});

describe('maskCustom', () => {
  it('保留前 N + 后 M 位', () => {
    expect(maskCustom('ABCDEFGH', { prefixKeep: 2, suffixKeep: 2 })).toBe('AB****GH');
  });

  it('suffixKeep 为 0 时尾部全打码', () => {
    expect(maskCustom('ABCDEF', { prefixKeep: 2, suffixKeep: 0 })).toBe('AB****');
  });

  it('自定义掩码字符', () => {
    expect(maskCustom('ABCDEF', { prefixKeep: 1, suffixKeep: 1, maskChar: '#' })).toBe('A####F');
  });

  it('长度不足以脱敏时原样返回（防止全暴露/全隐藏歧义）', () => {
    expect(maskCustom('ABC', { prefixKeep: 2, suffixKeep: 2 })).toBe('ABC');
  });
});

describe('applyMask - 统一分发', () => {
  it('null / undefined / 空串透传', () => {
    expect(applyMask(null, 'phone')).toBeNull();
    expect(applyMask(undefined, 'phone')).toBeUndefined();
    expect(applyMask('', 'phone')).toBe('');
  });

  it('按类型分发到对应脱敏函数', () => {
    expect(applyMask('13812341234', 'phone')).toBe('138****1234');
    expect(applyMask('admin@example.com', 'email')).toBe('ad***@example.com');
    expect(applyMask('110101199001011234', 'id_card')).toBe('110101********1234');
    expect(applyMask('张三丰', 'name')).toBe('张*丰');
    expect(applyMask('6222021234567890', 'bank_card')).toBe('************7890');
  });

  it('custom 类型有规则时应用规则', () => {
    expect(applyMask('ABCDEFGH', 'custom', { prefixKeep: 2, suffixKeep: 2 })).toBe('AB****GH');
  });

  it('custom 类型缺失规则时原样返回', () => {
    expect(applyMask('ABCDEFGH', 'custom')).toBe('ABCDEFGH');
    expect(applyMask('ABCDEFGH', 'custom', null)).toBe('ABCDEFGH');
  });
});
