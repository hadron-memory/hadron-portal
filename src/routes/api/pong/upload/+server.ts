/**
 * Document upload endpoint for Pong.
 *
 * Accepts file uploads (multipart/form-data), extracts text content,
 * and returns the extracted text. Supports TXT and common text formats.
 * PDF/DOCX support can be added with pdf-parse/mammoth if needed.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return json({ error: 'No file provided' }, { status: 400 });
  }

  const filename = file.name.toLowerCase();
  let content: string;

  try {
    if (filename.endsWith('.txt') || filename.endsWith('.md') || filename.endsWith('.csv')) {
      // Plain text files
      content = await file.text();
    } else if (filename.endsWith('.html') || filename.endsWith('.htm')) {
      // HTML files — strip tags
      const html = await file.text();
      content = html
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
    } else if (filename.endsWith('.json')) {
      // JSON files — pretty print
      const raw = await file.text();
      try {
        const parsed = JSON.parse(raw);
        content = JSON.stringify(parsed, null, 2);
      } catch {
        content = raw;
      }
    } else {
      // Try to read as text for unknown formats
      try {
        content = await file.text();
        // Check if it's actually text (not binary gibberish)
        const nonPrintable = content.slice(0, 1000).split('').filter(c => {
          const code = c.charCodeAt(0);
          return code < 32 && code !== 9 && code !== 10 && code !== 13;
        }).length;
        if (nonPrintable > 50) {
          return json({
            error: `Unsupported file format: ${filename}. Please upload a text file (.txt, .md, .csv, .html).`,
          }, { status: 400 });
        }
      } catch {
        return json({
          error: `Could not read file: ${filename}. Please upload a text-based file.`,
        }, { status: 400 });
      }
    }

    // Truncate very large files
    const maxLength = 50000;
    if (content.length > maxLength) {
      content = content.slice(0, maxLength) + '\n...(truncated)';
    }

    return json({
      filename: file.name,
      size: file.size,
      content,
      contentLength: content.length,
    });
  } catch (e) {
    return json({
      error: e instanceof Error ? e.message : 'Failed to process file',
    }, { status: 500 });
  }
};
