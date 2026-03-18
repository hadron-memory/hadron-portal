import { redirect } from '@sveltejs/kit';

export async function requireNonConsumer(parent: () => Promise<{ isConsumerMode?: boolean }>) {
  const data = await parent();
  if (data.isConsumerMode) redirect(303, '/app/dashboard');
}
