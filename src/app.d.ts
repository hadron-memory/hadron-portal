declare global {
  namespace App {
    interface Locals {
      user: {
        id: string;
        githubUsername: string;
        name: string | null;
        avatarUrl: string | null;
        roles: string[];
      } | null;
      token: string | null;
    }
    // interface Error {}
    // interface PageData {}
    // interface Platform {}
  }
}

export {};
