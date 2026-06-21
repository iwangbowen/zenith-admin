/**
 * 结束节点
 */
const END_LABEL: Record<string, { text: string; color: string }> = {
  approved: { text: '已通过', color: '#0dc87c' },
  rejected: { text: '已驳回', color: '#ff4d4f' },
  withdrawn: { text: '已撤回', color: '#fa8c16' },
  cancelled: { text: '已取消', color: '#8c8c8c' },
};

export default function EndNode({ status }: Readonly<{ status?: string | null }>) {
  const meta = status ? END_LABEL[status] : null;
  return (
    <div className="fd-end-node">
      <div className="fd-end-node__circle" style={meta ? { borderColor: meta.color, color: meta.color } : undefined}>
        {meta ? meta.text : '结束'}
      </div>
    </div>
  );
}
