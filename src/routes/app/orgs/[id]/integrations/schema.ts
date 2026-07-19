import { z } from 'zod';

export const githubAppCredentialsSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateGithubApp').default('updateGithubApp'),
  appId: z.string().trim().min(1, 'App ID is required').prefault(''),
  privateKey: z.string().trim().min(1, 'Private Key is required').prefault(''),
});

export const githubInstallationSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('linkGithub').default('linkGithub'),
  installationId: z.string()
    .trim()
    .min(1, 'Installation ID is required')
    .regex(/^[1-9]\d*$/, 'Installation ID must be a number')
    .prefault(''),
});

export type GithubAppCredentialsSchema = typeof githubAppCredentialsSchema;
export type GithubInstallationSchema = typeof githubInstallationSchema;
