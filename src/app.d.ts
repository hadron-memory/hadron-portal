declare global {
  namespace App {
    interface Locals {
      user: {
        id: string;
        githubUsername: string | null;
        email: string | null;
        name: string | null;
        avatarUrl: string | null;
        roles: string[];
      } | null;
      token: string | null;
      // Admin impersonation: set when the hadron_impersonation cookie holds a
      // live impersonation JWT. `token`/`user` then reflect the TARGET (the
      // server enforces read-only + shared-org scope); `actorUserId` is the
      // admin from the untouched hadron_token cookie, for the banner.
      impersonation: {
        sessionId: string;
        actorUserId: string;
        orgId: string;
        expiresAt: number; // epoch ms
      } | null;
    }
    namespace Superforms {
      type Message = { type: 'success' | 'error'; text: string; action?: { label: string; href: string } };
    }
    interface Error { message: string; requestId?: string }
    // interface PageData {}
    // interface Platform {}
  }
}

export {};
