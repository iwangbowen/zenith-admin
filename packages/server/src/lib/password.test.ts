import { parseOptions } from '@node-rs/bcrypt';
import bcryptjs from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { hashPassword, PASSWORD_HASH_COST, verifyPassword } from './password';

describe('密码哈希统一入口（native/bcryptjs 互认）', () => {
  it('hashPassword 产出的 hash 可被 bcryptjs 校验（向后兼容存量校验路径）', async () => {
    const hash = await hashPassword('S3cret!密码');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(PASSWORD_HASH_COST).toBe(10);
    expect(parseOptions(hash).cost).toBe(10);
    expect(await bcryptjs.compare('S3cret!密码', hash)).toBe(true);
  });

  it.each([
    ['普通密码', 'zenith-preupgrade-fixture', '$2b$04$nSxdTYoYV2v3UrKrHzmmxutdn2Mb6peR.tJ32XnbCyXMupvW8X/RW'],
    ['超过 72 字节的 UTF-8 密码', '密码'.repeat(25), '$2b$04$ZtbndOW/CP.hE4VfdCcIk.KD5uTa4nk5CcjunqG2TXgBpbGmKXUVO'],
    ['含 NUL 的密码', 'embedded\u0000password', '$2b$04$FwfvQu.UtQFVTwrFuRtKYuDsIrmiFsFFNR8dbkMv6CUo2AJVMBnPO'],
  ])('@node-rs/bcrypt 1.10.8 生成的存量 hash 升级后继续有效：%s', async (_, plain, storedHash) => {
    // 固定于升级前生成的测试样本，避免新版本同时生成与校验掩盖兼容性回归。
    expect(await verifyPassword(plain, storedHash)).toBe(true);
    expect(await verifyPassword('wrong-pass', storedHash)).toBe(false);
  });

  it('bcryptjs 产出的存量 $2b$ hash 可被 verifyPassword 校验', async () => {
    const legacy = await bcryptjs.hash('legacy-pass', 4);
    expect(await verifyPassword('legacy-pass', legacy)).toBe(true);
    expect(await verifyPassword('wrong-pass', legacy)).toBe(false);
  });

  it('$2a$ 前缀的历史 hash 同样互认', async () => {
    // bcryptjs 支持显式生成 $2a$ 盐
    const salt = '$2a$04$C6UzMDM.H6dfI/f/IKcEe.';
    const legacy2a = await bcryptjs.hash('older-pass', salt);
    expect(legacy2a.startsWith('$2a$')).toBe(true);
    expect(await verifyPassword('older-pass', legacy2a)).toBe(true);
  });

  it('verifyPassword 对畸形 hash 返回 false 而不抛错', async () => {
    await expect(verifyPassword('x', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });
});
