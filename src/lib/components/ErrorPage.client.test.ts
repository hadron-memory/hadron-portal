import {afterEach,it,expect} from 'vitest';
import {mountComponent,tick} from '$lib/test/mountComponent';
import {page,resetStubPage} from '$lib/test/stubs/app-stores';
import ErrorPage from './ErrorPage.svelte';
afterEach(()=>{resetStubPage();});
it('renders a generic error request id as selectable text outside the heading',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 page.update(p=>({...p,status:500,error:{message:'Something went wrong on our side.',requestId} as Error}));
 const m=mountComponent(ErrorPage);try{await tick();expect(m.target.textContent).toContain(requestId);expect(m.target.querySelector('h1')?.textContent).not.toContain(requestId);expect(m.target.querySelector('a')?.href).not.toContain(requestId);}finally{m.unmount();}
});
it('not-found never displays an error correlation id',async()=>{
 const requestId='a4451409-72f6-4f08-b90b-f8db328e8c58';
 page.update(p=>({...p,status:404,error:{message:'Not found',requestId} as Error}));
 const m=mountComponent(ErrorPage);try{await tick();expect(m.target.textContent).not.toContain(requestId);}finally{m.unmount();}
});
