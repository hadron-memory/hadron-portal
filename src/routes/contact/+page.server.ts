import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { SEND_CONTACT_MESSAGE_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { contactSchema } from './schema';

const contactFormAdapter = zod4(contactSchema);
type ContactForm = Infer<typeof contactSchema, 'zod4'>;

export const load: PageServerLoad = async () => ({
  form: await superValidate<ContactForm>({}, contactFormAdapter, { errors: false }),
});

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate<ContactForm>(await request.formData(), contactFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient().request(SEND_CONTACT_MESSAGE_MUTATION, form.data);
      return message(form, { type: 'success', text: "Message sent! We'll get back to you soon." });
    } catch {
      return message(form, { type: 'error', text: 'Failed to send message. Please try again.' }, { status: 500 });
    }
  },
};
