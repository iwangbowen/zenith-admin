/**
 * License 签发 CLI（离线运行，不依赖数据库）。
 *
 * 用法：
 *   # 生成生产密钥对（私钥自行保管，公钥配到部署环境 LICENSE_ISSUER_PUBLIC_KEY）
 *   npx tsx scripts/license-issue.ts --gen-keys
 *
 *   # 用内置测试私钥签发（仅供开发/评估；生产必须用 --private-key）
 *   npx tsx scripts/license-issue.ts \
 *     --installation-id <系统设置→License 授权页显示的安装 ID> \
 *     --customer "ACME 公司" --edition pro \
 *     --features workflow,report,cms --days 365 \
 *     --max-users 100 --out acme.zenlic
 *
 *   # 用自有私钥签发
 *   npx tsx scripts/license-issue.ts --private-key <base64 PKCS8> --key-id prod-2026 ...
 *
 * ⚠️ 内置测试密钥对是公开的：任何人都能签发通过默认公钥验证的 License。
 *    它的用途是让模板开箱可测，不是保护手段。商用部署必须 --gen-keys 自建密钥。
 */
import { createPrivateKey, randomUUID, sign as edSign, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as z from 'zod';
import {
  createLicensePayload,
  LICENSE_ALGORITHM,
  LICENSE_ENVELOPE_VERSION,
  LICENSE_FEATURES,
  LICENSE_EDITIONS,
  LICENSE_EDITION_PRESETS,
  licenseEnvelopeSchema,
  type LicenseEdition,
  type LicenseIssuanceInput,
  type LicensePayload,
} from '@zenith/shared/licensing';

/** 与 src/lib/licensing/keys.ts 中 TEST_PUBLIC_KEY_BASE64 配对的测试私钥（公开，勿用于生产） */
const TEST_KEY_ID = 'test-2026';
const TEST_PRIVATE_KEY_BASE64 = 'MC4CAQAwBQYDK2VwBCIEIGyZp5WDE++d2SWo6Ns/202nKFvDAhjDQiRAzHItJW0L';

function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i++;
    }
  }
  return args;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

function stringArg(name: string, fallback?: string): string | undefined {
  const value = args.get(name);
  if (value === true) fail(`--${name} 缺少参数值`);
  return value ?? fallback;
}

function numberArg(name: string): number | undefined {
  const value = stringArg(name);
  return value === undefined ? undefined : Number(value);
}

if (args.get('gen-keys')) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  console.log('已生成 Ed25519 密钥对（base64 DER）：\n');
  console.log('公钥（SPKI，配到部署环境 LICENSE_ISSUER_PUBLIC_KEY）：');
  console.log(publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
  console.log('\n私钥（PKCS8，签发方离线保管，绝不进入部署环境/仓库）：');
  console.log(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
  process.exit(0);
}

const installationId = stringArg('installation-id');
if (typeof installationId !== 'string') {
  fail('缺少 --installation-id（在管理后台「系统设置 → License 授权」页复制）；或使用 --gen-keys 生成密钥对');
}

const edition = stringArg('edition', 'pro')!;
if (!(LICENSE_EDITIONS as readonly string[]).includes(edition)) {
  fail(`--edition 必须是 ${LICENSE_EDITIONS.join(' / ')}`);
}

let features: string[];
const featuresArg = stringArg('features');
if (typeof featuresArg === 'string' && featuresArg !== 'preset') {
  const requested = featuresArg.split(',').map((f) => f.trim()).filter(Boolean);
  const invalid = requested.filter((f) => !(LICENSE_FEATURES as readonly string[]).includes(f));
  if (invalid.length > 0) fail(`无效的功能标识：${invalid.join(', ')}（可用：${LICENSE_FEATURES.join(', ')}）`);
  features = requested;
} else {
  features = [...LICENSE_EDITION_PRESETS[edition as LicenseEdition]];
}

const issuanceInput = {
  licenseId: stringArg('license-id'),
  installationId,
  customerId: stringArg('customer-id'),
  customerName: stringArg('customer', '评估客户')!,
  edition: edition as LicenseEdition,
  features: features as LicenseIssuanceInput['features'],
  limits: {
    maxUsers: numberArg('max-users') ?? null,
    maxTenants: numberArg('max-tenants') ?? null,
    maxNodes: numberArg('max-nodes') ?? null,
  },
  validDays: numberArg('days'),
  graceDays: numberArg('grace-days'),
  notBefore: stringArg('not-before'),
  maintenanceUntil: stringArg('maintenance-until') ?? null,
};

let payload: LicensePayload;
try {
  payload = createLicensePayload(issuanceInput, {
    now: new Date(),
    licenseId: `lic_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    customerId: `cus_${randomUUID().slice(0, 8)}`,
  });
} catch (error) {
  if (error instanceof z.ZodError) {
    fail(`签发参数无效：${error.issues.map((issue) => `${issue.path.join('.') || '参数'}：${issue.message}`).join('；')}`);
  }
  fail('无法构造 License 载荷，请检查签发参数');
}

const privateKeyBase64 = stringArg('private-key', TEST_PRIVATE_KEY_BASE64)!;
const keyId = stringArg('key-id', TEST_KEY_ID)!;
if (!licenseEnvelopeSchema.shape.keyId.safeParse(keyId).success) fail('--key-id 必须为 1–64 个字符');
if (privateKeyBase64 === TEST_PRIVATE_KEY_BASE64) {
  console.warn('⚠ 正在使用内置测试私钥签发（keyId=test-2026），仅供开发/评估。\n');
}

const privateKey = (() => {
  try {
    const key = createPrivateKey({ key: Buffer.from(privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') fail('私钥必须使用 Ed25519 算法');
    return key;
  } catch {
    fail('私钥格式无效，请提供 Ed25519 私钥的 base64 DER PKCS8 内容');
  }
})();
const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
const signature = edSign(null, payloadBytes, privateKey);

const envelope = {
  version: LICENSE_ENVELOPE_VERSION,
  algorithm: LICENSE_ALGORITHM,
  keyId,
  payload: payloadBytes.toString('base64url'),
  signature: signature.toString('base64url'),
};

const output = JSON.stringify(envelope, null, 2);
const outFile = stringArg('out');
if (typeof outFile === 'string') {
  writeFileSync(outFile, output, 'utf8');
  console.log(`✓ License 已写入 ${outFile}`);
} else {
  console.log(output);
}
console.log(`\n  licenseId : ${payload.licenseId}`);
console.log(`  客户      : ${payload.customerName}（${payload.edition}）`);
console.log(`  功能      : ${payload.features.join(', ') || '（无增值功能）'}`);
console.log(`  到期      : ${payload.expiresAt}（宽限至 ${payload.graceUntil}）`);
console.log(`  绑定安装  : ${installationId}`);
