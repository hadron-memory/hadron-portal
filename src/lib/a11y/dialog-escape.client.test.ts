/**
 * portal#1584 — unit pins for the shared dialog-Escape helpers (CLIENT lane:
 * they touch `window` and real KeyboardEvents). The guards live here once for
 * every picker: a `defaultPrevented` Escape and one during IME composition
 * close nothing; a plain Escape whose focus never entered the dialog closes
 * it; the fallback runs in CAPTURE phase so an earlier-registered window
 * BUBBLE listener never fires; suppression and teardown hold.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  consumeEscapeAtDialog,
  dialogEscapeFallback,
  escapeIsOurs,
} from './dialog-escape';

const escape = (init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });

describe('escapeIsOurs', () => {
  it('takes a plain Escape', () => {
    expect(escapeIsOurs(escape())).toBe(true);
  });
  it('refuses a non-Escape key, a consumed event, and an IME composition', () => {
    expect(escapeIsOurs(new KeyboardEvent('keydown', { key: 'Tab' }))).toBe(false);
    const consumed = escape();
    consumed.preventDefault();
    expect(escapeIsOurs(consumed)).toBe(false);
    expect(escapeIsOurs(escape({ isComposing: true }))).toBe(false);
  });
});

describe('consumeEscapeAtDialog (the dialog layer)', () => {
  it('consumes a plain Escape: prevent native close, stopPropagation, then close', () => {
    const close = vi.fn();
    const event = escape();
    consumeEscapeAtDialog(event, { close });
    expect(close).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true); // never send a native close request to an outer dialog
  });
  it('takes nothing when suppressed, consumed, or composing', () => {
    const close = vi.fn();
    consumeEscapeAtDialog(escape(), { close, suppressed: () => true });
    const consumed = escape();
    consumed.preventDefault();
    consumeEscapeAtDialog(consumed, { close });
    consumeEscapeAtDialog(escape({ isComposing: true }), { close });
    expect(close).not.toHaveBeenCalled();
  });
});

describe('dialogEscapeFallback (the window fallback)', () => {
  function arm(options: { close: () => void; suppressed?: () => boolean } = { close: () => {} }) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const action = dialogEscapeFallback(el, options);
    return { el, action, cleanup: () => { action.destroy(); el.remove(); } };
  }

  it('a plain Escape whose target is outside the dialog closes it, exactly once', () => {
    const close = vi.fn();
    const { cleanup } = arm({ close });
    try {
      document.body.dispatchEvent(escape());
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('an Escape already consumed (defaultPrevented) closes nothing', () => {
    const close = vi.fn();
    // "Someone else" is an earlier capture layer — same phase, registered
    // BEFORE the fallback, so its preventDefault lands first.
    const consumer = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', consumer, true);
    const { cleanup } = arm({ close });
    try {
      document.body.dispatchEvent(escape());
    } finally {
      cleanup();
      window.removeEventListener('keydown', consumer, true);
    }
    expect(close).not.toHaveBeenCalled();
  });

  it('an Escape during IME composition closes nothing', () => {
    const close = vi.fn();
    const { cleanup } = arm({ close });
    try {
      document.body.dispatchEvent(escape({ isComposing: true }));
      expect(close).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('an Escape targeted INSIDE the dialog is left to the dialog-level handler', () => {
    const close = vi.fn();
    const { el, cleanup } = arm({ close });
    try {
      el.dispatchEvent(escape());
      expect(close).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('runs in CAPTURE phase: an earlier-registered window bubble listener never fires', () => {
    const close = vi.fn();
    const above = vi.fn();
    window.addEventListener('keydown', above); // bubble, registered FIRST
    const { cleanup } = arm({ close });
    try {
      document.body.dispatchEvent(escape());
      expect(close).toHaveBeenCalledTimes(1);
      expect(above).not.toHaveBeenCalled();
    } finally {
      cleanup();
      window.removeEventListener('keydown', above);
    }
  });

  it('a caller-supplied condition stands the fallback down (the nested-picker exemption)', () => {
    const close = vi.fn();
    let nestedOpen = true;
    const { cleanup } = arm({ close, suppressed: () => nestedOpen });
    try {
      document.body.dispatchEvent(escape());
      expect(close).not.toHaveBeenCalled();
      nestedOpen = false; // read at event time, not at mount time
      document.body.dispatchEvent(escape());
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('teardown removes the listener — the half that ships defects', () => {
    const close = vi.fn();
    const { el, action } = arm({ close });
    action.destroy();
    el.remove();
    document.body.dispatchEvent(escape());
    expect(close).not.toHaveBeenCalled();
  });

  // #1584 fold: two dialogs that BOTH use the fallback, stacked, with focus
  // stranded on <body> (neither trap holds it). Capture listeners on window
  // fire in REGISTRATION order — the outer dialog's fallback armed FIRST runs
  // FIRST. Without a topmost rule the outer layer takes the key and closes
  // the host out from under a picker still open above it.
  describe('stacked fallbacks: last armed wins (#1584 fold)', () => {
    it('a body-focus Escape closes the INNER (last-armed) layer; the next press the outer', () => {
      const outerClose = vi.fn();
      const innerClose = vi.fn();
      const outer = arm({ close: outerClose }); // the host, armed when it opened
      const inner = arm({ close: innerClose }); // the picker it opened — armed later
      try {
        document.body.dispatchEvent(escape());
        expect(innerClose).toHaveBeenCalledTimes(1);
        expect(outerClose).not.toHaveBeenCalled();
        inner.cleanup(); // the picker unmounts ({#if} flips)
        document.body.dispatchEvent(escape());
        expect(outerClose).toHaveBeenCalledTimes(1);
      } finally {
        inner.cleanup();
        outer.cleanup();
      }
    });

    it('a retired layer stops deciding: after the inner unmounts, the outer owns the key', () => {
      const outerClose = vi.fn();
      const innerClose = vi.fn();
      const outer = arm({ close: outerClose });
      const inner = arm({ close: innerClose });
      inner.cleanup();
      try {
        document.body.dispatchEvent(escape());
        expect(innerClose).not.toHaveBeenCalled();
        expect(outerClose).toHaveBeenCalledTimes(1);
      } finally {
        outer.cleanup();
      }
    });
  });
});
