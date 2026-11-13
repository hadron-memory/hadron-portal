import { fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from './api';
import { RUN_TASK_APP_MUTATION } from './queries';
import { runStartError, runStartStatus } from './run-start-error';
import { runAppFlowSchema } from '../../routes/app/apps/[appId]/runs/schema';

export async function runAppFlow({ request, params, locals }: { request: Request; params: { appId: string }; locals: App.Locals }) {
    const form = await superValidate(await request.formData(), zod4(runAppFlowSchema));
    if (!form.valid) return fail(400, { form });

    let runId: string;
    try {
      const res = await gqlClient(locals.token).request<{ runTask: string }>(RUN_TASK_APP_MUTATION, {
        nodeRef: form.data.entryUrn,
        appRef: params.appId,
        runAsSelf: false,
        ...(form.data.agentRef ? { agentRef: form.data.agentRef } : {}),
      });
      runId = res.runTask;
    } catch (e: unknown) {
      return message(form, { type: 'error' as const, text: runStartError(e, 'Failed to start the flow') }, { status: runStartStatus(e) });
    }
    redirect(303, `/app/apps/${params.appId}/runs/${runId}`);
}
