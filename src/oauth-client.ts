// The OAuth2 client Mikata presents to Kamaitachi.
//
// The build reads it from .env.local, which is not in the repository; see
// .env.example. A build made without one has no client, and its settings page
// says so in place of offering to authorize.
//
// The secret is not kept from anyone who has the built extension: it is in
// there for the reading. Leaving it out of the repository means only that each
// build is made with a client its builder registered.

import type { OAuthClient } from "./oauth.ts";

export const OAUTH_CLIENT: OAuthClient = {
  clientID: import.meta.env.VITE_OAUTH_CLIENT_ID ?? "",
  clientSecret: import.meta.env.VITE_OAUTH_CLIENT_SECRET ?? "",
};
