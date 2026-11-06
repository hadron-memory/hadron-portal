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

describe('#1764 less-visible task warning boundary', () => {
  const warning = { code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask', taskUrn: 'hrn:node:acme.com:tasks:t', taskState: 'OK' };
  const warningSelection = (doc: string) => [...doc.matchAll(/warnings\s*\{([^}]*)\}/g)].map(m => m[1].split(/\s+/).filter(Boolean));
  it.each(['create', 'update'])('%s selects taskUrn and taskState on its warnings and returns them', async op => {
    const key = op === 'create' ? 'createNodeRoleRule' : 'updateNodeRoleRule';
    const c = client(vi.fn().mockResolvedValue({ [key]: { rule, warnings: [warning] } }));
    const out = await mutateRule(c, { impersonating: false, memoryRef: 'm', op, ref: 'r1', revision: 7, input: { role: 'review' } });
    for (const fields of warningSelection(c.request.mock.calls[0][0])) expect(fields).toEqual(expect.arrayContaining(['code', 'role', 'field', 'taskUrn', 'taskState']));
    expect(out).toEqual({ warnings: [warning] });
  });
  it('a save answering no warnings returns an empty list; a delete returns no warnings', async () => {
    const c = client(vi.fn().mockResolvedValueOnce({ createNodeRoleRule: { rule, warnings: [] } }).mockResolvedValueOnce({ deleteNodeRoleRule: true }));
    expect(await mutateRule(c, { impersonating: false, memoryRef: 'm', op: 'create', input: { role: 'review' } })).toEqual({ warnings: [] });
    expect(await mutateRule(c, { impersonating: false, memoryRef: 'm', op: 'delete', ref: 'r1', revision: 7, input: {} }) as object).not.toHaveProperty('warnings');
  });
  it('single and bulk apply select taskUrn and taskState on every warnings selection', async () => {
    const single = client(vi.fn().mockResolvedValue({ applyMemoryConfigTemplate: { memoryId: 'm', templateRevision: 9, required: false, dryRun: true, entries: [], warnings: [warning] } }));
    expect((await previewTemplate(single, 't', 'm', false)).warnings).toEqual([warning]);
    const bulk = client(vi.fn().mockResolvedValue({ applyMemoryConfigTemplateToMemories: { dryRun: true, results: [], succeeded: 0, failed: 0 } }));
    await previewBulkTemplate(bulk, 't', ['m'], false);
    for (const c of [single, bulk]) {
      const sets = warningSelection(c.request.mock.calls[0][0]);
      expect(sets.length).toBeGreaterThan(0);
      for (const fields of sets) expect(fields).toEqual(expect.arrayContaining(['taskUrn', 'taskState']));
    }
  });
});
