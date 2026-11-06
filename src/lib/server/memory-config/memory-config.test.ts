import { describe, expect, it, vi } from 'vitest';
import { loadRulebook, mutateRule, previewTemplate, applyTemplate, previewBulkTemplate, applyBulkTemplate } from './service';

const rule = { id: 'r1', role: 'review', revision: 7, enabled: true, locked: false, strictSubRoles: false, writers: 'ALL', validateBy: null, authorTask: null, authorTaskId: null, authorTaskState: 'NONE', validationTask: null, validationTaskId: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeId: null, descriptionNodeState: 'NONE', sourceTemplate: null };
const client = (request = vi.fn()) => ({ request });
describe('memory node-role configuration boundaries', () => {
  it.each(['reader', 'writer', 'org-admin-on-private'])('conceals a null config for %s without inventing authority', async () => {
    const c = client(vi.fn().mockResolvedValue({ memory: { config: null } }));
    expect(await loadRulebook(c, 'personal-memory')).toBeNull();
    expect(c.request).toHaveBeenCalledWith(expect.any(String), { ref: 'personal-memory' });
  });
  it('returns strict owner configuration from this request and sorts roles', async () => {
    const c = client(vi.fn().mockResolvedValue({ memory: { config: { id: null, rules: [{ ...rule, id: 'z', role: 'z' }, { ...rule, id: 'a', role: 'a' }] } } }));
    expect((await loadRulebook(c, 'mine'))?.rules.map(r => r.role)).toEqual(['a', 'z']);
  });
  it('does not share rulebooks between caller clients', async () => {
    const owner = client(vi.fn().mockResolvedValue({ memory: { config: { id: null, rules: [rule] } } }));
    const reader = client(vi.fn().mockResolvedValue({ memory: { config: null } }));
    await loadRulebook(owner, 'same');
    expect(await loadRulebook(reader, 'same')).toBeNull();
    expect(reader.request).toHaveBeenCalledTimes(1);
  });
  it.each(['create', 'update', 'delete', 'unlock'])('refuses impersonated %s before any request', async op => {
    const c = client();
    await expect(mutateRule(c, { impersonating: true, memoryRef: 'm', op, ref: 'r1', revision: 7, input: { role: 'review' } })).rejects.toThrow(/read.only/i);
    expect(c.request).not.toHaveBeenCalled();
  });
  it.each(['update', 'delete'])('pins expectedRevision on %s', async op => {
    const c = client(vi.fn().mockImplementation(async (q: string) => q.includes('deleteNodeRoleRule') ? { deleteNodeRoleRule: true } : { updateNodeRoleRule: { rule, warnings: [] } }));
    await mutateRule(c, { impersonating: false, memoryRef: 'm', op, ref: 'r1', revision: 7, input: { role: 'review', enabled: false } });
    expect(c.request.mock.calls[0][1]).toMatchObject({ ref: 'r1', expectedRevision: 7 });
    if (op === 'update') expect(c.request.mock.calls[0][1].input).not.toHaveProperty('role');
  });
  it('propagates RULE_LOCKED unchanged without guessing lock authority', async () => {
    const error = { response: { errors: [{ message: 'Only an org admin can unlock this rule.', extensions: { code: 'RULE_LOCKED' } }] } };
    const c = client(vi.fn().mockRejectedValue(error));
    await expect(mutateRule(c, { impersonating: false, memoryRef: 'm', op: 'unlock', ref: 'r1', revision: 7, input: {} })).rejects.toBe(error);
  });
  it('preview is dryRun and real apply binds the previewed template revision', async () => {
    const c = client(vi.fn().mockResolvedValue({ applyMemoryConfigTemplate: { memoryId: 'memory', templateRevision: 9, required: true, dryRun: true, entries: [], warnings: [] } }));
    const preview = await previewTemplate(c, 'template', 'memory', false);
    expect(c.request.mock.calls[0][1]).toEqual({ templateRef: 'template', memoryRef: 'memory', dryRun: true });
    await applyTemplate(c, 'template', 'memory', preview.templateRevision, false);
    expect(c.request.mock.calls[1][1]).toEqual({ templateRef: 'template', memoryRef: 'memory', dryRun: false, expectedTemplateRevision: 9 });
  });
  it('bulk preview is a dry run with no revision; bulk apply pins the revision and sends the list as given', async () => {
    const value = { dryRun: true, results: [], succeeded: 0, failed: 0 };
    const c = client(vi.fn().mockResolvedValue({ applyMemoryConfigTemplateToMemories: value }));
    expect(await previewBulkTemplate(c, 't', ['m1', 'm2'], false)).toBe(value);
    expect(c.request.mock.calls[0][0]).toContain('applyMemoryConfigTemplateToMemories');
    expect(c.request.mock.calls[0][1]).toEqual({ templateRef: 't', memoryRefs: ['m1', 'm2'], dryRun: true });
    await applyBulkTemplate(c, 't', ['m1', 'm2'], 9, false);
    expect(c.request.mock.calls[1][1]).toEqual({ templateRef: 't', memoryRefs: ['m1', 'm2'], dryRun: false, expectedTemplateRevision: 9 });
  });
  it('impersonation never bulk-previews or bulk-applies', async () => {
    const c = client();
    await expect(previewBulkTemplate(c, 't', ['m'], true)).rejects.toThrow(/read.only/i);
    await expect(applyBulkTemplate(c, 't', ['m'], 9, true)).rejects.toThrow(/read.only/i);
    expect(c.request).not.toHaveBeenCalled();
  });
  it('impersonation never previews or applies', async () => {
    const c = client();
    await expect(previewTemplate(c, 't', 'm', true)).rejects.toThrow(/read.only/i);
    await expect(applyTemplate(c, 't', 'm', 9, true)).rejects.toThrow(/read.only/i);
    expect(c.request).not.toHaveBeenCalled();
  });
});
