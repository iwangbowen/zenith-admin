/**
 * "+" 按钮组件 — 点击弹出分组节点类型选择器
 */
import { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { NODE_TYPE_GROUPS, type NodeTypeInfo } from '../constants';
import type { FlowNodeType } from '../types';

interface AddNodeButtonProps {
  onAdd: (type: FlowNodeType) => void;
}

export default function AddNodeButton({ onAdd }: Readonly<AddNodeButtonProps>) {
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [visible]);

  const handleSelect = (info: NodeTypeInfo) => {
    setVisible(false);
    onAdd(info.type);
  };

  return (
    <div className="fd-add-node-btn-wrap" ref={wrapRef}>
      <button
        className="fd-add-node-btn"
        type="button"
        onClick={() => setVisible(v => !v)}
        title="添加节点"
      >
        <Plus size={16} />
      </button>

      {visible && (
        <div className="fd-node-picker-panel">
          {NODE_TYPE_GROUPS.map(group => (
            <div key={group.label} className="fd-node-picker-group">
              <div className="fd-node-picker-group__title">{group.label}</div>
              <div className="fd-node-picker">
                {group.types.map(info => (
                  <button
                    key={info.type}
                    type="button"
                    className="fd-node-picker__item"
                    onClick={() => handleSelect(info)}
                    title={info.description}
                  >
                    <div
                      className="fd-node-picker__icon"
                      style={{ borderColor: info.color, color: info.color }}
                    >
                      <info.icon size={20} />
                    </div>
                    <span className="fd-node-picker__label">{info.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
