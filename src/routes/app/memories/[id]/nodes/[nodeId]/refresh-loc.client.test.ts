import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import RefreshNodeLoc from './RefreshNodeLoc.svelte';
const mounted: Mounted<Record<string,unknown>>[]=[];
afterEach(()=>{while(mounted.length)mounted.pop()!.unmount();vi.unstubAllGlobals();vi.useRealTimers();});
function setup(over:Record<string,unknown>={}){
 const onrefresh=vi.fn(); const props=reactiveProps({memoryId:'m',nodeId:'self',savedName:'Old',savedLoc:'p:old',name:'Foo',loc:'p:old',disabled:false,onrefresh,...over});
 const m=mountComponent(RefreshNodeLoc as never,props as never) as Mounted<Record<string,unknown>>;mounted.push(m);return{...m,props,onrefresh};
}
const button=(t:HTMLElement)=>t.querySelector<HTMLButtonElement>('button')!;
async function settle(){for(let i=0;i<10;i++)await tick();}
const result=()=>new Response(JSON.stringify({rows:[],hasMore:false}));
describe('#1902 Refresh request lifetime',()=>{
 it('does not read eagerly and applies a current result',async()=>{
  const fetcher=vi.fn().mockResolvedValue(result());vi.stubGlobal('fetch',fetcher);const m=setup();
  expect(fetcher).not.toHaveBeenCalled();button(m.target).click();await settle();expect(m.onrefresh).toHaveBeenCalledWith('p:foo');expect(button(m.target).disabled).toBe(false);
 });
 it.each(['name','loc','nodeId','disabled'])('ignores a late reply after %s changes',async field=>{
  let resolve!:(r:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(r=>resolve=r));vi.stubGlobal('fetch',fetcher);const m=setup();button(m.target).click();await tick();
  (m.props as Record<string,unknown>)[field]=field==='disabled'?true:'different';await tick();resolve(result());await settle();
  expect(m.onrefresh).not.toHaveBeenCalled();expect(m.target.querySelector('[role="alert"]')!.textContent).toBe('');
 });
 it('does not revive an abandoned request when the same editor values return',async()=>{
  let resolve!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>resolve=r)));
  const m=setup();button(m.target).click();await tick();m.props.name='Other';await tick();m.props.name='Foo';await tick();
  resolve(result());await settle();expect(m.onrefresh).not.toHaveBeenCalled();expect(button(m.target).disabled).toBe(false);
 });
 it('keeps a fresh return request when the displaced original reply arrives',async()=>{
  const replies:Array<(r:Response)=>void>=[];
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>replies.push(resolve))));
  const m=setup();button(m.target).click();await tick();
  m.props.name='Other';await tick();m.props.name='Foo';await tick();button(m.target).click();await tick();
  replies[0](result());await settle();expect(m.onrefresh).not.toHaveBeenCalled();expect(button(m.target).disabled).toBe(true);
  replies[1](result());await settle();expect(m.onrefresh).toHaveBeenCalledExactlyOnceWith('p:foo');expect(button(m.target).disabled).toBe(false);
 });
 it('never applies an old-mount reply to a remounted editor',async()=>{
  let resolve!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>resolve=r)));const old=setup();button(old.target).click();await tick();old.unmount();const fresh=setup();resolve(result());await settle();expect(old.onrefresh).not.toHaveBeenCalled();expect(fresh.onrefresh).not.toHaveBeenCalled();
 });
 it('shows only generic failure, keeps the draft and permits explicit retry',async()=>{
  const fetcher=vi.fn().mockRejectedValueOnce(new Error('private synthetic detail')).mockResolvedValueOnce(result());vi.stubGlobal('fetch',fetcher);const m=setup();button(m.target).click();await settle();
  expect(m.onrefresh).not.toHaveBeenCalled();expect(m.target.textContent).toContain('Could not check the new URN');expect(m.target.textContent).not.toContain('private synthetic detail');expect(button(m.target).disabled).toBe(false);
  button(m.target).click();await settle();expect(m.onrefresh).toHaveBeenCalledOnce();
 });
 it('expires at ten seconds, preserves the draft, and permits only an explicit retry (#1988)',async()=>{
  vi.useFakeTimers();
  let signal!:AbortSignal;
  const fetcher=vi.fn()
   .mockImplementationOnce((_url,init)=>new Promise<Response>((_resolve,reject)=>{
    signal=init.signal;
    signal.addEventListener('abort',()=>reject(new Error('synthetic private timeout detail')),{once:true});
   }))
   .mockImplementationOnce(async()=>result());
  vi.stubGlobal('fetch',fetcher);
  const m=setup();button(m.target).click();await settle();
  expect(fetcher).toHaveBeenCalledTimes(1);expect(button(m.target).disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(9_999);await settle();
  expect(signal.aborted).toBe(false);expect(button(m.target).disabled).toBe(true);
  expect(m.target.querySelector('[role="alert"]')!.textContent).toBe('');
  await vi.advanceTimersByTimeAsync(1);await settle();
  expect(signal.aborted).toBe(true);expect(m.onrefresh).not.toHaveBeenCalled();
  expect(m.props.name).toBe('Foo');expect(m.props.loc).toBe('p:old');
  expect(m.target.querySelector('[role="alert"]')!.textContent).toBe('Could not check the new URN. Try Refresh again, or edit the URN before saving.');
  expect(button(m.target).disabled).toBe(false);expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(20_000);await settle();expect(fetcher).toHaveBeenCalledTimes(1);
  button(m.target).click();await settle();
  expect(fetcher).toHaveBeenCalledTimes(2);expect(m.onrefresh).toHaveBeenCalledExactlyOnceWith('p:foo');
  expect(button(m.target).disabled).toBe(false);expect(m.target.querySelector('[role="alert"]')!.textContent).toBe('');
 });
 it('cancels its deadline on teardown',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))))));const m=setup();button(m.target).click();await tick();expect(vi.getTimerCount()).toBe(1);m.unmount();await settle();expect(vi.getTimerCount()).toBe(0);expect(m.onrefresh).not.toHaveBeenCalled();
 });
});
