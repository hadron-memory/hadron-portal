/**
 * #1137 — the team chat's team filter, mounted.
 *
 * CLIENT lane: what matters is what the thread RENDERS and ASKS FOR as a filter
 * and the props change around it. The filter is read by the server and arrives
 * as new props; nothing here may filter rows the component already holds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import type { TeamChatFilter } from '$lib/team-chat-filter';
import type { TeamChatMessage } from '$lib/types';
import TeamChatThread from './TeamChatThread.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  Reflect.deleteProperty(document, 'hidden');
  vi.useRealTimers();
});

const message = (seq: number, over: Partial<TeamChatMessage> = {}): TeamChatMessage => ({
  nodeId: `m${seq}`,
  seq,
  body: `body ${seq}`,
  at: '2026-10-27T12:00:00.000Z',
  authorUserId: null,
  authorWorkerId: 'w1',
  authorName: 'Ada',
  sessionId: null,
  replyToSeq: null,
  mentions: [],
  urn: null,
  teamTags: null,
  ...over,
});
const ADA = { headId: 'head-ada', label: 'team.ada' };
const BO = { headId: 'head-bo', label: 'team.bo' };

async function mountThread(props: Record<string, unknown>) {
  setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
  // Assigned onto the SAME object rather than spread into a copy: a copy would
  // freeze the values, and the reactive-props tests below change them.
  props.postForm = await superValidate(zod4(postTeamChatMessageSchema), { errors: false });
  const m = mountComponent(TeamChatThread as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m;
}
const q = (m: Mounted<Record<string, unknown>>, id: string) => m.target.querySelector(`[data-testid="${id}"]`);
const qa = (m: Mounted<Record<string, unknown>>, id: string) => Array.from(m.target.querySelectorAll(`[data-testid="${id}"]`));


describe('portal#1410 chip feedback and refusal polling', () => {
 const refused = { code:'TEAM_CHAT_TEAM_HEAD_INVALID', message:'Team broadcast target is unavailable in this Channel.' };
 it('never polls an initial refusal, including a visible-again tick; explicit healthy filter changes resume', async () => {
  Object.defineProperty(document,'hidden',{configurable:true,value:false}); vi.useFakeTimers();
  const onRefresh=vi.fn(async()=>({items:[message(2)],total:1,loadFailed:false}));
  const props=reactiveProps<Record<string,unknown>>({messages:[],total:0,loadError:true,refusal:refused,filter:{kind:'team',headRef:'gone'},onRefresh,pollMs:100,onSelectTeam:vi.fn()});
  await mountThread(props);
  await vi.advanceTimersByTimeAsync(300);
  document.dispatchEvent(new Event('visibilitychange')); await tick(3);
  expect(onRefresh).not.toHaveBeenCalled();
  props.filter={kind:'none'}; props.refusal=null; props.loadError=false; props.messages=[message(1)];
  await tick(3); await vi.advanceTimersByTimeAsync(100);
  expect(onRefresh).toHaveBeenCalledTimes(1);
 });
 it('a transient initial failure still recovers by polling, unlike an authoritative refusal', async()=>{
  Object.defineProperty(document,'hidden',{configurable:true,value:false});vi.useFakeTimers();
  const onRefresh=vi.fn(async()=>({items:[message(2)],total:1,loadFailed:false}));
  const m=await mountThread({messages:[],loadError:true,onRefresh,pollMs:100});
  await vi.advanceTimersByTimeAsync(100);await tick(3);
  expect(onRefresh).toHaveBeenCalledTimes(1);expect(m.target.textContent).toContain('body 2');
 });
 it('moves focus to the applied filter and announces it, preserving head identity',async()=>{
  const props=reactiveProps<Record<string,unknown>>({messages:[message(1,{teamTags:[ADA]})],total:1,filter:{kind:'none'}});
  const select=vi.fn((next:TeamChatFilter)=>{props.filter=next;});props.onSelectTeam=select;
  const m=await mountThread(props);document.body.append(m.target);
  const chip=q(m,'team-chat-tag') as HTMLButtonElement;chip.focus();chip.click();await tick(4);
  expect(select).toHaveBeenCalledWith({kind:'team',headRef:ADA.headId});
  expect(document.activeElement).toBe(q(m,'team-chat-filter-active'));
  expect(q(m,'team-chat-filter-status')?.getAttribute('aria-live')).toBe('polite');
  expect(q(m,'team-chat-filter-status')?.textContent).toContain('team.ada');
  expect(q(m,'team-chat-filter-active')?.hasAttribute('title')).toBe(false);
  const all=[...q(m,'team-chat-filter')!.querySelectorAll('button')].find(b=>b.textContent?.includes('All messages'))!;
  all.click();await tick(4);expect(document.activeElement).toBe(all);
  expect(q(m,'team-chat-filter-status')?.textContent).toContain('All messages');
 });
 it('gives guidance, a non-colour selected cue, plain empty copy and a refusal next step',async()=>{
  const m=await mountThread({messages:[],filter:{kind:'untagged'},onSelectTeam:vi.fn()});
  expect(q(m,'team-chat-filter')?.textContent).toContain('Choose a team by clicking a tag on a message.');
  expect(q(m,'team-chat-filter-empty')?.textContent).toContain('Every message in this view has a team tag.');
  const selected=q(m,'team-chat-filter')?.querySelector('[aria-pressed="true"]');
  expect(selected?.querySelector('[data-selected-cue]')).not.toBeNull();
  const r=await mountThread({messages:[],loadError:true,refusal:refused,filter:{kind:'team',headRef:'gone'},onSelectTeam:vi.fn()});
  expect(q(r,'team-chat-filter-refused')?.textContent).toBe(refused.message);
  expect(q(r,'team-chat-filter-refused-help')?.textContent).toContain('Choose All messages');
 });
});
