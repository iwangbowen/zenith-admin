-- Publish a new role version after removing the retired UI-only capabilities.
WITH changed AS (
  UPDATE roles SET permission_codes = permission_codes - 'system:access-governance:request' - 'system:access-governance:approve', permission_version = permission_version + 1
  WHERE permission_codes ?| ARRAY['system:access-governance:request', 'system:access-governance:approve']
  RETURNING id, permission_version, permission_codes, data_scope
)
INSERT INTO identity_role_versions (role_id, version, permission_codes, data_scope, dept_scope_ids)
SELECT changed.id, changed.permission_version, changed.permission_codes, changed.data_scope,
  coalesce((SELECT jsonb_agg(dept_id ORDER BY dept_id) FROM role_dept_scopes WHERE role_id = changed.id), '[]'::jsonb) FROM changed;
--> statement-breakpoint
DELETE FROM identity_user_permissions WHERE permission_code IN ('system:access-governance:request', 'system:access-governance:approve');
--> statement-breakpoint
DELETE FROM menus WHERE permission IN ('system:access-governance:request', 'system:access-governance:approve');
