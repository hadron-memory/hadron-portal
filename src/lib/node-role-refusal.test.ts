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
  const doors = [
    ['create', 'createTaskNode', 'create a runnable node'],
    ['update', 'updateTaskNode', 'update a runnable node'],
    ['create', 'createReviewNode', 'create a review node'],
    ['update', 'updateReviewNode', 'update a review node'],
    ['create', 'createSpecNode', 'create a specification node'],
    ['update', 'updateSpecNode', 'update a specification node'],
  ];
  const noRoute = 'Server refusal retained. There is no route from the portal for this operation.';
  // These adversarial extension shapes exercise the portal boundary, not a
  // claim that a healthy server emits malformed operation/door pairs.
  it.each(['create', 'update'].flatMap(op => [
    'createComment', 'constructor', '__proto__', 'toString', 'hasOwnProperty',
    '', 'createTaskNode ', null, undefined, 1, [], { secret: 'PRIVATE_DOOR' },
  ].map(door => ({ op, door }))))('does not route or echo an unmapped/prototype door ($op, $door)', ({ op, door }) => {
    expect(nodeRoleRefusalText(error({ code: 'ROLE_GOVERNED', op, door, mcpDoor: 'PRIVATE_MCP', locs: ['PRIVATE_LOC'] }))).toBe(noRoute);
  });
  it.each(['delete', 'restore'].flatMap(op => doors.map(([, door]) => ({ op, door }))))('ignores a write door mismatched with $op ($door)', ({ op, door }) => {
    expect(nodeRoleRefusalText(error({ code: 'ROLE_GOVERNED', op, door, mcpDoor: 'PRIVATE_MCP' }))).toBe(noRoute);
  });
  it.each([
    'overwrite', 'remove', 'future-operation', 'CREATE', '', null, undefined, 0, [], { secret: 'PRIVATE_OP' },
  ].flatMap(op => ['createTaskNode', 'updateReviewNode'].map(door => ({ op, door }))))('does not let a known door bypass an unsupported operation ($op, $door)', ({ op, door }) => {
    expect(nodeRoleRefusalText(error({ code: 'ROLE_GOVERNED', op, door, mcpDoor: 'PRIVATE_MCP' }))).toBe(noRoute);
  });
  it.each(doors)('preserves healthy %s guidance via %s', (op, door, action) => {
    expect(nodeRoleRefusalText(error({ code: 'ROLE_GOVERNED', op, door, mcpDoor: 'PRIVATE_MCP' })))
      .toBe(`Server refusal retained. This write needs the dedicated action to ${action}; ordinary Save cannot perform it.`);
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
