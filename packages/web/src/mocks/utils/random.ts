/** Demo 用随机十六进制串（密钥 / SN / 凭据占位），长度为 `len` 个小写十六进制字符；非加密安全 */
export function randomHex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
