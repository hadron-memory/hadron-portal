import {it,expect,vi} from 'vitest';
const request=vi.fn();vi.mock('$lib/server/api',()=>({gqlClient:()=>({request})}));
it('a startChat GraphQL fault keeps correlation without touching provider-error handling',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 request.mockRejectedValue({response:{errors:[{message:'SELECT secret FROM /srv/chat.ts',extensions:{code:'INTERNAL_SERVER_ERROR',requestId}}]}});
 const {POST}=await import('./+server');const r=await POST({request:new Request('http://localhost/api/agent-chat/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentId:'synthetic'})}),locals:{token:'synthetic'}} as never);
 expect(r.status).toBe(500);const body=await r.json();expect(body.error).toContain(requestId);expect(body.error).not.toContain('SELECT');
});
