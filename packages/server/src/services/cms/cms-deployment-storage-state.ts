import { eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { DbExecutor } from '../../db/types';
import { cmsDeploymentStorage } from '../../db/schema/cms-deployment-retention';

export async function assertCmsDeploymentStorageAvailable(executor: DbExecutor, deploymentId: number): Promise<void> {
  const [storage] = await executor.select({ state: cmsDeploymentStorage.storageState }).from(cmsDeploymentStorage).where(eq(cmsDeploymentStorage.deploymentId, deploymentId)).limit(1);
  if (storage && storage.state !== 'available') throw new HTTPException(409, { message: storage.state === 'purged' ? '该部署存储已回收，不能预览或回滚；请基于当前站点重新构建发布单' : '该部署正在回收，不能作为发布或恢复来源' });
}

/** Never cascade into an unrelated schema, even if someone manually added a view on a retained generation. */
export async function assertNoExternalCmsSchemaDependencies(executor: DbExecutor, namespaces: readonly string[]): Promise<void> {
  const names = sql.join(namespaces.map(name => sql`${name}`), sql`,`);
  const [dependency] = await executor.execute<{ identity: string }>(sql`select identified.identity from pg_depend d
    join pg_class target on d.refclassid='pg_class'::regclass and target.oid=d.refobjid
    join pg_namespace target_ns on target_ns.oid=target.relnamespace
    left join pg_rewrite rewrite on d.classid='pg_rewrite'::regclass and rewrite.oid=d.objid
    left join pg_class dependent on dependent.oid=rewrite.ev_class
    left join pg_namespace dependent_ns on dependent_ns.oid=dependent.relnamespace
    cross join lateral pg_identify_object(d.classid,d.objid,d.objsubid) identified
    where target_ns.nspname in (${names}) and coalesce(identified.schema,dependent_ns.nspname) is not null
      and coalesce(identified.schema,dependent_ns.nspname) not in (${names},'pg_catalog','pg_toast') limit 1`);
  if (dependency) throw new Error(`部署仍被数据库对象引用，未回收：${dependency.identity}`);
}
