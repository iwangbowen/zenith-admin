/**
 * "+" 按钮组件 — 点击弹出节点类型选择器
 */
import { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { ADDABLE_NODE_TYPES, type NodeTypeInfo } from '../constants';
import type { FlowNodeType } from '../types';

interface AddNodeButtonProps {
  onAdd: (type: FlowNodeType) => void;
}

export default function AddNodeButton({ onAdd }: AddNodeButtonProps) {
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
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 'calc(50% + 24px)',
            zIndex: 10,
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
            padding: 4,
          }}
        >
          <div className="fd-node-picker">
            {ADDABLE_NODE_TYPES.map(info => (
              <div
                key={info.type}
                className="fd-node-picker__item"
                onClick={() => handleSelect(info)}
              >
                <div
                  className="fd-node-picker__icon"
                  style={{ borderColor: info.color, color: info.color }}
                >
                  <info.icon size={20} />
                </div>
                <span className="fd-node-picker__label">{info.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
