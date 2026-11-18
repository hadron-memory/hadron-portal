/** #2043: locked SDK, synthetic keys, intercepted transport; no provider calls. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAgentChatLlm, RESPOND_ONCE_INSTRUCTION } from './agentChatLlm';
import type { AIProvider } from '$lib/types';
import fixtures from './fixtures/tool-choice-wire-2043.json';
const tools=[{name:'respond',description:'Respond to the user',parameters:{type:'object',properties:{message:{type:'string'}},required:['message']}}];
let body='';
beforeEach(()=>{
 body='';vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{body=String(init?.body);return Response.json({error:{type:'invalid_request_error',message:'synthetic refusal'}},{status:400});}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
async function request(model:string, toolChoice?:string|null, provider:AIProvider='anthropic', plain=false){
 const args={provider,model,toolChoice:toolChoice as 'AUTO'|'FORCED'|null|undefined,apiKey:provider==='bedrock'?JSON.stringify({accessKeyId:'SYNTHETIC2043',secretAccessKey:'synthetic-secret',region:'us-east-1'}):'SYNTHETIC2043',systemMessage:'Stage prompt',tools:plain?null:tools,messages:[{role:'user' as const,content:'hello'}]};
 await callAgentChatLlm(args).catch(()=>{});
 return JSON.parse(body);
}
describe('server choice is authoritative, never inferred from model/provider',()=>{
 it('AUTO for an unlisted opaque model is honored verbatim',async()=>{
  const r=await request('opaque-future-model','AUTO');
  expect(r.model).toBe('opaque-future-model');expect(r.tool_choice).toEqual({type:'auto'});
  expect(r.system[0].text).toBe('Stage prompt\n\n'+RESPOND_ONCE_INSTRUCTION);
 });
 it('FORCED for a formerly listed model stays forced',async()=>{
  const r=await request('claude-sonnet-5-5','FORCED');
  expect(r.tool_choice).toEqual({type:'tool',name:'respond'});expect(r.system[0].text).toBe('Stage prompt');
 });
 it.each([undefined,null,'auto','NEW_CHOICE'])('absent/unrecognized %s never enables auto',async choice=>{
  const r=await request('claude-sonnet-5-5',choice);
  expect(r.tool_choice).toEqual({type:'tool',name:'respond'});expect(r.system[0].text).toBe('Stage prompt');
 });
 it('a plain branch ignores AUTO without adding the instruction',async()=>{
  const r=await request('opaque-future-model','AUTO','anthropic',true);
  expect(r).not.toHaveProperty('tool_choice');expect(r.system[0].text).toBe('Stage prompt');
 });
});
describe('pre-migration complete request bytes',()=>{
 it('covers every former auto id plus forced controls in welcome/history',()=>{
  expect(fixtures).toHaveLength(48);expect(fixtures.filter(x=>x.choice==='AUTO')).toHaveLength(34);
 });
 it.each(fixtures)('$provider/$model welcome=$welcome remains byte-identical',async row=>{
  const args={provider:row.provider as AIProvider,model:row.model,toolChoice:row.choice as 'AUTO'|'FORCED',apiKey:row.provider==='bedrock'?JSON.stringify({accessKeyId:'SYNTHETIC2043',secretAccessKey:'synthetic-secret',region:'us-east-1'}):'SYNTHETIC2043',systemMessage:'Stage prompt',tools,messages:row.welcome?[]:[{role:'user' as const,content:'hello'}]};
  await callAgentChatLlm(args).catch(()=>{});
  expect(body).toBe(row.body);
 });
});
