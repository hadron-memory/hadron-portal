import { afterEach, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });
it('renders inherited Markdown with the node sanitizer and updates reused views', async () => {
  const props = reactiveProps({ data: {
    agent: { id: 'child', name: 'Child', urn: 'hrn:agent:example.com:child', systemMemoryId: 'child-memory' },
    node: { id: 'node', name: 'Ship', loc: 'tasks:ship', urn: 'hrn:node:example.com:base:tasks:ship', content: '## Steps\n\n1. **Review**\n\n| Severity | Meaning |\n| --- | --- |\n| P1 | Broken |\n\n<script>danger()</script><style>body { display:none }</style><div class="fixed inset-0" style="position:fixed;color:red">Safe formatting</div><form method="POST" action="?/delete"><button>Submit</button></form>', inheritedFrom: { agentId: 'base', agentUrn: 'hrn:agent:example.com:base' } },
    register: { kind: 'unavailable' },
  } });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  const root = mounted.target;
  expect(root.querySelector('h2')?.textContent).toBe('Steps');
  expect(root.querySelector('ol strong')?.textContent).toBe('Review');
  expect(root.querySelector('td')?.textContent).toBe('P1');
  expect(root.querySelector('script, style, form')).toBeNull();
  const content = root.querySelector('.prose')!;
  expect(content.querySelector('.fixed')).toBeNull();
  expect(content.querySelector('[style]')?.getAttribute('style')).not.toContain('position');
  expect(content.querySelector('button')).toBeNull();
  props.data = { ...props.data, node: { ...props.data.node, content: '## Changed\n\nNew **body**' } };
  flushSync(); await tick();
  expect(root.querySelector('h2')?.textContent).toBe('Changed');
  expect(root.textContent).not.toContain('Steps');
});
