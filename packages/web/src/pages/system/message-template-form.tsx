import { Col, Form, Row } from '@douyinfe/semi-ui';

/**
 * 消息模板（邮件 / 短信 / 站内信）编辑表单的共用行。
 * 各页只保留自己的渠道特有字段（主题 / 服务商模板号 / 类型…），名称编码与变量备注行在此统一。
 */

export function TemplateNameCodeRow({ isEdit, codePlaceholder = '请输入模板编码' }: Readonly<{ isEdit: boolean; codePlaceholder?: string }>) {
  return (
    <Row gutter={16}>
      <Col span={12}>
        <Form.Input field="name" label="模板名称" placeholder="请输入模板名称"
          rules={[{ required: true, message: '请输入模板名称' }]} />
      </Col>
      <Col span={12}>
        <Form.Input field="code" label="模板编码" disabled={isEdit} placeholder={codePlaceholder}
          rules={[{ required: true, message: '请输入模板编码' }]} />
      </Col>
    </Row>
  );
}

export function TemplateVariablesRemarkRows({ variablesPlaceholder = '如：{"username":"用户名"}' }: Readonly<{ variablesPlaceholder?: string }>) {
  return (
    <>
      <Row gutter={16}>
        <Col span={24}>
          <Form.Input field="variables" label="变量" placeholder={variablesPlaceholder} />
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={24}>
          <Form.TextArea field="remark" label="备注" rows={2} placeholder="请输入备注" />
        </Col>
      </Row>
    </>
  );
}
