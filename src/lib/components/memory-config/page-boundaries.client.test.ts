import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { memoryConfigLifecycle, resetMemoryConfigLifecycle } from '$lib/test/memory-config-lifecycle';
import UnguardedPage from '$lib/test/fixtures/MemoryConfigUnguardedPage.svelte';
import AccountPage from '../../../routes/app/account/node-role-templates/+page.svelte';
import OrgPage from '../../../routes/app/orgs/[id]/node-role-templates/+page.svelte';
import AppPage from '../../../routes/app/apps/[appId]/AppNodeRoleTemplates.svelte';
import MemoryPage from '../../../routes/app/memories/[id]/settings/node-roles/+page.svelte';

vi.mock('$lib/components/memory-config/TemplatesManager.svelte', async () => ({
  default: (await import('$lib/test/fixtures/MemoryConfigChildRecorder.svelte')).default,
}));
vi.mock('$lib/components/memory-config/RulebookManager.svelte', async () => ({
  default: (await import('$lib/test/fixtures/MemoryConfigChildRecorder.svelte')).default,
}));

const cases = [
  { name: 'account', component: AccountPage, kind: 'templates', ownerType: 'USER' },
  { name: 'organization', component: OrgPage, kind: 'templates', ownerType: 'ORGANIZATION' },
  { name: 'App', component: AppPage, kind: 'templates', ownerType: 'APP' },
  { name: 'memory', component: MemoryPage, kind: 'rules', ownerType: undefined },
] as const;

const mounted: Array<Mounted<Record<string, unknown>>> = [];

beforeEach(() => {
  resetMemoryConfigLifecycle();
});

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function dataFor(kind: 'templates' | 'rules', ownerType?: 'USER' | 'ORGANIZATION' | 'APP') {
  return kind === 'templates'
    ? {
        principalScope: 'user-1:self', ownerType, ownerRef: 'resource-a', templates: [],
        canManage: true, readOnly: false, memories: [], memoriesFailed: false,
      }
    : {
        principalScope: 'user-1:self', memoryRef: 'resource-a', config: null,
        readOnly: false, memories: [], memoriesFailed: false,
      };
}

function recorder(target: HTMLElement) {
  const el = target.querySelector<HTMLElement>('[data-testid="memory-config-recorder"]');
  expect(el).not.toBeNull();
  return el!;
}

function mountId(target: HTMLElement) {
  const id = Number(recorder(target).getAttribute('data-mount-id'));
  expect(id).toBeGreaterThan(0);
  return id;
}

function expectRemount(target: HTMLElement, previous: number) {
  const next = mountId(target);
  expect(next).not.toBe(previous);
  expect(memoryConfigLifecycle).toContainEqual({ type: 'destroy', id: previous });
  expect(memoryConfigLifecycle).toContainEqual({ type: 'mount', id: next });
  expect(recorder(target).getAttribute('data-draft')).toBe('pristine');
}

describe('memory-config principal/resource keyed pages (#1749 B1)', () => {
  it('unguarded control: the same recorder retains the old draft when no key remounts it', () => {
    let data = { principalScope: 'user-1:self' };
    const props = reactiveProps<Record<string, unknown>>({ data });
    const m = mountComponent(UnguardedPage as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);

    const initial = mountId(m.target);
    recorder(m.target).click();
    flushSync();
    data = { principalScope: 'user-2:self' };
    props.data = data;
    flushSync();

    expect(m.target.querySelector('[data-principal-scope]')!.getAttribute('data-principal-scope')).toBe('user-2:self');
    expect(mountId(m.target)).toBe(initial);
    expect(recorder(m.target).getAttribute('data-draft')).toBe('edited');
    expect(memoryConfigLifecycle).not.toContainEqual({ type: 'destroy', id: initial });
  });

  it.each(cases)('$name destroys old drafts on principal/resource changes and preserves ordinary same-key state', ({ component, kind, ownerType }) => {
    let data: Record<string, unknown> = dataFor(kind, ownerType);
    const props = reactiveProps<Record<string, unknown>>({ data });
    const m = mountComponent(component as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);

    const initial = mountId(m.target);
    recorder(m.target).click();
    flushSync();
    expect(recorder(m.target).getAttribute('data-draft')).toBe('edited');

    const eventCount = memoryConfigLifecycle.length;
    data = { ...data, readOnly: true, memoriesFailed: true };
    props.data = data;
    flushSync();
    expect(mountId(m.target)).toBe(initial);
    expect(recorder(m.target).getAttribute('data-draft')).toBe('edited');
    expect(memoryConfigLifecycle).toHaveLength(eventCount);

    data = { ...data, principalScope: 'user-2:self' };
    props.data = data;
    flushSync();
    expectRemount(m.target, initial);

    const userMount = mountId(m.target);
    recorder(m.target).click();
    flushSync();
    data = { ...data, principalScope: 'user-2:impersonation-session' };
    props.data = data;
    flushSync();
    expectRemount(m.target, userMount);

    const sessionMount = mountId(m.target);
    recorder(m.target).click();
    flushSync();
    data = {
      ...data,
      ...(kind === 'templates' ? { ownerRef: 'resource-b' } : { memoryRef: 'resource-b' }),
    };
    props.data = data;
    flushSync();
    expectRemount(m.target, sessionMount);
  });
});
