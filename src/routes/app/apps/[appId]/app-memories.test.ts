import { expect, it, vi } from 'vitest';
vi.mock('$lib/server/api', () => ({ gqlClient: vi.fn() }));
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import { canCreateAppMemory, readAppMemories } from './app-memories';
it.each(['OWNER','ADMIN','CONTRIBUTOR','READER'])('creation visibility follows the current user org role %s', role => {
 expect(canCreateAppMemory({members:[{role,user:{id:'me'}},{role:'OWNER',user:{id:'other'}}]},'me')).toBe(['OWNER','ADMIN'].includes(role));
});
it('fails closed without a known org membership or signed-in user',()=>{
 expect(canCreateAppMemory(null,'me')).toBe(false);
 expect(canCreateAppMemory({members:[{role:'OWNER',user:{id:'other'}}]},'me')).toBe(false);
 expect(canCreateAppMemory({members:[{role:'OWNER',user:{id:'me'}}]},null)).toBe(false);
});
it('drains a server-clamped list before filtering app-scoped memories',async()=>{
 const request=vi.fn().mockResolvedValueOnce({memories:{items:[{id:'other',appId:'elsewhere'}],total:2}}).mockResolvedValueOnce({memories:{items:[{id:'ours',appId:'a'}],total:2}});
 expect(await readAppMemories({request} as never,'o','a')).toEqual([{id:'ours',appId:'a'}]);
 expect(request.mock.calls.map(c=>c[1])).toEqual([{orgId:'o',limit:200,offset:0},{orgId:'o',limit:200,offset:1}]);
 expect(request.mock.calls[0][0]).toContain('memoryClasses: [app]');
});
it('reports a failed memory list instead of claiming it is empty',async()=>{
 expect(await readAppMemories({request:vi.fn().mockRejectedValue(new Error('offline'))} as never,'o','a')).toBeNull();
});
it('does not query unrelated memories for an org-less App',async()=>{
 const request=vi.fn();expect(await readAppMemories({request} as never,null,'a')).toEqual([]);expect(request).not.toHaveBeenCalled();
});

it('bounds an optional list outage instead of hanging the App page',async()=>{
 vi.useFakeTimers();
 try { const pending=readAppMemories({request:vi.fn(()=>new Promise(()=>{}))} as never,'o','a');
 await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS);expect(await pending).toBeNull();
 }finally{vi.useRealTimers();}
});
