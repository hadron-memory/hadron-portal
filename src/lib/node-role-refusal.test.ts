import { describe, expect, it } from 'vitest';
import { nodeRoleRefusalText, nodeWriteErrorText } from './node-role-refusal';
const error = (extensions: Record<string, unknown>) => ({ response: { errors: [{ message: 'Server refusal retained.', extensions }] } });
describe('shared node role recovery', () => {
  it.each(['delete', 'restore'])('%s offers no door even when supplied', op => {
    const text = nodeRoleRefusalText(error({ code: 'ROLE_GOVERNED', op, door: 'updateTaskNode', mcpDoor: 'hidden_tool' }));
    expect(text).toContain('Server refusal retained.');
    expect(text).toContain('no route from the portal');
    expect(text).not.toContain('dedicated action');
    expect(text).not.toContain('hidden_tool');
  });
  it.each(['create', 'update'])('%s describes the door action with null MCP door', op => {
    expect(nodeRoleRefusalText(error({ code: 'ROLE_GOVERNED', op, door: `${op}SpecNode`, mcpDoor: null }))).toContain(`${op} a specification node`);
  });
  it('never claims ADMIN for an unknown required level', () => {
    const text = nodeRoleRefusalText(error({ code: 'ROLE_WRITER_LEVEL_REQUIRED', role: 'review', ruleRole: 'task', level: 'FUTURE', side: 'after' }));
    expect(text).toContain('FUTURE'); expect(text).not.toContain('admins'); expect(text).not.toContain('Changing or clearing');
  });
  it('does not turn validation or attestation faults into role refusals', () => {
    for (const code of ['BAD_USER_INPUT', 'ATTESTATION_REQUIRED', 'ROLE_NOT_DECLARED_FUTURE']) expect(nodeRoleRefusalText(error({ code }))).toBeNull();
  });
  it('does not reveal unrelated extension facts or constructor text', () => {
    const text = nodeRoleRefusalText(error({ code: 'ROLE_NOT_DECLARED', role: 'review.x', strictParent: 'review', taskUrn: 'PRIVATE_TASK', config: 'PRIVATE_CONFIG' }));
    expect(text).not.toMatch(/PRIVATE_|Server refusal/);
  });
  it('malformed known fields do not echo wire text or stringify objects', () => {
    expect(nodeRoleRefusalText(error({ code: 'ROLE_NOT_DECLARED', role: { secret: 'x' }, strictParent: [] }))).toBe('Choose a declared sub-role or ask a manager of the memory.');
  });
  it('unknown codes retain the safe fallback', () => {
    expect(nodeWriteErrorText(error({ code: 'FUTURE', secret: 'x' }), 'fallback')).toBe('Something went wrong on our side.');
  });
});
