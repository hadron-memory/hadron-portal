import type { Handle, Cookies } from '@sveltejs/kit';
export function captureNodeAdvice(_response: unknown): void {}
export function takeNodeAdvice(_cookies: Pick<Cookies, 'get' | 'delete'>, _userId: string): string[] { return []; }
export const nodeAdviceHandle: Handle = async ({ event, resolve }) => resolve(event);
