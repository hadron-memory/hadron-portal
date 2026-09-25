/**
 * Save a base64-encoded file the server prepared, as a browser download.
 * Shared by the Task Nodes download (#879) and the node page's single-skill
 * export (#911), which both receive their zip base64-encoded beside a report.
 */
export function saveBase64Download(filename: string, base64: string, type = 'application/zip'): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked on the next task: some browsers start the download
  // asynchronously, and revoking synchronously cancels it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
