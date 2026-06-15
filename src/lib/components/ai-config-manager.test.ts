import { describe, expect, it } from 'vitest';
import {
  isValidConfigName,
  encodeBedrockKey,
  resolveKeyInput,
  resolveApiKeyAction,
  parseParamsText,
} from './ai-config-manager';

describe('isValidConfigName', () => {
  it('accepts lower-case names with digits, dash and underscore', () => {
    expect(isValidConfigName('default')).toBe(true);
    expect(isValidConfigName('fast-2')).toBe(true);
    expect(isValidConfigName('a_b-3')).toBe(true);
    expect(isValidConfigName('a'.repeat(64))).toBe(true);
  });
  it('rejects empty, overlong, uppercase, spaces and symbols', () => {
    expect(isValidConfigName('')).toBe(false);
    expect(isValidConfigName('a'.repeat(65))).toBe(false);
    expect(isValidConfigName('Default')).toBe(false);
    expect(isValidConfigName('has space')).toBe(false);
    expect(isValidConfigName('bad!')).toBe(false);
  });
});

describe('encodeBedrockKey', () => {
  it('JSON-encodes the credential triple', () => {
    expect(JSON.parse(encodeBedrockKey('AKIA', 'secret', 'us-east-1'))).toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });
  });
});

describe('resolveKeyInput', () => {
  const base = { apiKey: '', bedrockAccessKeyId: '', bedrockSecretAccessKey: '', bedrockRegion: 'us-east-1' };

  it('returns the trimmed key for non-bedrock providers', () => {
    expect(resolveKeyInput({ ...base, provider: 'anthropic', apiKey: '  sk-x  ' })).toBe('sk-x');
  });
  it('returns "" when nothing is entered', () => {
    expect(resolveKeyInput({ ...base, provider: 'openai', apiKey: '   ' })).toBe('');
  });
  it('encodes the bedrock triple when a credential is present', () => {
    const out = resolveKeyInput({
      ...base,
      provider: 'bedrock',
      bedrockAccessKeyId: 'AKIA',
      bedrockSecretAccessKey: 'sec',
      bedrockRegion: 'eu-west-1',
    });
    expect(JSON.parse(out)).toEqual({ accessKeyId: 'AKIA', secretAccessKey: 'sec', region: 'eu-west-1' });
  });
  it('returns "" for bedrock when both credential fields are blank', () => {
    expect(resolveKeyInput({ ...base, provider: 'bedrock', bedrockAccessKeyId: '  ' })).toBe('');
  });
});

describe('resolveApiKeyAction', () => {
  it('clear wins even when a key was entered', () => {
    expect(resolveApiKeyAction({ removeKey: true, enteredKey: 'sk-x' })).toEqual({ apiKeyAction: 'clear' });
  });
  it('set when a key is entered', () => {
    expect(resolveApiKeyAction({ removeKey: false, enteredKey: 'sk-x' })).toEqual({
      apiKeyAction: 'set',
      apiKey: 'sk-x',
    });
  });
  it('keep when nothing is entered', () => {
    expect(resolveApiKeyAction({ removeKey: false, enteredKey: '' })).toEqual({ apiKeyAction: 'keep' });
  });
});

describe('parseParamsText', () => {
  it('treats empty/whitespace as null', () => {
    expect(parseParamsText('   ')).toEqual({ ok: true, value: null });
  });
  it('parses a JSON object', () => {
    expect(parseParamsText('{"maxTokens": 10}')).toEqual({ ok: true, value: { maxTokens: 10 } });
  });
  it('rejects arrays, primitives and null', () => {
    expect(parseParamsText('[1,2]').ok).toBe(false);
    expect(parseParamsText('42').ok).toBe(false);
    expect(parseParamsText('null').ok).toBe(false);
  });
  it('rejects invalid JSON', () => {
    expect(parseParamsText('{bad}').ok).toBe(false);
  });
});
