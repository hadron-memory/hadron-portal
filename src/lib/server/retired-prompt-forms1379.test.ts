import { expect, it } from 'vitest';
import { agentSettingsSchema } from '../../routes/app/agents/[id]/schema';
import { appSettingsSchema, castWorkerSchema } from '../../routes/app/apps/[appId]/schema';
import { createAgentSchema } from '../../routes/app/orgs/[id]/agents/new/schema';
import { createChatbotSchema } from '../../routes/app/orgs/[id]/create-chatbot/schema';

it('#1379 schemas cannot default a removed prompt field into an unrelated save', () => {
  for (const schema of [agentSettingsSchema, appSettingsSchema, castWorkerSchema, createAgentSchema, createChatbotSchema]) {
    expect(Object.keys(schema.shape)).not.toContain('systemPrompt');
    expect(Object.keys(schema.shape)).not.toContain('promptOverride');
  }
});
