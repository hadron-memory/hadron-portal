import {it,expect,vi} from 'vitest';
const request=vi.fn();vi.mock('$lib/server/api',()=>({gqlClient:()=>({request})}));
it('a deep invitation fault returns the fixed copy and server request id',async()=>{
 const id='a4451409-72f6-4f08-b90b-f8db328e8c58';
 request.mockRejectedValue({response:{errors:[{message:'SELECT private FROM /srv/users.ts',extensions:{code:'INTERNAL_SERVER_ERROR',requestId:id}}]}});
 const {actions}=await import('./+page.server');const fd=new FormData();fd.set('inviteEmail','synthetic@example.test');
 const result=await actions.invite!({request:{formData:async()=>fd},locals:{token:'synthetic'},url:new URL('http://localhost/app/account/invite')} as never) as any;
 expect(result.status).toBe(500);expect(result.data.form.message.text).toContain(id);expect(result.data.form.message.text).not.toContain('SELECT');
});
