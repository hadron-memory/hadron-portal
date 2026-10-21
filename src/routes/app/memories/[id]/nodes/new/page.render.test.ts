import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import Page from './+page.svelte';
import { createNodeSchema } from './schema';
vi.mock('$app/forms', () => ({enhance: () => ({})}));
vi.mock('$app/environment', () => ({browser: false, dev: false}));
vi.mock('$app/stores', async () => {
  const {readable} = await import('svelte/store');
  return {page: readable({url: new URL('http://localhost/app/memories/m1/nodes/new'), params: {id:'m1'}, data:{}, form:null})};
});
vi.mock('$app/navigation', () => ({beforeNavigate() {}, invalidateAll: vi.fn(), goto: vi.fn()}));
async function page(org: {id:string; name:string} | null = null) {
  const form = await superValidate({}, zod4(createNodeSchema), {errors: false});
  return render(Page, {props: {data: {graph:{id:'m1',name:'Test memory',urn:'hrn:mem:acme:docs',schema:null}, org, parentLoc:null, existingLocs:[],prefillLoc:'',form},form:null} as never});
}
describe('new-node navigation (#1167)', () => {
  it('sets its own title instead of keeping the previous node title', async () => {
    expect((await page()).head).toContain('New node');
  });
  it.each([null, {id:'o1',name:'Acme'}])('starts the breadcrumb with Memories', async org => {
    const {body} = await page(org);
    const trail = body.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(trail).not.toContain('Dashboard');
    expect(trail).toMatch(/title="Memories"/);
    expect(trail).toContain('Test memory');
    expect(trail).toContain('New node');
  });
});
