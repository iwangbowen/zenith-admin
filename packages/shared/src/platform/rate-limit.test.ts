import { describe, expect, it } from 'vitest';
import { rateLimitPathMatches, selectRateLimitRule } from './rate-limit';
import { createRateLimitRuleSchema, updateRateLimitRuleSchema } from './validation';
describe('rate limit policy matching', () => {
 it('matches templates, segment wildcards and literal metacharacters safely',()=>{
  expect(rateLimitPathMatches('/api/users/{id}','/api/users/42')).toBe(true);
  expect(rateLimitPathMatches('/api/users/{id}','/api/users/42/roles')).toBe(false);
  expect(rateLimitPathMatches('/api/files/*/content','/api/files/4/content')).toBe(true);
  expect(rateLimitPathMatches('/api/tree/*','/api/tree/a/b')).toBe(true);
  expect(rateLimitPathMatches('/api/x.json','/api/xAjson')).toBe(false);
 });
 it('selects by method, stage and deterministic priority',()=>{
  const base={keyType:'ip' as const,enabled:true,pathPatterns:['/api/users/{id}'],priority:1,methods:['POST']};
  expect(selectRateLimitRule([{...base,name:'b'},{...base,name:'a'}],'POST','/api/users/4',false)?.name).toBe('a');
  expect(selectRateLimitRule([{...base,name:'a'}],'GET','/api/users/4',false)).toBeUndefined();
  expect(selectRateLimitRule([{...base,name:'a'}],'POST','/api/users/4',true)).toBeUndefined();
 });
 it('rejects out of range settings and preserves partial update omission',()=>{
  expect(createRateLimitRuleSchema.safeParse({name:'test',windowMs:2147483648,limit:2,keyType:'ip',enabled:false}).success).toBe(false);
  expect(updateRateLimitRuleSchema.safeParse({blockedMessage:'x'.repeat(256)}).success).toBe(false);
  expect(updateRateLimitRuleSchema.parse({enabled:false})).toEqual({enabled:false});
 });
});