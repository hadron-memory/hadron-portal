import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import type { PortalExtension } from '$lib/ext/types';

// Both directions of the registry, per C2's hoisted holder: the tests hold in the private composed tree too.
const fx = vi.hoisted(() => ({ exts: [] as PortalExtension[] }));
vi.mock('$lib/ext/registry', async (orig) => {
  const real = await orig<typeof import('$lib/ext/registry')>();
  return {
    ...real,
    extensionLimitAction: (c: Parameters<typeof real.extensionLimitAction>[0]) => real.extensionLimitAction(c, fx.exts),
  };
});

import { limitRefusal } from './limit-refusal';

function refusal(extensions: Record<string, unknown>, message = 'The server says no.'): ClientError {
  return new ClientError({ status: 200, errors: [{ message, extensions }] } as never, { query: 'mutation {x}' });
}

const manager = {
  code: 'OWNER_LIMIT_REACHED',
  limitKey: 'memories',
  ownerType: 'organization',
  callerCanManageOwner: true,
  ownerId: 'o1',
  limit: '10',
};

function fixture(href = "/app/orgs/o1/x") {
  const limitAction = vi.fn((_ctx?: unknown) => ({ label: 'See limits', href }));
  fx.exts = [{ id: 'fx', limitAction }];
  return limitAction;
}

describe('limitRefusal (#2569, C3)', () => {
  beforeEach(() => {
    fx.exts = [];
  });

  it('gives 409 and the server text for OWNER_LIMIT_REACHED, 400 for NODE_CONTENT_TOO_LARGE', () => {
    expect(limitRefusal(refusal(manager, 'This organization has reached its limit of 10 memories.'))).toMatchObject({
      code: 'OWNER_LIMIT_REACHED',
      status: 409,
      text: 'This organization has reached its limit of 10 memories.',
    });
    expect(limitRefusal(refusal({ code: 'NODE_CONTENT_TOO_LARGE', maxBytes: 100 }, 'A node can hold at most 100 bytes.'))).toMatchObject({
      code: 'NODE_CONTENT_TOO_LARGE',
      status: 400,
      text: 'A node can hold at most 100 bytes.',
      action: null,
    });
  });

  it('answers null for every other code and for a transport failure', () => {
    for (const code of ['FORBIDDEN', 'INTERNAL_SERVER_ERROR', 'SOMETHING_NEW']) {
      expect(limitRefusal(refusal({ code }))).toBeNull();
    }
    expect(limitRefusal(new Error('socket hang up'))).toBeNull();
    expect(limitRefusal(undefined)).toBeNull();
  });

  it('offers the extension link on callerCanManageOwner: true, passing exactly the checked fields', () => {
    const limitAction = fixture();
    const r = limitRefusal(refusal(manager));
    expect(r?.action).toEqual({ label: 'See limits', href: '/app/orgs/o1/x' });
    expect(limitAction).toHaveBeenCalledWith({
      limitKey: 'memories',
      ownerType: 'organization',
      callerCanManageOwner: true,
      ownerId: 'o1',
    });
  });

  it('never calls the extension for a caller who cannot manage the owner', () => {
    const limitAction = fixture();
    const r = limitRefusal(
      refusal({ code: 'OWNER_LIMIT_REACHED', limitKey: 'memories', ownerType: 'organization', callerCanManageOwner: false }),
    );
    expect(r?.action).toBeNull();
    expect(r?.status).toBe(409);
    expect(limitAction).not.toHaveBeenCalled();
  });

  it.each([
    ['an ownerType that is neither', { ...manager, ownerType: 'team' }, '/app/x'],
    ['a missing ownerId while the caller can manage', { ...manager, ownerId: undefined }, '/app/x'],
    ['an empty ownerId', { ...manager, ownerId: '' }, '/app/x'],
    ['a string callerCanManageOwner', { ...manager, callerCanManageOwner: 'true' }, '/app/x'],
    ['a missing limitKey', { ...manager, limitKey: '' }, '/app/x'],
    ['an absolute extension href', manager, 'https://example.com/x'],
    ['a protocol-relative extension href', manager, '//example.com/x'],
    ['a backslash href a browser reads as //', manager, '/\\example.com'],
    ['a tab-prefixed href a browser reads as //', manager, '/\t/example.com'],
    ['an href with a newline', manager, '/a\nb'],
  ])('gives no link for %s, and still returns the text', (_name, ext, href) => {
    fixture(href);
    const r = limitRefusal(refusal(ext, 'text stays'));
    expect(r?.action).toBeNull();
    expect(r?.text).toBe('text stays');
    expect(r?.status).toBe(409);
  });

  it('shows the message alone in a public build (no extension)', () => {
    fx.exts = [];
    const r = limitRefusal(refusal(manager, 'plain'));
    expect(r).toMatchObject({ action: null, text: 'plain', status: 409 });
  });

  it('never carries the limit or the owner id into the result, nor into the extension call', () => {
    const limitAction = fixture();
    const r = limitRefusal(refusal(manager));
    expect(Object.keys(r ?? {}).sort()).toEqual(['action', 'code', 'status', 'text']);
    expect(Object.keys(limitAction.mock.calls[0][0] as object).sort()).toEqual(['callerCanManageOwner', 'limitKey', 'ownerId', 'ownerType']);
  });

  it('a throwing extension leaves the refusal as it was, without the link', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fx.exts = [{ id: 'fx', limitAction: () => { throw new Error('boom'); } }];
    expect(limitRefusal(refusal(manager, 'still here'))).toMatchObject({ status: 409, text: 'still here', action: null });
  });

  it('an empty server message gets a fixed fallback, never a blank form', () => {
    expect(limitRefusal(refusal(manager, ''))?.text).toBe('This account has reached a limit.');
    expect(limitRefusal(refusal({ code: 'NODE_CONTENT_TOO_LARGE' }, ''))?.text).toBe('This content is too large to save.');
  });

  it('an extension link with no label is dropped', () => {
    fx.exts = [{ id: 'fx', limitAction: () => ({ label: '', href: '/a' }) }];
    expect(limitRefusal(refusal(manager))?.action).toBeNull();
  });

  it('link: false never calls the extension', () => {
    const limitAction = fixture();
    expect(limitRefusal(refusal(manager), { link: false })).toMatchObject({ status: 409, action: null });
    expect(limitAction).not.toHaveBeenCalled();
  });

  it('limitMessage, limitBody and cloneRefusal carry the link through to the door result', async () => {
    fixture();
    const { limitMessage, limitBody } = await import('./limit-refusal');
    const { cloneRefusal } = await import('./clone-refusal');
    const link = { label: 'See limits', href: '/app/orgs/o1/x' };
    const r = limitRefusal(refusal(manager, 'm'))!;
    expect(limitMessage(r)).toEqual({ type: 'error', text: 'm', action: link });
    expect(limitBody(r)).toEqual({ error: 'm', code: 'OWNER_LIMIT_REACHED', action: link });
    expect(cloneRefusal(refusal(manager, 'm'))).toEqual({ status: 409, text: 'm', action: link });
  });
});
