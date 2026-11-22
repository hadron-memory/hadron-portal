import {afterEach,it,expect,vi} from 'vitest';
import {mountComponent,tick} from '$lib/test/mountComponent';
import {page,resetStubPage} from '$lib/test/stubs/app-stores';
import ErrorPage from './ErrorPage.svelte';
afterEach(()=>{resetStubPage();vi.unstubAllGlobals();});
it('renders a generic error request id as selectable text outside the heading',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.textContent).toContain(requestId);expect(m.target.querySelector('h1')?.textContent).not.toContain(requestId);expect(m.target.querySelector('a')?.href).not.toContain(requestId);}finally{m.unmount();}
});
it('not-found never displays an error correlation id',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 page.update(p=>({...p,status:404,error:Object.assign(new Error('Not found'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.textContent).not.toContain(requestId);}finally{m.unmount();}
});
// #1397 (Ruth's pageNoIdCheck mutant): the page's own UUID check is
// defense-in-depth behind the server envelope's validation. A carrier that
// reached $page.error.requestId without being a UUIDv4 — a v1-shaped id, or
// any coerced string — must not render, and must not arm the id's hint or
// copy affordances.
it('never displays a malformed request id at status 500',async()=>{
 const malformed='a4451409-72f6-1f08-9b0b-f8db328e8c58';
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId:malformed})}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.textContent).not.toContain(malformed);expect(m.target.textContent).not.toContain('Include this ID');expect(m.target.querySelector('button[aria-label="Copy request ID"]')).toBeNull();}finally{m.unmount();}
});
// #1397 (Uma P3): the fixed localized envelope already says "Something went
// wrong on our side." in the body; the heading must not repeat it.
it('the 500 heading does not repeat the fixed envelope body line',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.querySelector('h1')?.textContent).not.toContain('Something went wrong');expect(m.target.textContent).toContain('Something went wrong on our side.');}finally{m.unmount();}
});
// #1397 (Uma P3): one clause telling the reader what the id is for.
it('tells the reader when to include the request id in a report',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.textContent).toContain('Include this ID if you report the problem.');}finally{m.unmount();}
});
// #1397 (Uma P3): an explicit copy affordance beside the id, mirroring the
// Urn chip's (copyText, confirm state on the button, plain-verb name).
it('copies the request id from the copy button',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 const writeText=vi.fn(()=>Promise.resolve());
 vi.stubGlobal('navigator',{clipboard:{writeText}});
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();const copy=m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy request ID"]');expect(copy).not.toBeNull();copy!.click();await tick();expect(writeText).toHaveBeenCalledWith(requestId);}finally{m.unmount();}
});
