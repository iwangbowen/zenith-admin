-- Retire the duplicate self-service page. Related role/user menu links cascade.
DELETE FROM menus WHERE name = 'MyAccess' OR path = '/access/my' OR component = 'biz/access/MyAccessPage';
--> statement-breakpoint
UPDATE users SET favorite_menus = coalesce((SELECT jsonb_agg(item) FROM jsonb_array_elements(favorite_menus) item WHERE item <> '4210'::jsonb), '[]'::jsonb) WHERE favorite_menus @> '[4210]'::jsonb;
