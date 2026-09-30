import { describe, expect, it } from 'vitest';
import {
  isValidConfigName,
  encodeBedrockKey,
  resolveKeyInput,
  resolveApiKeyAction,
  parseParamsText,
  apiStyleApplies,
  endpointRequired,
  keyRequired,
  fieldChange,
  endpointShapeError,
  inlineTestable,
  testOverrideKey,
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

describe('server#1373 / #1390 rules, mirrored', () => {
  it('apiStyle applies to the OpenAI-style providers only', () => {
    expect(['openai', 'glm', 'openai-compatible'].every(apiStyleApplies)).toBe(true);
    expect(apiStyleApplies('anthropic')).toBe(false);
    expect(apiStyleApplies('bedrock')).toBe(false);
  });

  it('only openai-compatible requires an endpoint', () => {
    expect(endpointRequired('openai-compatible')).toBe(true);
    expect(endpointRequired('glm')).toBe(false);
  });

  it('every tenant config needs its own key (#1390)', () => {
    for (const ownerType of ['ORGANIZATION', 'APP', 'AGENT']) {
      for (const provider of ['openai', 'anthropic', 'bedrock', 'glm', 'openai-compatible']) {
        expect(keyRequired({ ownerType, provider, endpoint: '' })).toBe(true);
      }
    }
  });

  it('the platform config may go keyless only at a credential-issuing default host', () => {
    expect(keyRequired({ ownerType: 'HADRON_SERVER', provider: 'openai', endpoint: '' })).toBe(false);
    expect(keyRequired({ ownerType: 'HADRON_SERVER', provider: 'anthropic', endpoint: ' ' })).toBe(false);
    expect(keyRequired({ ownerType: 'HADRON_SERVER', provider: 'glm', endpoint: '' })).toBe(true);
    expect(keyRequired({ ownerType: 'HADRON_SERVER', provider: 'openai', endpoint: 'https://proxy.example.com' })).toBe(true);
  });

  it('fieldChange speaks the update grammar: unchanged, clear, set', () => {
    expect(fieldChange('https://a.example', 'https://a.example')).toBeUndefined();
    expect(fieldChange(null, '')).toBeUndefined();
    expect(fieldChange(null, '  ')).toBeUndefined();
    expect(fieldChange('https://a.example', '')).toBeNull();
    expect(fieldChange(null, ' https://b.example ')).toBe('https://b.example');
  });

  it('endpointShapeError: empty is fine, a full http(s) URL is fine, anything else is not', () => {
    expect(endpointShapeError('')).toBeNull();
    expect(endpointShapeError('https://llm.example.com/v1')).toBeNull();
    expect(endpointShapeError('http://10.0.0.5:8000/v1')).toBeNull(); // the server decides private hosts
    expect(endpointShapeError('llm.example.com')).toMatch(/full URL/);
    expect(endpointShapeError('ftp://llm.example.com')).toMatch(/https/);
  });

  it('inlineTestable: only built-in hosts the portal client reaches the way a run does', () => {
    expect(inlineTestable({ provider: 'anthropic', endpoint: '', apiStyle: '' })).toBe(true);
    expect(inlineTestable({ provider: 'openai', endpoint: '', apiStyle: '' })).toBe(true);
    expect(inlineTestable({ provider: 'glm', endpoint: '', apiStyle: '' })).toBe(false);
    expect(inlineTestable({ provider: 'openai-compatible', endpoint: 'https://x.example', apiStyle: '' })).toBe(false);
    expect(inlineTestable({ provider: 'openai', endpoint: 'https://x.example', apiStyle: '' })).toBe(false);
    expect(inlineTestable({ provider: 'openai', endpoint: '', apiStyle: 'RESPONSES' })).toBe(false);
  });
});

describe('testOverrideKey (Test follows Save)', () => {
  it('"Remove the stored key" wins over a typed key, as it does on Save', () => {
    expect(testOverrideKey({ removeKey: true, enteredKey: 'sk-new' })).toBeNull();
    expect(testOverrideKey({ removeKey: true, enteredKey: '' })).toBeNull();
  });
  it('a typed key is tested; nothing typed keeps the stored key (omitted)', () => {
    expect(testOverrideKey({ removeKey: false, enteredKey: 'sk-new' })).toBe('sk-new');
    expect(testOverrideKey({ removeKey: false, enteredKey: '' })).toBeUndefined();
  });
});
