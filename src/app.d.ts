declare global {
  namespace App {
    interface Locals {
      user: {
        id: string;
        login: string;
        name: string | null;
        avatarUrl: string | null;
        roles: string[];
        canInvite: boolean;
      } | null;
      token: string | null;
    }
    // interface Error {}
    // interface PageData {}
    // interface Platform {}
  }
}

export {};
