import { describe, expect, it } from 'vitest';
import { makeSankeySpec } from './builders';
import type { ChartDatum } from './helpers';

const palette = {
  primary: '#0064fa',
  text1: '#1c1f23',
  bg1: '#ffffff',
  border: '#e5e7eb',
  dataColors: ['#c1', '#c2', '#c3'],
} as unknown as Parameters<typeof makeSankeySpec>[0]['palette'];

const NODES = [
  { id: 's1:/', label: '/', value: 10, step: 1 },
  { id: 's2:/users', label: '/users', value: 7, step: 2 },
  { id: 's2:$exit', label: '$exit', value: 3, step: 2 },
];
const LINKS = [
  { source: 's1:/', target: 's2:/users', value: 7, step: 1 },
  { source: 's1:/', target: 's2:$exit', value: 3, step: 1 },
];

function build() {
  return makeSankeySpec({
    nodes: NODES,
    links: LINKS,
    palette,
    nodeColor: (node) => (node.label === '$exit' ? '#gray' : '#green'),
    nodeLayer: (node) => Number(node.step) - 1,
    nodeLabel: (node) => `第${Number(node.step)}步·${String(node.label)}`,
    tooltip: {
      nodeItems: [{ key: '步序', value: (datum) => String(datum?.step) }],
      linkItems: [{ key: '步序', value: (datum) => String(datum?.step) }],
    },
  });
}

/**
 * VChart 传给 label / tooltip / style 回调的是**布局元素**，业务字段藏在 element.datum 里。
 * 这些回调静默拿到 undefined 时图能正常渲染、构建与类型检查全过，只是界面上显示 "undefined"，
 * 所以必须用元素形态而不是原始数据形态来断言。
 */
const nodeElement = (id: string): ChartDatum => ({
  key: id,
  value: 99,
  depth: 0,
  datum: NODES.find((n) => n.id === id),
});

const linkElement = (index: number): ChartDatum => ({
  source: LINKS[index].source,
  target: LINKS[index].target,
  value: LINKS[index].value,
  datum: LINKS[index],
});

/** 极端情况：元素上只有 key，没有挂 datum —— 仍应能靠 nodeKey 还原业务字段 */
const bareNodeElement = (id: string): ChartDatum => ({ key: id, value: 1 });

type StyleFn = (datum: ChartDatum) => string;
type TooltipLine = { key: string; value: (datum: ChartDatum) => string; visible: (datum: ChartDatum) => boolean };

function labelText(spec: ReturnType<typeof build>): StyleFn {
  return (spec.label as { style: { text: StyleFn } }).style.text;
}
function tooltipLines(spec: ReturnType<typeof build>): TooltipLine[] {
  return (spec.tooltip as { mark: { content: TooltipLine[] } }).mark.content;
}

describe('makeSankeySpec', () => {
  it('从布局元素还原节点标签，而不是显示 undefined', () => {
    const text = labelText(build());
    expect(text(nodeElement('s1:/'))).toBe('第1步·/');
    expect(text(nodeElement('s2:$exit'))).toBe('第2步·$exit');
  });

  it('元素未携带 datum 时靠 nodeKey 还原标签', () => {
    expect(labelText(build())(bareNodeElement('s2:/users'))).toBe('第2步·/users');
  });

  it('链路 tooltip 能读到业务字段 step', () => {
    const linkLine = tooltipLines(build()).find((line) => line.visible(linkElement(0)));
    expect(linkLine?.value(linkElement(0))).toBe('1');
  });

  it('节点与链路的 tooltip 行互斥显示', () => {
    const lines = tooltipLines(build());
    const node = nodeElement('s1:/');
    const link = linkElement(0);
    expect(lines.filter((line) => line.visible(node))).toHaveLength(1);
    expect(lines.filter((line) => line.visible(link))).toHaveLength(1);
    expect(lines.find((line) => line.visible(node))?.value(node)).toBe('1');
  });
});
