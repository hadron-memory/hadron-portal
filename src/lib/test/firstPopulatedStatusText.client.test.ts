import { describe, expect, it } from 'vitest';
import { announcedStatusRegion, firstPopulatedStatusText, idleStatusRegions } from './firstPopulatedStatusText';

const dom = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('firstPopulatedStatusText', () => {
  it('is null while every status region is idle (empty or whitespace)', () => {
    expect(firstPopulatedStatusText(dom('<div role="status"></div><div role="status">  \n </div>'))).toBeNull();
  });
  it('skips an empty region to find the one that is announcing', () => {
    expect(firstPopulatedStatusText(dom('<div role="status"></div><div role="status"><p> Saved. </p></div>'))).toBe('Saved.');
  });
  it('ignores alert regions and a page with no region', () => {
    expect(firstPopulatedStatusText(dom('<div role="alert">Failed</div>'))).toBeNull();
    expect(firstPopulatedStatusText(dom('<p>plain</p>'))).toBeNull();
  });

  it('idleStatusRegions + announcedStatusRegion pin a region that already existed', () => {
    const root = dom('<div role="status"></div>');
    const idle = idleStatusRegions(root);
    expect(idle).toHaveLength(1);
    idle[0].textContent = 'Saved.';
    expect(idle).toContain(announcedStatusRegion(root));
  });
  it('a region mounted afterwards is not among the idle ones', () => {
    const root = dom('<p>nothing yet</p>');
    const idle = idleStatusRegions(root);
    root.insertAdjacentHTML('beforeend', '<div role="status">Saved.</div>');
    expect(idle).not.toContain(announcedStatusRegion(root));
  });
});
