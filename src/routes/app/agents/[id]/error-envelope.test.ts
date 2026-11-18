import {it,expect,vi} from 'vitest';
const request=vi.fn();vi.mock('$lib/server/api',()=>({gqlClient:()=>({request})}));
it('a loader generic fault preserves request id as error metadata without server prose',async()=>{
 const id='a4451409-72f6-4f08-b90b-f8db328e8c58';
 request.mockRejectedValue({response:{errors:[{message:'SELECT private FROM /srv/users.ts',extensions:{code:'INTERNAL_SERVER_ERROR',requestId:id}}]}});
 const {load}=await import('./+page.server');
 await expect(load!({params:{id:'a'},locals:{token:'synthetic'},url:new URL('http://localhost/app/agents/a')} as never)).rejects.toMatchObject({status:500,body:{requestId:id,message:expect.not.stringContaining('SELECT')}});
});
