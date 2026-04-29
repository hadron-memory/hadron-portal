import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, convertToModelMessages } from 'ai';
import { gqlClient } from '$lib/server/api';
import { APP_AI_CONFIG_QUERY } from '$lib/server/queries';
import type { RequestHandler } from './$types';
import type { AIProvider } from '$lib/types';

const BASE_SYSTEM_PROMPT = `You are Hadron Assistant — a helpful setup guide for Hadron, a knowledge graph platform that gives AI coding tools persistent memory across sessions.

You help users:
- Configure Hadron apps on their machines
- Set up MCP (Model Context Protocol) connections with AI tools
- Understand Hadron concepts: apps, agents, memories, and the knowledge graph
- Troubleshoot connection and configuration issues

## Key concepts
- **App**: A connection point for an AI tool (Claude Code, Cursor, Windsurf, etc.) to access Hadron's knowledge graph. Each app has an API key.
- **Agent**: Defines what memories an app can access and how. Apps subscribe to agents.
- **Memory**: A knowledge graph that stores context across sessions — decisions, architecture, learnings.
- **MCP**: The protocol AI tools use to communicate with Hadron. Apps expose an MCP endpoint.

## Setup modes
1. **Direct connection** — AI tool connects straight to the Hadron server via MCP config with a Bearer token.
2. **With Hadron Client App** — A local proxy (localhost:3200) that adds hooks for session tracking. Best for Claude Code.

## Setup steps (general)
1. Create an app on the Hadron portal
2. Subscribe the app to agents (which grant memory access)
3. Select your AI tool(s) and download the setup zip
4. Extract the zip in your project root
5. The zip contains MCP config files and instructions specific to your selected tools

## MCP tools available after setup
- h-start-session / h-end-session — Track work sessions
- h-find-node — Search nodes by name, tags, or description
- h-read-node — Read a node's full content and edges
- h-read-next-node — Navigate to the next sibling node
- h-create-node — Create or update a node
- h-update-node — Partially update a node
- h-move-node — Rename or move a node
- h-run-action — Load an action node and resolve dependencies
- h-validate — Validate graph structure
- h-sync-graph — Trigger a sync from the git source

## Tool-specific setup notes
- **Claude Code**: Config goes in \`.mcp.json\` (direct) or \`.claude/mcp.json\` (client app). Client app mode also adds hooks in \`.claude/settings.json\`.
- **Cursor**: Config goes in \`.cursor/mcp.json\`.
- **Windsurf**: Config goes in \`.windsurf/mcp.json\`.
- **Claude Desktop**: Config goes in \`claude_desktop_config.json\` (move to platform-specific location).
- **Codex CLI**: Config goes in \`.codex/mcp.json\`.
- **Cline**: Config goes in \`.cline/mcp.json\`.

## Client App setup (when using "With Hadron Client App")
1. Clone: git clone git@github.com:hadron-memory/hadron-client.git
2. Install: cd hadron-client && pnpm install && pnpm build
3. Init in project: node /path/to/hadron-client/dist/cli.js init
4. Start: node /path/to/hadron-client/dist/cli.js start (runs on port 3200)

Be concise and direct. Give step-by-step instructions when asked. If the user's app context is provided below, tailor your answers to their specific configuration.`;

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { messages, appId, systemPrompt } = await request.json();

  if (!appId) {
    return new Response(
      JSON.stringify({ error: 'appId is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Fetch the decrypted AI config from the backend
  let provider: string;
  let apiKey: string;
  let model: string;

  try {
    const result = await gqlClient(locals.token).request<{
      appAIConfig: { provider: string; apiKey: string; model: string } | null;
    }>(APP_AI_CONFIG_QUERY, { appId });

    if (!result.appAIConfig) {
      return new Response(
        JSON.stringify({ error: 'No AI configuration found for this app. Please save your API key first.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    provider = result.appAIConfig.provider;
    apiKey = result.appAIConfig.apiKey;
    model = result.appAIConfig.model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to fetch AI config';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const languageModel = createLanguageModel(provider as AIProvider, apiKey, model);
  if (!languageModel) {
    return new Response(
      JSON.stringify({ error: `Unsupported provider: ${provider}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const fullSystemPrompt = systemPrompt
    ? `${BASE_SYSTEM_PROMPT}\n\n## Current app context\n${systemPrompt}`
    : BASE_SYSTEM_PROMPT;

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: languageModel,
    system: fullSystemPrompt,
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
};

function createLanguageModel(provider: AIProvider, apiKey: string, model: string) {
  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(model);
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey });
      return openai(model);
    }
    case 'glm': {
      const glm = createOpenAI({
        apiKey,
        baseURL: 'https://api.z.ai/api/coding/paas/v4',
      });
      return glm.chat(model);
    }
    case 'bedrock': {
      // apiKey is JSON-encoded: {"accessKeyId":"...","secretAccessKey":"...","region":"us-east-1"}
      const creds = JSON.parse(apiKey) as { accessKeyId: string; secretAccessKey: string; region: string };
      const bedrock = createAmazonBedrock({
        region: creds.region,
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      });
      return bedrock(model);
    }
    default:
      return null;
  }
}
