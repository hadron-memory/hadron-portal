import { beforeEach, expect, it, vi } from 'vitest';
import { runChatTurn } from './agentChatTurn';
import { SEND_CHAT_MESSAGE_MUTATION, PROCESS_CHAT_RESPONSE_MUTATION } from '$lib/server/queries';
const request=vi.fn(), llm=vi.fn();
vi.mock('$lib/server/api',()=>({gqlClient:()=>({request})}));
vi.mock('./agentChatLlm.js',()=>({callAgentChatLlm:(...args:unknown[])=>llm(...args)}));
const tools=[{name:'respond',parameters:{type:'object'}}];
const prompt={systemMessage:'stage',tools,messageHistory:[],summarizationNeeded:null};
const processed={displayMessage:'hello',stageTransitioned:false,newStageName:null,conversationHandoff:null,chatEnded:false,onTrack:true,offTrackReason:null};
let decision:unknown, failure:unknown, order:string[];
beforeEach(()=>{
 decision='AUTO';failure=null;order=[];request.mockReset();llm.mockReset();
 request.mockImplementation(async(doc:string)=>{
  if(doc===SEND_CHAT_MESSAGE_MUTATION){order.push('send');return {sendChatMessage:prompt};}
  if(doc.includes('chatEffectiveToolChoice')){order.push('decision');if(failure)throw failure;return {chatEffectiveToolChoice:decision};}
  if(doc===PROCESS_CHAT_RESPONSE_MUTATION){order.push('process');return {processChatResponse:processed};}
  throw Error('Unexpected query');
 });
 llm.mockImplementation(async()=>{order.push('llm');return {respond:{message:'hello'},rawText:'hello'};});
});
const turn=(welcome=false)=>runChatTurn({token:'synthetic-session',agentId:'a',chatId:'c',userMessage:welcome?null:'hi',ai:{ok:true,ai:{provider:'anthropic',model:'opaque',apiKey:'SYNTHETIC'}},...(welcome?{startPayload:prompt}:{}),aiConfigChoice:'cfg-new'});
const oldServer=()=>Object.assign(new Error('GraphQL validation'),{response:{status:400,errors:[{message:'Cannot query field "chatEffectiveToolChoice" on type "Query".',extensions:{code:'GRAPHQL_VALIDATION_FAILED'}}]}});
it.each([false,true])('one decision per chat, welcome=%s',async welcome=>{
 await turn(welcome);
 const calls=request.mock.calls.filter(([doc])=>doc.includes('chatEffectiveToolChoice'));
 expect(calls).toHaveLength(1);expect(calls[0][1]).toEqual({chatId:'c'});
 expect(llm.mock.calls[0][0].toolChoice).toBe('AUTO');
 expect(order).toEqual(welcome?['decision','llm','process']:['send','decision','llm','process']);
});
it('null decision is forced',async()=>{decision=null;await turn();expect(llm.mock.calls[0][0].toolChoice).toBe('FORCED');});
it('an older server rejects the query, and only that absence degrades to forced',async()=>{failure=oldServer();await turn();expect(llm.mock.calls[0][0].toolChoice).toBe('FORCED');expect(order).toContain('decision');});
it.each(['chatNotFoundError','FORBIDDEN','UNAUTHENTICATED','INTERNAL_SERVER_ERROR'])('%s fails before any provider call',async code=>{
 failure=Object.assign(new Error('synthetic refusal'),{response:{errors:[{message:'Chat not found',extensions:{code}}]}});
 await expect(turn()).rejects.toBe(failure);expect(llm).not.toHaveBeenCalled();expect(order).not.toContain('process');
});
it('transport failures are not old-server absence',async()=>{failure=new Error('synthetic network failure');await expect(turn()).rejects.toBe(failure);expect(llm).not.toHaveBeenCalled();});
it('a mixed refusal is not swallowed with a missing-field error',async()=>{
 const e=oldServer();e.response.errors.push({message:'Forbidden',extensions:{code:'FORBIDDEN'}});failure=e;
 await expect(turn()).rejects.toBe(failure);expect(llm).not.toHaveBeenCalled();
});
