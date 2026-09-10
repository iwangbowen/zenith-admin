type Child = Node | string | number | null | undefined | false | Child[];

type Attrs = Record<string, string | number | boolean | null | undefined>;

/**
 * 极简元素构造：`h('div', { class: 'x', 'data-id': 1 }, '文本', child)`。
 * 文本子节点走 textContent 语义（自动转义），属性走 setAttribute；布尔 true 输出空属性、false / null 跳过。
 * 取代原字符串拼 HTML + 手写 esc()，从根上消除注入面。
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      append(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

/** 清空后填入子节点 */
export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}
