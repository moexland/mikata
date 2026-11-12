// Where Mikata sends scores, and where Kamaitachi sends the user back to. The
// OAuth client itself is not here: see oauth-client.ts.

/** The Tachi instance scores are uploaded to. */
export const TRACKER_ORIGIN = "https://kamai.tachi.ac";

/**
 * The page Kamaitachi redirects to after the user approves. The extension reads
 * the authorization code from this page's address.
 *
 * Must match the Redirect URI registered on the Kamaitachi client exactly.
 */
export const OAUTH_REDIRECT_URI = "https://mikata.moex.land/callback";
