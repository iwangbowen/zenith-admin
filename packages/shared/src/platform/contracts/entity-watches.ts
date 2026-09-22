import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { canonicalEntityRefSchema } from '../entity-registry';

export const entityWatchStateSchema = z.object({ supported: z.boolean(), watching: z.boolean() }).meta({ id: 'EntityWatchState' });
export const entityWatchContract = defineContract('/api/platform/entities', {
  state: op.get('/{type}/{key}/watch', { access: 'authenticated', params: canonicalEntityRefSchema, response: entityWatchStateSchema, summary: '查看当前用户的对象关注状态' }),
  follow: op.post('/{type}/{key}/watch', { access: 'authenticated', params: canonicalEntityRefSchema, response: entityWatchStateSchema,
    audit: '关注业务对象', summary: '关注对象后续业务事件' }),
  unfollow: op.delete('/{type}/{key}/watch', { access: 'authenticated', params: canonicalEntityRefSchema, response: entityWatchStateSchema,
    audit: '取消对象关注', summary: '取消当前用户的对象关注' }),
}, { tags: ['EntityWatches'] });
