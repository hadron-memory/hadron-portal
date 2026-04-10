/**
 * Pong document upload. Accepts a file (multipart/form-data), extracts text,
 * and stores it as a knowledge node in the station's hadron memory.
 *
 * Supported formats: .txt, .md, .csv, .html/.htm, .json, plus any other file
 * that decodes as readable text.
 */

import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ADD_PONG_KNOWLEDGE_MUTATION } from '$lib/server/queries';
import type { PongKnowledge } from '$lib/types';
import type { RequestHandler } from './$types';

const MAX_LENGTH = 50_000;

async function extractText(file: File): Promise<{ content: string } | { error: string }> {
  const filename = file.name.toLowerCase();

  if (filename.endsWith('.txt') || filename.endsWith('.md') || filename.endsWith('.csv')) {
    return { content: await file.text() };
  }

  if (filename.endsWith('.html') || filename.endsWith('.htm')) {
    const html = await file.text();
    const content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    return { content };
  }

  if (filename.endsWith('.json')) {
    const raw = await file.text();
    try {
      return { content: JSON.stringify(JSON.parse(raw), null, 2) };
    } catch {
      return { content: raw };
    }
  }

  try {
    const content = await file.text();
    const nonPrintable = content.slice(0, 1000).split('').filter((c) => {
      const code = c.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }).length;
    if (nonPrintable > 50) {
      return { error: `Unsupported file format: ${file.name}. Please upload a text file (.txt, .md, .csv, .html, .json).` };
    }
    return { content };
  } catch {
    return { error: `Could not read file: ${file.name}. Please upload a text-based file.` };
  }
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const connectionId = formData.get('connectionId');
  const docType = formData.get('docType');
  const titleOverride = formData.get('title');

  if (!file) return json({ error: 'No file provided' }, { status: 400 });
  if (typeof connectionId !== 'string' || !connectionId) {
    return json({ error: 'connectionId is required' }, { status: 400 });
  }

  const extracted = await extractText(file);
  if ('error' in extracted) return json({ error: extracted.error }, { status: 400 });

  const content = extracted.content.length > MAX_LENGTH
    ? extracted.content.slice(0, MAX_LENGTH) + '\n...(truncated)'
    : extracted.content;

  const title = (typeof titleOverride === 'string' && titleOverride.trim()) || file.name;

  try {
    const result = await gqlClient(locals.token).request<{ addPongKnowledge: PongKnowledge }>(
      ADD_PONG_KNOWLEDGE_MUTATION,
      {
        connectionId,
        title,
        content,
        docType: typeof docType === 'string' && docType ? docType : null,
      },
    );
    return json({
      filename: file.name,
      size: file.size,
      contentLength: content.length,
      document: result.addPongKnowledge,
    });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Failed to save document to memory' },
      { status: 500 },
    );
  }
};
