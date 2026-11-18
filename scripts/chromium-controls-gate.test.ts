import { describe, expect, it } from 'vitest';
import { chromiumControlsGate } from './chromium-controls-gate.mjs';

// portal#2185 blind F1: the dedicated CI step that runs the row-oracle native
// controls must never go green having skipped them. Locally (and in the early
// unit-test step, before the browser install) a missing Chromium still skips.
describe('chromiumControlsGate', () => {
  const present = () => '/browsers/chromium/chrome';
  const exists = (p: string) => p === '/browsers/chromium/chrome';

  it('runs when Chromium resolves and exists, required or not', () => {
    expect(chromiumControlsGate({ required: false, executablePath: present, exists })).toEqual({ mode: 'run' });
    expect(chromiumControlsGate({ required: true, executablePath: present, exists })).toEqual({ mode: 'run' });
  });

  it('skips a missing Chromium when the controls are not required', () => {
    expect(chromiumControlsGate({ required: false, executablePath: () => '/nowhere/chrome', exists })).toEqual({ mode: 'skip' });
  });

  it('fails by name, with the path, when required and the binary is missing', () => {
    const gate = chromiumControlsGate({ required: true, executablePath: () => '/nowhere/chrome', exists });
    expect(gate.mode).toBe('fail');
    expect(gate).toHaveProperty('reason', expect.stringContaining('/nowhere/chrome'));
  });

  it('treats a throwing executablePath as missing: skip when optional, fail when required', () => {
    const broken = () => { throw new Error('registry is broken'); };
    expect(chromiumControlsGate({ required: false, executablePath: broken, exists })).toEqual({ mode: 'skip' });
    const gate = chromiumControlsGate({ required: true, executablePath: broken, exists });
    expect(gate.mode).toBe('fail');
    expect(gate).toHaveProperty('reason', expect.stringContaining('registry is broken'));
  });
});
