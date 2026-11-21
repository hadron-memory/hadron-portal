// portal#1686: mount one real Urn per compact call-site configuration collected by
// scripts/test-urn-compact-layout.mjs. The browser supplies the compiled app.css.
import { mount, type ComponentProps } from 'svelte';
import Urn from '$lib/components/Urn.svelte';

export type CompactUrnCase = {
  index: number;
  source: string;
  value: string;
  type?: ComponentProps<typeof Urn>['type'];
  size: number;
  linked: boolean;
  copyUrl: boolean;
  labelled: boolean;
};

export function mountCompactUrns(target: HTMLElement, cases: CompactUrnCase[]) {
  for (const testCase of cases) {
    const row = document.createElement('section');
    row.dataset.siteIndex = String(testCase.index);
    row.style.cssText = 'width: 240px; margin: 0 0 12px;';

    const source = document.createElement('div');
    source.textContent = `${testCase.index + 1}. ${testCase.source}${testCase.linked ? ' (linked)' : ''}`;
    source.style.cssText = 'margin-bottom: 4px; font: 10px monospace; overflow-wrap: anywhere;';
    const host = document.createElement('div');
    host.dataset.urnHost = '';
    row.append(source, host);
    target.append(row);

    mount(Urn, {
      target: host,
      props: {
        value: testCase.value,
        type: testCase.type,
        size: testCase.size,
        compact: true,
        linked: testCase.linked,
        copyUrl: testCase.copyUrl,
        label: testCase.labelled ? 'compact reference' : undefined,
      },
    });
  }
}
