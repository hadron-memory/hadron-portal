import { describe, expect, it } from 'vitest';
import { announcedStatusText } from './announcedStatusText';

const dom = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('announcedStatusText', () => {
  it('is null while every status region is idle (empty or whitespace)', () => {
    expect(announcedStatusText(dom('<div role="status"></div><div role="status">  \n </div>'))).toBeNull();
  });
  it('skips an empty region to find the one that is announcing', () => {
    expect(announcedStatusText(dom('<div role="status"></div><div role="status"><p> Saved. </p></div>'))).toBe('Saved.');
  });
  it('ignores alert regions and a page with no region', () => {
    expect(announcedStatusText(dom('<div role="alert">Failed</div>'))).toBeNull();
    expect(announcedStatusText(dom('<p>plain</p>'))).toBeNull();
  });
});
