import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// portal#2454: the pins elsewhere assert the class a LiveRegion carries, not that Tailwind defines the variant. An
// undefined `idle` variant would leave `idle:absolute` a silent no-op, so the definition is pinned here.
it('app.css defines the idle variant as :empty or [data-idle]', () => {
  const css = readFileSync('src/app.css', 'utf8');
  expect(css).toMatch(/@custom-variant\s+idle\s*\(\s*&:is\(\s*:empty\s*,\s*\[data-idle\]\s*\)\s*\)/);
});
