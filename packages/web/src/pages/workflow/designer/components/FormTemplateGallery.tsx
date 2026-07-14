/**
 * 表单模板库弹窗 — 左侧模板卡片列表，右侧实时预览，应用时整体替换当前表单。
 */
import { useState } from 'react';
import { Button, Modal, Tag, Typography } from '@douyinfe/semi-ui';
import type { WorkflowFormField, WorkflowFormSettings } from '@zenith/shared';
import { FORM_TEMPLATES, type FormTemplate } from '../form-templates';
import { flattenAllFields } from '../form-tree';
import WorkflowFormRenderer from './WorkflowFormRenderer';

interface FormTemplateGalleryProps {
  visible: boolean;
  onCancel: () => void;
  /** 当前表单是否已有字段（应用前提示覆盖） */
  hasExistingFields: boolean;
  onApply: (fields: WorkflowFormField[], settings: WorkflowFormSettings) => void;
}

export default function FormTemplateGallery({ visible, onCancel, hasExistingFields, onApply }: Readonly<FormTemplateGalleryProps>) {
  const [activeKey, setActiveKey] = useState(FORM_TEMPLATES[0].key);
  const active = FORM_TEMPLATES.find((t) => t.key === activeKey) ?? FORM_TEMPLATES[0];

  const apply = (tpl: FormTemplate) => {
    // 深拷贝，避免模板常量被后续编辑污染；保留可读 key 便于条件/公式引用
    const fields = structuredClone(tpl.fields);
    const doApply = () => {
      onApply(fields, { ...tpl.settings });
      onCancel();
    };
    if (hasExistingFields) {
      Modal.confirm({
        title: `应用「${tpl.name}」模板`,
        content: '将替换当前表单的全部字段与表单设置（可通过撤销恢复）。',
        okText: '替换',
        cancelText: '取消',
        onOk: doApply,
      });
    } else {
      doApply();
    }
  };

  return (
    <Modal
      title="表单模板库"
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={880}
      bodyStyle={{ padding: 0 }}
      closeOnEsc
    >
      <div className="fd-tpl-gallery">
        <div className="fd-tpl-gallery__list">
          {FORM_TEMPLATES.map((tpl) => (
            <button
              key={tpl.key}
              type="button"
              className={[
                'fd-tpl-gallery__card',
                tpl.key === activeKey && 'fd-tpl-gallery__card--active',
              ].filter(Boolean).join(' ')}
              onClick={() => setActiveKey(tpl.key)}
            >
              <div className="fd-tpl-gallery__card-head">
                <Typography.Text strong>{tpl.name}</Typography.Text>
                <Tag size="small" color="blue">{tpl.category}</Tag>
              </div>
              <Typography.Text type="tertiary" size="small" className="fd-tpl-gallery__card-desc">
                {tpl.description}
              </Typography.Text>
              <Typography.Text type="quaternary" size="small">
                {flattenAllFields(tpl.fields).length} 个字段
              </Typography.Text>
            </button>
          ))}
        </div>
        <div className="fd-tpl-gallery__preview">
          <div className="fd-tpl-gallery__preview-bar">
            <Typography.Text strong>{active.name} · 预览</Typography.Text>
            <Button type="primary" size="small" onClick={() => apply(active)}>应用此模板</Button>
          </div>
          <div className="fd-tpl-gallery__preview-body">
            <WorkflowFormRenderer
              key={active.key}
              fields={active.fields}
              readOnly
              labelPosition={active.settings.labelPosition ?? 'top'}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
