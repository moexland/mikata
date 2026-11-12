import { browser, origin, remote, resetBrowser, resetRemote } from "./fakes.ts";

import { beforeEach, expect, test } from "bun:test";

const { requestTrackerToken } = await import("../src/oauth.ts");

const REDIRECT = "https://mikata.moex.land/callback";
const AUTH_TAB = 42;
const OTHER_TAB = 99;

type Behaviour = "approve" | "trailing-slash" | "tamper" | "close";

const tick = () => new Promise((resolve) => setImmediate(resolve));

let authURL: URL;

function callbackURL(context: string, base = REDIRECT): string {
  const url = new URL(base);
  url.searchParams.set("code", "the-code");
  url.searchParams.set("context", context);
  return url.toString();
}

/** Plays the part of the user and Kamaitachi in the authorization tab. */
function simulate(behaviour: Behaviour): void {
  browser.onTabCreated = (url) => {
    authURL = new URL(url);
    const context = authURL.searchParams.get("context")!;
    const update = browser.tabUpdated.emit;

    void (async () => {
      await tick();

      // The authorization page itself loading: no URL without host permission.
      update(AUTH_TAB, { status: "loading" }, { id: AUTH_TAB });
      update(AUTH_TAB, { status: "complete" }, { id: AUTH_TAB });
      // Another tab happening to open the redirect address must not count.
      update(OTHER_TAB, { url: callbackURL("someone-else") }, { id: OTHER_TAB });
      // Neither must a different path on the same host.
      update(
        AUTH_TAB,
        { url: `https://mikata.moex.land/other?code=x&context=${context}` },
        { id: AUTH_TAB },
      );
      await tick();

      switch (behaviour) {
        case "close":
          browser.tabRemoved.emit(AUTH_TAB);
          return;
        case "tamper":
          update(AUTH_TAB, { url: callbackURL("someone-else") }, { id: AUTH_TAB });
          return;
        case "trailing-slash":
          update(
            AUTH_TAB,
            { status: "complete" },
            { id: AUTH_TAB, url: callbackURL(context, `${REDIRECT}/`) },
          );
          return;
        case "approve":
          update(AUTH_TAB, { url: callbackURL(context) }, { id: AUTH_TAB });
          // The redirect page finishing its load fires again; the listener must be gone by then.
          update(AUTH_TAB, { status: "complete" }, { id: AUTH_TAB, url: callbackURL(context) });
      }
    })();

    return AUTH_TAB;
  };
}

function authorize(behaviour: Behaviour, clientSecret = "s3cret"): Promise<string> {
  simulate(behaviour);
  return requestTrackerToken({
    trackerOrigin: origin,
    client: { clientID: "my-client", clientSecret },
    redirectUri: REDIRECT,
  });
}

/**
 * Whatever the outcome, the flow must stop listening. It also leaves the tabs
 * alone: the authorization tab is the user's to close, and focus stays where it is.
 */
function expectCleanedUp(): void {
  expect(browser.tabUpdated.listeners.size + browser.tabRemoved.listeners.size).toBe(0);
  expect(browser.removedTabs).toEqual([]);
  expect(browser.activatedTabs).toEqual([]);
}

beforeEach(() => {
  resetBrowser();
  resetRemote();
});

test("opens the authorization page and exchanges the code for a token", async () => {
  expect(await authorize("approve")).toBe("good-token");

  expect(authURL.origin + authURL.pathname).toBe(`${origin}/oauth/request-auth`);
  expect(authURL.searchParams.get("clientID")).toBe("my-client");
  expect(authURL.searchParams.get("context")!.length).toBeGreaterThanOrEqual(16);

  expect(remote.tokenRequests).toHaveLength(1);
  expect(remote.tokenRequests[0]!.input).toEqual({
    client_id: "my-client",
    client_secret: "s3cret",
    grant_type: "authorization_code",
    redirect_uri: REDIRECT,
    code: "the-code",
  });
  expect(remote.tokenRequests[0]!.headers.get("content-type")).toStartWith("application/json");
  expectCleanedUp();
});

test("recognises the redirect page even if the host added a trailing slash", async () => {
  expect(await authorize("trailing-slash")).toBe("good-token");

  // The exchange still has to send the address exactly as registered.
  expect(remote.tokenRequests[0]!.input.redirect_uri).toBe(REDIRECT);
  expectCleanedUp();
});

test("rejects a callback whose context does not match, without exchanging the code", async () => {
  await expect(authorize("tamper")).rejects.toThrow(/does not match/);

  expect(remote.tokenRequests).toHaveLength(0);
  expectCleanedUp();
});

test("gives up when the user closes the authorization tab", async () => {
  await expect(authorize("close")).rejects.toThrow(/was closed/);

  expect(remote.tokenRequests).toHaveLength(0);
  expect(browser.removedTabs).toEqual([]);
  expectCleanedUp();
});

test("surfaces the server's reason when the client secret is wrong", async () => {
  await expect(authorize("approve", "wrong")).rejects.toThrow(/Invalid secret/);
  expectCleanedUp();
});

test("refuses a token that cannot submit scores", async () => {
  resetRemote({ tokenPermissions: { customise_profile: true } });

  await expect(authorize("approve")).rejects.toThrow(/submit_score/);
  expectCleanedUp();
});
