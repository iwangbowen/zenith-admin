-- Backfill reference counts for App artifacts created before business upload sessions.
-- Each artifact holds exactly one reference; without this, deleting an old artifact would
-- fail because managed_files.ref_count is still 0.
UPDATE "managed_files" AS mf
SET ref_count = sub.cnt,
    gc_state = 'live',
    orphaned_at = NULL
FROM (
  SELECT file_id, count(*)::int AS cnt
  FROM "app_artifacts"
  WHERE file_id IS NOT NULL
  GROUP BY file_id
) AS sub
WHERE mf.id = sub.file_id
  AND mf.ref_count <> sub.cnt;
