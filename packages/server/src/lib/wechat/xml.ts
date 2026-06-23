/** 微信扁平 XML 工具（公众号消息回调为单层 XML）。 */

/** 解析微信扁平 XML 为键值对（优先取 CDATA，否则取纯文本；自动跳过容器标签如 <xml>） */
export function parseWechatXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  // 值分支用 [^<] 排除嵌套标签，使 <xml> 等容器标签不会吞掉内部叶子标签
  const re = /<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    result[m[1]] = (m[2] ?? m[3] ?? '').trim();
  }
  return result;
}

/** 构建微信 XML（数字字段不包 CDATA，字符串字段包 CDATA） */
export function buildWechatXml(fields: Record<string, string | number>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => (typeof v === 'number' ? `<${k}>${v}</${k}>` : `<${k}><![CDATA[${v}]]></${k}>`))
    .join('');
  return `<xml>${body}</xml>`;
}
