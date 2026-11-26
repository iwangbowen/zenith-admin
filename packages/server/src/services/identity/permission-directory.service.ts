import { buildPermissionDirectory } from '@zenith/shared/permission-features';
import { db } from '../../db';
import { menus } from '../../db/schema';
import { mapMenu } from './menus.service';

export async function getPermissionCatalog() {
  const pages = await db.select().from(menus).orderBy(menus.sort, menus.id);
  return buildPermissionDirectory(pages.map(mapMenu));
}
