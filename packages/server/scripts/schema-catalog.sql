-- 结构清单：输出 public schema 中可逐行 diff 的结构定义（已排序）。
-- 排除分区子表与扩展自带对象；函数体以 md5 比对。
-- 用法：psql -At -v ON_ERROR_STOP=1 -f schema-catalog.sql
WITH rels AS (
  SELECT c.oid, c.relname, c.relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND NOT c.relispartition
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
)
SELECT line FROM (
  SELECT 'column ' || r.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
    || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
    || COALESCE(' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid), '')
    || CASE WHEN a.attidentity <> '' THEN ' IDENTITY ' || a.attidentity::text ELSE '' END
    || CASE WHEN a.attgenerated <> '' THEN ' GENERATED' ELSE '' END AS line
  FROM rels r
  JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = r.oid AND ad.adnum = a.attnum
  UNION ALL
  SELECT 'constraint ' || r.relname || ' ' || co.conname || ' ' || pg_get_constraintdef(co.oid)
  FROM rels r JOIN pg_constraint co ON co.conrelid = r.oid
  UNION ALL
  SELECT 'index ' || pg_get_indexdef(i.indexrelid)
  FROM rels r JOIN pg_index i ON i.indrelid = r.oid
  UNION ALL
  SELECT 'trigger ' || pg_get_triggerdef(t.oid)
  FROM rels r JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal
  UNION ALL
  SELECT 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(pg_get_functiondef(p.oid))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  GROUP BY t.typname
  UNION ALL
  SELECT 'view ' || r.relname || ' ' || md5(pg_get_viewdef(r.oid))
  FROM rels r WHERE r.relkind IN ('v', 'm')
  UNION ALL
  SELECT 'partitioned ' || c.relname || ' ' || pg_get_partkeydef(c.oid)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'p'
  UNION ALL
  SELECT 'extension ' || extname FROM pg_extension
  UNION ALL
  SELECT 'role zenith_readonly' FROM pg_roles WHERE rolname = 'zenith_readonly'
) catalog
ORDER BY line;
