// Kamaitachi's OAuth2 authorization flow.
//
// This does not use the identity API (Safari does not support it). Instead it
// opens the authorization page in a regular tab and watches for that tab to
// navigate to the redirect address.

import { api } from "./shared.ts";

export interface OAuthClient {
  clientID: string;
  clientSecret: string;
}

export interface AuthorizationRequest {
  trackerOrigin: string;
  client: OAuthClient;
  /** Must be identical to the Redirect URI registered on the client. */
  redirectUri: string;
}

/** True when both addresses point at the same page, ignoring the query string and trailing slashes. */
function isSamePage(a: string, b: string): boolean {
  const normalise = (value: string): string => {
    const url = new URL(value);
    return url.origin + url.pathname.replace(/\/+$/u, "");
  };

  try {
    return normalise(a) === normalise(b);
  } catch {
    return false;
  }
}

/**
 * Opens the authorization page in a new tab and resolves with the full callback
 * URL once that tab navigates to the redirect address. Rejects if the user
 * closes the tab first.
 *
 * The tab is left open afterwards: the redirect page tells the user they are
 * done and can close it, which is clearer than a page that flashes and vanishes.
 */
async function waitForCallback(authURL: string, redirectUri: string): Promise<string> {
  const tab = await api.tabs.create({ url: authURL });

  return new Promise((resolve, reject) => {
    const stop = (): void => {
      api.tabs.onUpdated.removeListener(onUpdated);
      api.tabs.onRemoved.removeListener(onRemoved);
    };

    const onUpdated = (
      tabId: number,
      changeInfo: { url?: string },
      updatedTab: { url?: string } | undefined,
    ): void => {
      // The URL is only available with host permission for the redirect address.
      const url = changeInfo.url ?? updatedTab?.url;

      if (tabId !== tab.id || !url || !isSamePage(url, redirectUri)) {
        return;
      }

      stop();
      resolve(url);
    };

    const onRemoved = (tabId: number): void => {
      if (tabId !== tab.id) {
        return;
      }

      stop();
      reject(new Error("The authorization tab was closed."));
    };

    api.tabs.onUpdated.addListener(onUpdated);
    api.tabs.onRemoved.addListener(onRemoved);
  });
}

/**
 * Asks the user to approve access on Kamaitachi, then exchanges the resulting
 * authorization code for an API token.
 */
export async function requestTrackerToken({
  trackerOrigin,
  client,
  redirectUri,
}: AuthorizationRequest): Promise<string> {
  // Kamaitachi echoes `context` back unchanged, which ties the callback to this request.
  const context = crypto.randomUUID();

  const authURL = new URL("/oauth/request-auth", trackerOrigin);
  authURL.searchParams.set("clientID", client.clientID);
  authURL.searchParams.set("context", context);

  const callbackURL = await waitForCallback(authURL.href, redirectUri);

  const params = new URL(callbackURL).searchParams;
  const code = params.get("code");

  if (params.get("context") !== context) {
    throw new Error("The authorization callback does not match this request, so it was ignored.");
  }
  if (!code) {
    throw new Error("Kamaitachi did not return an authorization code.");
  }

  const res = await fetch(`${trackerOrigin}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({
      client_id: client.clientID,
      client_secret: client.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });

  interface TokenResponse {
    success?: boolean;
    description?: string;
    body?: { token?: string; permissions?: Record<string, boolean> };
  }

  let json: TokenResponse | null = null;
  try {
    json = (await res.json()) as TokenResponse | null;
  } catch {
    // Reported below together with other failures.
  }

  const token = json?.body?.token;

  if (!res.ok || !json?.success || typeof token !== "string") {
    throw new Error(`Token exchange failed: ${json?.description ?? `HTTP ${res.status}`}`);
  }
  if (json.body?.permissions?.submit_score !== true) {
    throw new Error(
      "The token does not have the submit_score permission. The OAuth client must request it.",
    );
  }

  return token;
}
