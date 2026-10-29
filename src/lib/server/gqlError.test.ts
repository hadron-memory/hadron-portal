import { describe, expect, it } from 'vitest';
import { ClientError } from 'graphql-request';
import { extractGqlError } from './gqlError';
import { appKeyRefusal, APP_KEY_MANAGERS_ONLY } from './app-key-refusal';
const requestId = 'a4451409-72f6-4f08-b90b-f8db328e8c58';
const secret = 'SELECT password FROM users at /srv/private.ts; query Secret($token: String!)';
const gql = (code: unknown, id: unknown = requestId) => ({response:{errors:[{message:secret,extensions:{code,requestId:id}}]}});
describe('portal#1132 public error envelope', () => {
  it('shows fixed copy and real correlation id, never internal prose', () => {
    const text = extractGqlError(gql('INTERNAL_SERVER_ERROR'), 'Save failed');
    expect(text).toContain('Something went wrong on our side');
    expect(text).toContain(requestId);
    expect(text).not.toContain(secret);
  });
  it.each([undefined,null,42,{},'not-an-id','<script>x</script>','a4451409-72f6-1f08-b90b-f8db328e8c58'])('ignores malformed carrier %j', id => {
    const e=gql('INTERNAL_SERVER_ERROR'); e.response.errors[0].extensions.requestId=id;
    const text=extractGqlError(e,'Save failed');
    expect(text).toContain('Something went wrong on our side');expect(text).not.toContain(secret);
    expect(text).not.toContain('Request ID:');
  });
  it('unknown GraphQL code is not permission to show its prose or correlation id',()=>{
    const text=extractGqlError(gql('UNKNOWN_FAULT'),'Save failed');
    expect(text).not.toContain(secret);expect(text).not.toContain(requestId);
  });
  it('existing typed fixed-copy gate keeps its own words, without id',()=>{
    expect(appKeyRefusal(gql('FORBIDDEN'),'Save failed')).toEqual({status:403,text:APP_KEY_MANAGERS_ONLY()});
  });
  it('genuine transport handling stays distinct from a GraphQL payload',()=>{
    expect(extractGqlError(new TypeError('fetch failed'),'Save failed')).toBe('fetch failed');
    expect(extractGqlError({response:null},'Save failed')).toBe('Save failed');
  });
  it('a ClientError without GraphQL errors never renders its query-bearing constructor text',()=>{
    const e=new ClientError({status:503,headers:new Headers(),body:'Service unavailable'}, {query:secret,variables:{token:'secret'}});
    expect(extractGqlError(e,'Save failed')).toBe('Save failed');
  });
});
