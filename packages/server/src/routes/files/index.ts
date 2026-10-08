import { businessFileContract, fileContract, fileStorageConfigContract } from '@zenith/shared/platform';
import { defineRouteDomain } from '../_kit';
import businessFilesRoutes from './business-files';
import fileStorageConfigsRoutes from './file-storage-configs';
import filesRoutes from './files';

export default defineRouteDomain({
  name: 'files',
  licensing: { core: '文件存储与业务附件是基础能力' },
  mounts: () => [
    [fileStorageConfigContract.basePath, fileStorageConfigsRoutes],
    [fileContract.basePath, filesRoutes],
    [businessFileContract.basePath, businessFilesRoutes],
  ],
});
