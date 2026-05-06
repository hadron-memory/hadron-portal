import { describe, expect, it } from 'vitest';
import {
  ALLOWED_NODE_TYPES,
  DEFAULT_NODE_TYPE,
  NODE_TYPE_DESCRIPTIONS,
  isAllowedNodeType,
} from './nodeType-catalog';

describe('nodeType-catalog', () => {
  it('exposes exactly the four constitutional types in the canonical order', () => {
    expect(ALLOWED_NODE_TYPES).toEqual(['info', 'record', 'system', 'reference']);
  });

  it('defaults to info', () => {
    expect(DEFAULT_NODE_TYPE).toBe('info');
    expect(ALLOWED_NODE_TYPES.includes(DEFAULT_NODE_TYPE)).toBe(true);
  });

  it('has a non-empty English description for every allowed type', () => {
    for (const type of ALLOWED_NODE_TYPES) {
      expect(NODE_TYPE_DESCRIPTIONS[type]).toBeTruthy();
      expect(NODE_TYPE_DESCRIPTIONS[type].length).toBeGreaterThan(10);
    }
  });

  it('disclaims system and record as typically system-managed', () => {
    expect(NODE_TYPE_DESCRIPTIONS.system.toLowerCase()).toContain('system-managed');
    expect(NODE_TYPE_DESCRIPTIONS.record.toLowerCase()).toContain('system-managed');
  });

  describe('isAllowedNodeType', () => {
    it('accepts each canonical type', () => {
      for (const type of ALLOWED_NODE_TYPES) {
        expect(isAllowedNodeType(type)).toBe(true);
      }
    });

    it('rejects MCP-layer guided types not in the constitutional catalog', () => {
      expect(isAllowedNodeType('task')).toBe(false);
      expect(isAllowedNodeType('data')).toBe(false);
      expect(isAllowedNodeType('chat')).toBe(false);
      expect(isAllowedNodeType('plan')).toBe(false);
      expect(isAllowedNodeType('parent')).toBe(false);
    });

    it('rejects empty / non-string values', () => {
      expect(isAllowedNodeType('')).toBe(false);
      expect(isAllowedNodeType(undefined)).toBe(false);
      expect(isAllowedNodeType(null)).toBe(false);
      expect(isAllowedNodeType(0)).toBe(false);
      expect(isAllowedNodeType({ type: 'info' })).toBe(false);
    });

    it('is case-sensitive (the canonical names are lowercase)', () => {
      expect(isAllowedNodeType('Info')).toBe(false);
      expect(isAllowedNodeType('INFO')).toBe(false);
    });
  });
});
