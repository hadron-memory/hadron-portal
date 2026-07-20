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
    .refine((value) => Number(value) <= 2147483647, 'Installation ID is too large')
    .prefault(''),
});

export const unlinkGithubSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('unlinkGithub').default('unlinkGithub'),
});

export const connectExchangeSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('connectExchange').default('connectExchange'),
});

export const testExchangeConnectionSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('testExchangeConnection').default('testExchangeConnection'),
  connectionId: z.string().trim().min(1, 'Connection ID is required').prefault(''),
});

export const deleteExchangeConnectionSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteExchangeConnection').default('deleteExchangeConnection'),
  connectionId: z.string().trim().min(1, 'Connection ID is required').prefault(''),
});
