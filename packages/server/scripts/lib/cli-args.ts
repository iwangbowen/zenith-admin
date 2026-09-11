/**
 * 运维 / 压测脚本共用的极简命令行参数读取（`npx tsx scripts/xxx.ts --name value --flag`）。
 * 不引入解析库：脚本参数都是 `--key value` 与布尔开关两种形态。
 */

/** 读取 `--name value`；缺省或紧随的是另一个 `--` 选项时返回 fallback */
export function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

/** 布尔开关：`--name` 是否出现 */
export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
