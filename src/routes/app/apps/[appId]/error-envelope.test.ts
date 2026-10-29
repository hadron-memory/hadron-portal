import {it,expect,vi} from 'vitest';
const request=vi.fn();vi.mock('$lib/server/api',()=>({gqlClient:()=>({request})}));
const id='a4451409-72f6-4f08-b90b-f8db328e8c58';
const event=()=>({params:{appId:'a'},locals:{token:'synthetic',user:{id:'synthetic'}},url:new URL('http://localhost/app/apps/a'),depends:()=>{}} as never);
it.each(['INTERNAL_SERVER_ERROR','UNKNOWN_FAULT'])('a null App after %s is never a false not-found',async code=>{
 request.mockRejectedValue({response:{data:{app:null},errors:[{message:'SELECT private FROM /srv/apps.ts',extensions:{code,requestId:id}}]}});
 const {load}=await import('./+page.server');
 await expect(load!(event())).rejects.toMatchObject({status:500,body:{message:expect.not.stringContaining('SELECT'),...(code==='INTERNAL_SERVER_ERROR'?{requestId:id}:{})}});
});
it.each(['NOT_FOUND','FORBIDDEN'])('%s retains concealed absence and no request id',async code=>{
 request.mockRejectedValue({response:{data:{app:null},errors:[{message:'unavailable',extensions:{code,requestId:id}}]}});
 const {load}=await import('./+page.server');
 try{await load!(event());throw new Error('expected refusal');}catch(e){expect(e).toMatchObject({status:404});expect(JSON.stringify(e)).not.toContain(id);}
});
