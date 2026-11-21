/**
 * portal#2344 / #2377: the Files tab's malware-scan note ('N file(s) are being scanned…') is
 * announced by a region that exists while nothing is pending, holds the note while a scan is
 * pending, and is the same element once the scan clears.
 */
import { afterEach, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import Page from './+page.svelte';

const asset = (id: string, scanStatus: string) => ({
  id, memoryId: 'mem-1', urn: `hrn:asset:acme:mem-1:${id}`, filename: `${id}.md`, mimeType: 'text/markdown',
  sizeBytes: 1024, uploadedAt: '2026-08-01T10:00:00.000Z', uploadedBy: null, scanStatus, description: null, publicUrl: null,
});
const data = (assets: unknown[]) => ({
  graph: { id: 'mem-1', name: 'Notes', acceptsUploads: true },
  assets, total: assets.length, truncated: false, failed: false, uploaderNames: {},
});

let m: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  m?.unmount();
  m = undefined;
});

it('the scan note is one persistent region: empty, then the note, then empty again', async () => {
  const props = reactiveProps({ data: data([asset('a', 'CLEAN')]) } as Record<string, unknown>);
  m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(3);

  const idle = idleStatusRegions(m.target);
  expect(idle.length).toBeGreaterThan(0);
  expect(announcedStatusRegion(m.target)).toBeNull();

  props.data = data([asset('a', 'CLEAN'), asset('b', 'PENDING')]);
  await tick(3);
  const during = announcedStatusRegion(m.target);
  expect(during?.textContent).toContain('being scanned for malware');
  expect(idle).toContain(during);

  props.data = data([asset('a', 'CLEAN'), asset('b', 'CLEAN')]);
  await tick(3);
  expect(announcedStatusRegion(m.target)).toBeNull();
  expect(during!.isConnected).toBe(true);
  expect(during!.textContent?.trim()).toBe('');
});
