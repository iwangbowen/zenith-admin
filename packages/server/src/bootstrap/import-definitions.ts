/**
 * 各业务域导入能力的组合根；在所有角色启动接入或执行前显式调用。
 */
import { registerImportTaskHandler } from '../lib/import-center/handler';
import { registerMembersImport } from '../services/member/imports/members';
import { registerUsersImport } from '../services/identity/imports/users';
import { registerIotDevicesImport } from '../services/iot/imports/iot-devices';
import { registerDictItemsImport } from '../services/platform/imports/dict-items';
import { registerCmsContentsImport } from '../services/cms/imports/cms-contents';

export function registerImportDefinitions(): void {
  registerImportTaskHandler();
  registerMembersImport();
  registerUsersImport();
  registerIotDevicesImport();
  registerDictItemsImport();
  registerCmsContentsImport();
}
