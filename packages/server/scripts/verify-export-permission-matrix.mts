import '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { config } from '../src/config';
import { db, closeDb } from '../src/db';
import * as schema from '../src/db/schema';
import { registerExport } from '../src/lib/export-center/registry';
import { usersExportDefinition } from '../src/services/identity/exports/users';
import { runWithCurrentUser } from '../src/lib/context';
import { runWithFreshUserPermissions } from '../src/lib/permissions';
import { createExportJob, getExportJobDownload } from '../src/services/tasks/export-jobs.service';
import { closeRedis } from '../src/lib/redis';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname) || new URL(config.databaseUrl).pathname !== '/zenith_export_qa') throw new Error('Requires isolated QA DB');
const out = resolve('../../output/export-special');
const fixture = JSON.parse(await readFile(resolve(out, 'runtime-initial.json'), 'utf8'));
const actor = { userId: fixture.actor, username: 'exportqa-a-owner', tenantId: fixture.tenantA, roles: ['exportqa-exporter'] };
const execute = <T>(fn: () => Promise<T>) => runWithCurrentUser(actor, () => runWithFreshUserPermissions(actor.userId, fn));
await db.update(schema.users).set({ userDataScope: null }).where(eq(schema.users.id, actor.userId));
const [role] = await db.select().from(schema.roles).where(eq(schema.roles.code, 'exportqa-exporter'));
await db.update(schema.roles).set({ permissionCodes: ['system:user:export'], dataScope: 'self' }).where(eq(schema.roles.id, role.id));
const [unrelated] = await db.insert(schema.roles).values({ name: 'QA unrelated wide role', code: 'exportqa-unrelated', tenantId: fixture.tenantA, permissionCodes: ['system:position:list'], dataScope: 'all' }).returning();
await db.insert(schema.userRoles).values({ userId: actor.userId, roleId: unrelated.id });
registerExport(usersExportDefinition);
const result = await execute(() => createExportJob({ entity: 'system.users', format: 'csv', columns: ['id'], query: {}, executionMode: 'sync' }));
if (result.job.rowCount !== 1) throw new Error('Unrelated permission expanded export scope');
let rawStatus;try { await execute(() => createExportJob({ entity: 'system.users', format: 'csv', query: {}, raw: true })); throw new Error('raw allowed without grant'); } catch(error) { rawStatus = (error as {status?:number}).status; if(rawStatus!==403) throw error; }
const [file] = await db.select().from(schema.managedFiles).where(eq(schema.managedFiles.id, result.job.fileId!));
const [storage] = await db.select().from(schema.fileStorageConfigs).where(eq(schema.fileStorageConfigs.id,file.storageConfigId));
await rm(join(storage.localRootPath!, ...file.objectKey.split('/')));
let missingStatus;try { await execute(() => getExportJobDownload(result.job.id,{})); throw new Error('Missing file download allowed'); } catch(error) { missingStatus = (error as {status?:number}).status;if(missingStatus!==410)throw error; }
const downloadCount=(await db.query.exportJobs.findFirst({where:eq(schema.exportJobs.id,result.job.id)}))!.downloadCount;
if(downloadCount!==0)throw new Error('Failed download was counted');
await db.update(schema.roles).set({permissionCodes:[]}).where(eq(schema.roles.id,role.id));
let permissionStatus;try { await execute(() => getExportJobDownload(result.job.id,{}));throw new Error('Revoked permission allowed'); }catch(error){permissionStatus=(error as {status?:number}).status;if(permissionStatus!==403)throw error;}
const record={rows:result.job.rowCount,rawStatus,missingStatus,downloadCount,permissionStatus};
await writeFile(resolve(out,'permission-matrix.json'),JSON.stringify(record,null,2));process.stdout.write(JSON.stringify(record)+'\n');
await closeDb();await closeRedis();process.exit(0);
