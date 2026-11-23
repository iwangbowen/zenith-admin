-- 仅补齐当前系统预置流程。模板内容为发布时 SEED_ACCESS_REQUEST_PRINT_TEMPLATE 的快照。
DO $access_request_print$
DECLARE
  definition_id CONSTANT integer := 5;
  default_name CONSTANT text := '权限申请审批单';
  print_fields CONSTANT jsonb := $print_fields$[
  {"key":"targetUserName","label":"受益用户","type":"text","columnSpan":8},
  {"key":"requestType","label":"申请类型","type":"select","columnSpan":8,"options":["temporary","emergency"],"optionItems":[{"value":"temporary","label":"常规授权"},{"value":"emergency","label":"紧急授权"}]},
  {"key":"riskLabel","label":"风险等级","type":"text","columnSpan":8},
  {"key":"validityMode","label":"有效期限","type":"select","columnSpan":8,"options":["limited","permanent"],"optionItems":[{"value":"limited","label":"限时有效"},{"value":"permanent","label":"永久有效"}]},
  {"key":"startsAt","label":"生效时间","type":"date","columnSpan":8},
  {"key":"expiresAt","label":"失效时间","type":"date","columnSpan":8},
  {"key":"approvalPolicy","label":"审批要求","type":"select","columnSpan":12,"options":["none","manager","manager_security","two_person"],"optionItems":[{"value":"none","label":"策略自动批准"},{"value":"manager","label":"部门负责人"},{"value":"manager_security","label":"部门负责人 + 安全审批"},{"value":"two_person","label":"部门负责人 + 两名独立安全审批"}]},
  {"key":"mfaRequired","label":"审批需 MFA","type":"switch","columnSpan":12},
  {"key":"managerId","label":"部门负责人","type":"userSelect","columnSpan":8},
  {"key":"securityApproverId","label":"安全审批人","type":"userSelect","columnSpan":8},
  {"key":"secondSecurityApproverId","label":"第二安全审批","type":"userSelect","columnSpan":8},
  {"key":"reason","label":"申请原因","type":"textarea"},
  {"key":"permissionItems","label":"权限明细","type":"detail","children":[{"key":"permissionLabel","label":"权限名称","type":"text"},{"key":"permissionCode","label":"权限码","type":"text"},{"key":"dataScope","label":"数据范围","type":"select","options":["all","custom","dept_only","dept","self"],"optionItems":[{"value":"all","label":"全部数据权限"},{"value":"custom","label":"指定部门数据权限"},{"value":"dept_only","label":"本部门数据权限"},{"value":"dept","label":"本部门及以下数据权限"},{"value":"self","label":"仅本人数据权限"}]}]}
]$print_fields$;
  current_form jsonb;
  template_id integer;
  template_name text := default_name;
  name_suffix integer := 1;
BEGIN
  SELECT custom_form, print_template_id INTO current_form, template_id
  FROM workflow_definitions
  WHERE id = definition_id
    AND tenant_id IS NULL
    AND form_type = 'custom'
    AND custom_form ->> 'businessType' = 'identity.access_request'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(NULLIF(current_form -> 'printFields', 'null'::jsonb), '[]'::jsonb) = '[]'::jsonb THEN
    current_form := jsonb_set(current_form, '{printFields}', print_fields);
  END IF;

  IF template_id IS NULL THEN
    SELECT id INTO template_id
    FROM report_print_templates
    WHERE tenant_id IS NULL
      AND name = default_name
      AND source_type = 'entity'
      AND entity_kind = 'workflow_instance'
      AND entity_ref_id = definition_id
      AND status = 'enabled'
      AND (
        jsonb_typeof(content -> 'grid') = 'object'
        OR CASE WHEN jsonb_typeof(content -> 'sheets') = 'array'
          THEN jsonb_array_length(content -> 'sheets') > 0 ELSE false END
      );

    IF template_id IS NULL THEN
      WHILE EXISTS (SELECT 1 FROM report_print_templates WHERE tenant_id IS NULL AND name = template_name) LOOP
        template_name := format('%s（内置 %s）', default_name, name_suffix);
        name_suffix := name_suffix + 1;
      END LOOP;

      -- 示例报表占用固定 ID 1。通过正常序列为本模板分配 ID。
      PERFORM setval(
        pg_get_serial_sequence('report_print_templates', 'id'),
        GREATEST(
          (SELECT last_value FROM report_print_templates_id_seq),
          (SELECT COALESCE(MAX(id), 1) FROM report_print_templates)
        )
      );

      INSERT INTO report_print_templates (
        owner_id, name, source_type, entity_kind, entity_ref_id, content, page_config, status, remark
      ) VALUES (
        (SELECT id FROM users WHERE username = 'admin' AND tenant_id IS NULL),
        template_name, 'entity', 'workflow_instance', definition_id,
        $template_content${
  "sheets": [
    {
      "id": "approval-sheet",
      "name": "审批单",
      "grid": {
        "rows": 28,
        "cols": 24,
        "colWidths": [28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
        "rowHeights": [34,20,18,22,26,26,26,26,22,26,26,26,26,52,22,22,24,22,22,40,26,22,24,22,22,40,8,18],
        "cells": [
          {"row":0,"col":0,"v":"","s":{}},
          {"row":0,"col":4,"v":"${printTitle}","s":{"fontSize":17,"bold":true,"color":"#111827","align":"center","valign":"middle"}},
          {"row":1,"col":4,"v":"编号：${serialNo}    状态：${statusText}    发起时间：${createdAt}","s":{"fontSize":9,"color":"#6B7280","align":"center","valign":"middle"}},
          {"row":2,"col":4,"v":"","s":{}},
          {"row":0,"col":20,"v":"${QRCODE(verifyUrl)}","s":{"valign":"middle","align":"center"}},
          {"row":3,"col":0,"v":"基本信息","s":{"fontSize":10,"bold":true,"color":"#111827","background":"#E8EDF3","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}}}},
          {"row":4,"col":0,"v":"流程名称","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":4,"col":4,"v":"${definitionName}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":4,"col":12,"v":"发起人","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":4,"col":16,"v":"${initiatorName}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":5,"col":0,"v":"发起部门","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":5,"col":4,"v":"${initiatorDeptName}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":5,"col":12,"v":"优先级","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":5,"col":16,"v":"${priorityText}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":6,"col":0,"v":"业务编号","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":6,"col":4,"v":"${serialNo}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":6,"col":12,"v":"当前状态","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":6,"col":16,"v":"${statusText}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":7,"col":0,"v":"发起时间","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":7,"col":4,"v":"${createdAt}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":7,"col":12,"v":"完成时间","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":7,"col":16,"v":"${finishedAt}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":8,"col":0,"v":"表单内容","s":{"fontSize":10,"bold":true,"color":"#111827","background":"#E8EDF3","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}}}},
          {"row":9,"col":0,"v":"受益用户","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":9,"col":3,"v":"${targetUserName}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":9,"col":8,"v":"申请类型","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":9,"col":11,"v":"${requestType}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":9,"col":16,"v":"风险等级","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":9,"col":19,"v":"${riskLabel}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":10,"col":0,"v":"有效期限","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":10,"col":3,"v":"${validityMode}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":10,"col":8,"v":"生效时间","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":10,"col":11,"v":"${startsAt}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":10,"col":16,"v":"失效时间","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":10,"col":19,"v":"${expiresAt}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":11,"col":0,"v":"审批要求","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":11,"col":4,"v":"${approvalPolicy}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":11,"col":12,"v":"审批需 MFA","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":11,"col":16,"v":"${mfaRequired}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":12,"col":0,"v":"部门负责人","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":12,"col":3,"v":"${managerId}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":12,"col":8,"v":"安全审批人","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":12,"col":11,"v":"${securityApproverId}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":12,"col":16,"v":"第二安全审批","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":12,"col":19,"v":"${secondSecurityApproverId}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":13,"col":0,"v":"申请原因","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":13,"col":4,"v":"${reason}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form"},
          {"row":14,"col":0,"v":"权限明细","s":{"fontSize":9.5,"bold":true,"color":"#1F2937","background":"#F3F5F8","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}}}},
          {"row":15,"col":0,"v":"#","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":15,"col":2,"v":"权限名称","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":15,"col":10,"v":"权限码","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":15,"col":17,"v":"数据范围","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":16,"col":0,"v":"${_index}","s":{"fontSize":9,"color":"#111827","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form_permissionitems"},
          {"row":16,"col":2,"v":"${permissionLabel}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form_permissionitems"},
          {"row":16,"col":10,"v":"${permissionCode}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form_permissionitems"},
          {"row":16,"col":17,"v":"${dataScope}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"form_permissionitems"},
          {"row":17,"col":0,"v":"审批记录","s":{"fontSize":10,"bold":true,"color":"#111827","background":"#E8EDF3","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}}}},
          {"row":18,"col":0,"v":"审批节点","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":18,"col":4,"v":"处理人","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":18,"col":7,"v":"结果","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":18,"col":10,"v":"审批意见","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":18,"col":16,"v":"处理时间","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":18,"col":21,"v":"签名","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":19,"col":0,"v":"${nodeName}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"tasks"},
          {"row":19,"col":4,"v":"${assigneeName}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"tasks"},
          {"row":19,"col":7,"v":"${statusText}","s":{"fontSize":9,"color":"#111827","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"tasks"},
          {"row":19,"col":10,"v":"${comment}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"tasks"},
          {"row":19,"col":16,"v":"${actionAt}","s":{"fontSize":9,"color":"#111827","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"tasks"},
          {"row":19,"col":21,"kind":"image","image":{"src":"${signature}","fit":"contain"},"s":{"border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"valign":"middle"},"datasetKey":"tasks"},
          {"row":20,"col":0,"v":"抄送","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":20,"col":4,"v":"${ccNames}","s":{"fontSize":9.5,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":21,"col":0,"v":"沟通记录","s":{"fontSize":10,"bold":true,"color":"#111827","background":"#E8EDF3","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}}}},
          {"row":22,"col":0,"v":"${userName}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"comments"},
          {"row":22,"col":4,"v":"${content}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"comments"},
          {"row":22,"col":18,"v":"${createdAt}","s":{"fontSize":9,"color":"#111827","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"comments"},
          {"row":23,"col":0,"v":"协办意见","s":{"fontSize":10,"bold":true,"color":"#111827","background":"#E8EDF3","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}}}},
          {"row":24,"col":0,"v":"节点","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":24,"col":4,"v":"邀请人","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":24,"col":7,"v":"协办人","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":24,"col":10,"v":"状态","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":24,"col":12,"v":"问题 / 意见","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":24,"col":19,"v":"回复时间","s":{"fontSize":9,"bold":true,"color":"#374151","background":"#F8FAFC","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true}},
          {"row":25,"col":0,"v":"${nodeName}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"consults"},
          {"row":25,"col":4,"v":"${inviterName}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"consults"},
          {"row":25,"col":7,"v":"${consulteeName}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"consults"},
          {"row":25,"col":10,"v":"${statusText}","s":{"fontSize":9,"color":"#111827","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"consults"},
          {"row":25,"col":12,"v":"${content}","s":{"fontSize":9,"color":"#111827","align":"left","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"consults"},
          {"row":25,"col":19,"v":"${repliedAt}","s":{"fontSize":9,"color":"#111827","align":"center","valign":"middle","border":{"top":{"style":"thin","color":"#C9CED6"},"right":{"style":"thin","color":"#C9CED6"},"bottom":{"style":"thin","color":"#C9CED6"},"left":{"style":"thin","color":"#C9CED6"}},"wrap":true},"datasetKey":"consults"},
          {"row":27,"col":0,"v":"扫码右上角二维码验真：核对本单据的业务编号、状态与归档校验值","s":{"fontSize":8,"color":"#9CA3AF","align":"right","valign":"middle"}}
        ],
        "merges": [
          {"row":0,"col":0,"rowSpan":3,"colSpan":4},
          {"row":0,"col":4,"rowSpan":1,"colSpan":16},
          {"row":1,"col":4,"rowSpan":1,"colSpan":16},
          {"row":2,"col":4,"rowSpan":1,"colSpan":16},
          {"row":0,"col":20,"rowSpan":3,"colSpan":4},
          {"row":3,"col":0,"rowSpan":1,"colSpan":24},
          {"row":4,"col":0,"rowSpan":1,"colSpan":4},
          {"row":4,"col":4,"rowSpan":1,"colSpan":8},
          {"row":4,"col":12,"rowSpan":1,"colSpan":4},
          {"row":4,"col":16,"rowSpan":1,"colSpan":8},
          {"row":5,"col":0,"rowSpan":1,"colSpan":4},
          {"row":5,"col":4,"rowSpan":1,"colSpan":8},
          {"row":5,"col":12,"rowSpan":1,"colSpan":4},
          {"row":5,"col":16,"rowSpan":1,"colSpan":8},
          {"row":6,"col":0,"rowSpan":1,"colSpan":4},
          {"row":6,"col":4,"rowSpan":1,"colSpan":8},
          {"row":6,"col":12,"rowSpan":1,"colSpan":4},
          {"row":6,"col":16,"rowSpan":1,"colSpan":8},
          {"row":7,"col":0,"rowSpan":1,"colSpan":4},
          {"row":7,"col":4,"rowSpan":1,"colSpan":8},
          {"row":7,"col":12,"rowSpan":1,"colSpan":4},
          {"row":7,"col":16,"rowSpan":1,"colSpan":8},
          {"row":8,"col":0,"rowSpan":1,"colSpan":24},
          {"row":9,"col":0,"rowSpan":1,"colSpan":3},
          {"row":9,"col":3,"rowSpan":1,"colSpan":5},
          {"row":9,"col":8,"rowSpan":1,"colSpan":3},
          {"row":9,"col":11,"rowSpan":1,"colSpan":5},
          {"row":9,"col":16,"rowSpan":1,"colSpan":3},
          {"row":9,"col":19,"rowSpan":1,"colSpan":5},
          {"row":10,"col":0,"rowSpan":1,"colSpan":3},
          {"row":10,"col":3,"rowSpan":1,"colSpan":5},
          {"row":10,"col":8,"rowSpan":1,"colSpan":3},
          {"row":10,"col":11,"rowSpan":1,"colSpan":5},
          {"row":10,"col":16,"rowSpan":1,"colSpan":3},
          {"row":10,"col":19,"rowSpan":1,"colSpan":5},
          {"row":11,"col":0,"rowSpan":1,"colSpan":4},
          {"row":11,"col":4,"rowSpan":1,"colSpan":8},
          {"row":11,"col":12,"rowSpan":1,"colSpan":4},
          {"row":11,"col":16,"rowSpan":1,"colSpan":8},
          {"row":12,"col":0,"rowSpan":1,"colSpan":3},
          {"row":12,"col":3,"rowSpan":1,"colSpan":5},
          {"row":12,"col":8,"rowSpan":1,"colSpan":3},
          {"row":12,"col":11,"rowSpan":1,"colSpan":5},
          {"row":12,"col":16,"rowSpan":1,"colSpan":3},
          {"row":12,"col":19,"rowSpan":1,"colSpan":5},
          {"row":13,"col":0,"rowSpan":1,"colSpan":4},
          {"row":13,"col":4,"rowSpan":1,"colSpan":20},
          {"row":14,"col":0,"rowSpan":1,"colSpan":24},
          {"row":15,"col":0,"rowSpan":1,"colSpan":2},
          {"row":15,"col":2,"rowSpan":1,"colSpan":8},
          {"row":15,"col":10,"rowSpan":1,"colSpan":7},
          {"row":15,"col":17,"rowSpan":1,"colSpan":7},
          {"row":16,"col":0,"rowSpan":1,"colSpan":2},
          {"row":16,"col":2,"rowSpan":1,"colSpan":8},
          {"row":16,"col":10,"rowSpan":1,"colSpan":7},
          {"row":16,"col":17,"rowSpan":1,"colSpan":7},
          {"row":17,"col":0,"rowSpan":1,"colSpan":24},
          {"row":18,"col":0,"rowSpan":1,"colSpan":4},
          {"row":18,"col":4,"rowSpan":1,"colSpan":3},
          {"row":18,"col":7,"rowSpan":1,"colSpan":3},
          {"row":18,"col":10,"rowSpan":1,"colSpan":6},
          {"row":18,"col":16,"rowSpan":1,"colSpan":5},
          {"row":18,"col":21,"rowSpan":1,"colSpan":3},
          {"row":19,"col":0,"rowSpan":1,"colSpan":4},
          {"row":19,"col":4,"rowSpan":1,"colSpan":3},
          {"row":19,"col":7,"rowSpan":1,"colSpan":3},
          {"row":19,"col":10,"rowSpan":1,"colSpan":6},
          {"row":19,"col":16,"rowSpan":1,"colSpan":5},
          {"row":19,"col":21,"rowSpan":1,"colSpan":3},
          {"row":20,"col":0,"rowSpan":1,"colSpan":4},
          {"row":20,"col":4,"rowSpan":1,"colSpan":20},
          {"row":21,"col":0,"rowSpan":1,"colSpan":24},
          {"row":22,"col":0,"rowSpan":1,"colSpan":4},
          {"row":22,"col":4,"rowSpan":1,"colSpan":14},
          {"row":22,"col":18,"rowSpan":1,"colSpan":6},
          {"row":23,"col":0,"rowSpan":1,"colSpan":24},
          {"row":24,"col":0,"rowSpan":1,"colSpan":4},
          {"row":24,"col":4,"rowSpan":1,"colSpan":3},
          {"row":24,"col":7,"rowSpan":1,"colSpan":3},
          {"row":24,"col":10,"rowSpan":1,"colSpan":2},
          {"row":24,"col":12,"rowSpan":1,"colSpan":7},
          {"row":24,"col":19,"rowSpan":1,"colSpan":5},
          {"row":25,"col":0,"rowSpan":1,"colSpan":4},
          {"row":25,"col":4,"rowSpan":1,"colSpan":3},
          {"row":25,"col":7,"rowSpan":1,"colSpan":3},
          {"row":25,"col":10,"rowSpan":1,"colSpan":2},
          {"row":25,"col":12,"rowSpan":1,"colSpan":7},
          {"row":25,"col":19,"rowSpan":1,"colSpan":5},
          {"row":27,"col":0,"rowSpan":1,"colSpan":24}
        ]
      },
      "repeatBlocks": [
        {"id":"detail_permissionitems","datasetKey":"form_permissionitems","range":{"start":16,"end":16}},
        {"id":"tasks","datasetKey":"tasks","range":{"start":19,"end":19}},
        {"id":"comments","datasetKey":"comments","range":{"start":22,"end":22}},
        {"id":"consults","datasetKey":"consults","range":{"start":25,"end":25}}
      ]
    }
  ],
  "entityDatasets": ["instance","form","form_fields","form_permissionitems","tasks","cc","comments","consults","attachments"]
}$template_content$::jsonb,
        $page_config${"paper":"A4","orientation":"portrait","margin":{"top":12,"right":14,"bottom":12,"left":14},"footer":"打印人：${printerName}    打印时间：${printedAt}    第 {page} / {pages} 页"}$page_config$::jsonb,
        'enabled', '系统预置的权限申请审批单打印模板'
      )
      RETURNING id INTO template_id;
    END IF;
  END IF;

  UPDATE workflow_definitions
  SET custom_form = current_form, print_template_id = template_id, updated_at = now()
  WHERE id = definition_id
    AND (custom_form IS DISTINCT FROM current_form OR print_template_id IS DISTINCT FROM template_id);
END;
$access_request_print$;
