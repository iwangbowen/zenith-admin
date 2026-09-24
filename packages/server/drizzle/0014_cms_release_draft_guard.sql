CREATE OR REPLACE FUNCTION cms_release_configuration_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'CMS release identity and source are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.items IS DISTINCT FROM OLD.items
    OR NEW.configuration_items IS DISTINCT FROM OLD.configuration_items
    OR NEW.configuration_snapshot IS DISTINCT FROM OLD.configuration_snapshot
    OR NEW.base_generation_id IS DISTINCT FROM OLD.base_generation_id THEN
    -- Only an unbuilt configuration working draft can absorb subsequent saves.
    IF OLD.source = 'configuration' AND OLD.status = 'draft' AND NEW.status = 'draft'
      AND OLD.deployment_id IS NULL AND NEW.deployment_id IS NULL
      AND OLD.items = '[]'::jsonb AND NEW.items = '[]'::jsonb THEN
      RETURN NEW;
    END IF;
    -- Content revisions remain fixed; retrying a content-only build may advance its public baseline.
    IF OLD.source = 'content' AND OLD.status IN ('draft', 'failed') AND NEW.status = OLD.status
      AND NEW.deployment_id IS NOT DISTINCT FROM OLD.deployment_id
      AND OLD.configuration_items = '[]'::jsonb AND NEW.configuration_items = '[]'::jsonb
      AND NEW.items IS NOT DISTINCT FROM OLD.items
      AND NEW.configuration_snapshot IS NOT DISTINCT FROM OLD.configuration_snapshot THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'CMS release inputs are immutable after build; create another release' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
