import {afterEach,it,expect,vi} from 'vitest';
import {mountComponent,tick} from '$lib/test/mountComponent';
import {page,resetStubPage} from '$lib/test/stubs/app-stores';
import ErrorPage from './ErrorPage.svelte';
afterEach(()=>{resetStubPage();vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();});
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
// #1397: the page's own UUID check is defense-in-depth behind the server
// envelope's validation. A carrier that reached $page.error.requestId without
// being a UUIDv4 — a v1-shaped id, or any coerced string — must not render,
// and must not arm the id's hint or copy affordances.
it('never displays a malformed request id at status 500',async()=>{
 const malformed='a4451409-72f6-1f08-9b0b-f8db328e8c58';
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId:malformed})}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.textContent).not.toContain(malformed);expect(m.target.textContent).not.toContain('Include this ID');expect(m.target.querySelector('button[aria-label="Copy request ID"]')).toBeNull();}finally{m.unmount();}
});
// #1397: the fixed localized envelope already says "Something went wrong on
// our side." in the body; the heading must not repeat it, and must be the
// distinct server-failure heading (pinned positively — a heading that merely
// avoids the body words could say anything).
it('the 500 heading is the distinct server-failure heading, not the envelope body line',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.querySelector('h1')?.textContent).toBe('That didn’t work');expect(m.target.textContent).toContain('Something went wrong on our side.');}finally{m.unmount();}
});
// #1397: one clause telling the reader what the id is for.
it('tells the reader when to include the request id in a report',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.textContent).toContain('Include this ID if you report the problem.');}finally{m.unmount();}
});
// #1397: an explicit copy affordance beside the id, mirroring the Urn chip's
// (copyText, confirm state, plain-verb name). The button's accessible name is
// the static ACTION; the CONFIRM is announced by the polite status region —
// a mutating aria-label announces nothing on its own, and a silent icon swap
// says nothing to assistive tech. Both directions: the write happened AND the
// confirm was announced, then retracted after two seconds.
it('copies the request id and announces the confirm before resetting',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 const writeText=vi.fn(()=>Promise.resolve());
 vi.stubGlobal('navigator',{clipboard:{writeText}});
 vi.useFakeTimers();
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();const copy=m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy request ID"]');const status=()=>m.target.querySelector('span[role="status"]')?.textContent;expect(copy).not.toBeNull();expect(status()).toBe('');copy!.click();await vi.advanceTimersByTimeAsync(0);expect(writeText).toHaveBeenCalledWith(requestId);expect(copy!.getAttribute('aria-label')).toBe('Copy request ID');expect(status()).toBe('Copied');await vi.advanceTimersByTimeAsync(2000);expect(status()).toBe('');}finally{m.unmount();}
});
// #1397: copyText returns false when the clipboard refuses (no clipboard in
// a non-secure context, or a permission denial) — the icon must NOT swap to
// the confirm check, and the status region must say the copy failed with the
// selectable-text fallback cue. One-directional confirm tests pass on a path
// that confirms everything, so the refusal is pinned separately.
it('a refused copy says so through the status region and never confirms',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 const writeText=vi.fn(()=>Promise.reject(new Error('denied')));
 vi.stubGlobal('navigator',{clipboard:{writeText}});
 vi.useFakeTimers();
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();const copy=m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy request ID"]');const status=()=>m.target.querySelector('span[role="status"]')?.textContent;copy!.click();await vi.advanceTimersByTimeAsync(0);expect(writeText).toHaveBeenCalledWith(requestId);expect(status()).toBe('Copy failed — select the text to copy it.');expect(copy!.querySelector('polyline')).toBeNull();expect(copy!.querySelector('rect')).not.toBeNull();await vi.advanceTimersByTimeAsync(2000);expect(status()).toBe('');}finally{m.unmount();}
});
// #1397: a second copy restarts the two-second window — the first timer is
// cleared, not left to retract a confirm that just happened.
it('a second copy restarts the confirm window',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 const writeText=vi.fn(()=>Promise.resolve());
 vi.stubGlobal('navigator',{clipboard:{writeText}});
 vi.useFakeTimers();
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});try{await tick();const copy=m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy request ID"]');const status=()=>m.target.querySelector('span[role="status"]')?.textContent;copy!.click();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(1500);expect(status()).toBe('Copied');copy!.click();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(1500);expect(status()).toBe('Copied');await vi.advanceTimersByTimeAsync(500);expect(status()).toBe('');}finally{m.unmount();}
});
// #1397, the #782/#789 post-teardown class: a click whose copy settles after
// unmount must not arm a timer on dead state. The unmount happens BEFORE the
// copy promise resolves, so the continuation runs entirely post-teardown; the
// guard is what keeps it from arming (mutant-verified: removing the destroyed
// check makes this test fail by arming one timer).
it('a copy settling after unmount arms no timer',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 const writeText=vi.fn(()=>Promise.resolve());
 vi.stubGlobal('navigator',{clipboard:{writeText}});
 vi.useFakeTimers();
 const arm=vi.spyOn(globalThis,'setTimeout');
 page.update(p=>({...p,status:500,error:Object.assign(new Error('Something went wrong on our side.'),{requestId})}));
 const m=mountComponent(ErrorPage,{});
 await tick();
 m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy request ID"]')!.click();
 m.unmount();
 const armed=arm.mock.calls.length;
 await vi.advanceTimersByTimeAsync(0);
 expect(arm.mock.calls.length).toBe(armed);
});
// #1397: below 500 the body is route copy (routes throw error(401, 'Sign in
// to continue.') — normally pre-empted by the signin redirect, but the
// boundary must hold the register if one reaches it), so the heading stays
// neutral: "That didn't work" over an instruction to sign in reads like a
// failed action, not auth.
it('a 401 heading stays neutral over route copy',async()=>{
 page.update(p=>({...p,status:401,error:new Error('Sign in to continue.')}));
 const m=mountComponent(ErrorPage,{});try{await tick();expect(m.target.querySelector('h1')?.textContent).toContain('Something went wrong');expect(m.target.querySelector('h1')?.textContent).not.toContain('didn’t');expect(m.target.textContent).toContain('Sign in to continue.');}finally{m.unmount();}
});
