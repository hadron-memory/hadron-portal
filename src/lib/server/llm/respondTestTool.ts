import type { HadronTool } from './agentChatLlm';

/**
 * buildRespondToolSchema with an empty extraction spec, copied from
 * hadron-server 6c4adcc4e24e2bdffb8c87b69f60d2d84bd3dff6,
 * src/api/graphql/schema/resolvers.helpers.ts:3817-3855. No stage choices or
 * extraction fields are invented; both objects remain open as on the server.
 * The route's real-wire fixture independently pins this server snapshot.
 */
export const RESPOND_TEST_TOOLS: HadronTool[] = [{
  name: 'respond',
  description: 'Respond to the user and extract data',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Your response to the user' },
      data: { type: 'object', properties: {} },
      next_stage: { type: ['string', 'null'], description: 'Stage to transition to (null to stay in current stage)' },
      onTrack: { type: 'boolean', description: 'Is the current conversation/stage still the right fit for what the user is asking?' },
      offTrackReason: { type: 'string', description: 'If onTrack is false, explain why the conversation seems off-track' },
    },
    required: ['message', 'onTrack'],
  },
}];
