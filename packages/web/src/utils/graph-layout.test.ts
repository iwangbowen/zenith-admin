import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { layoutWithDagre } from './graph-layout';

describe('layoutWithDagre', () => {
  it('fixed-size nodes get independent positions instead of sharing one mutable size object', () => {
    const nodes: Node[] = [
      { id: 'source', position: { x: 0, y: 0 }, data: {} },
      { id: 'target', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges: Edge[] = [{ id: 'source-target', source: 'source', target: 'target' }];

    const laidOut = layoutWithDagre(nodes, edges, {
      rankdir: 'LR',
      nodesep: 24,
      ranksep: 90,
      nodeSize: { width: 190, height: 54 },
    });

    expect(laidOut[0].position).not.toEqual(laidOut[1].position);
    expect(laidOut[0].position.x).toBeLessThan(laidOut[1].position.x);
    expect(Number.isFinite(laidOut[0].position.y)).toBe(true);
    expect(Number.isFinite(laidOut[1].position.y)).toBe(true);
  });
});
