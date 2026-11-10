import { mount, unmount } from 'svelte';
import AppRunsPanel from '../../../routes/app/apps/[appId]/runs/AppRunsPanel.svelte';
export function mountAppRuns(target: HTMLElement, data: unknown) {
  const component = mount(AppRunsPanel, { target, props: { data: data as never, form: null } });
  return () => unmount(component);
}
