/**
 * 页面级配置经 SeoHead 输出为 `<meta name="cms-*">`（非执行内容：不进 CSP 哈希、不被预览剥离）。
 * 名称与 cms/themes/_shared.tsx SeoHead 保持一致。
 */
export function readMeta(name: string, doc: Document = document): string | null {
  const content = doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
  return content ? content : null;
}
