import { mount } from 'svelte';
import SelectApp from '$lib/components/SelectApp.svelte';
export function mountSelectApp(target: HTMLElement) {
  return mount(SelectApp, { target, props: {
    apps: [{ id: 'app-1', name: 'A long existing App name for a narrow viewport', urn: 'hrn:app:hadronmemory.com:long-existing-app-name' }],
    scopeKey: 'layout-test', open: true, onselect: () => {},
  } });
}
