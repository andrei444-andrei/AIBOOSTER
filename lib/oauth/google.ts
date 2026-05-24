// OAuth helpers для Google (используется адаптерами gmail и gcal).
//
// Один проект Google Cloud → один client_id/secret → один redirect_uri.
// Scopes можно расширять при подключении новых интеграций.

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

// Scopes по умолчанию для адаптеров. gmail.readonly — только чтение писем,
// userinfo.email — чтобы знать, чей это аккаунт (для display_name источника).
export const DEFAULT_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface GoogleOAuthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const client_id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirect_uri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!client_id || !client_secret || !redirect_uri) return null;
  return { client_id, client_secret, redirect_uri };
}

export function buildGoogleAuthUrl(args: {
  config: GoogleOAuthConfig;
  scopes: string[];
  state: string;
  loginHint?: string;
}): string {
  const u = new URL(GOOGLE_AUTH_ENDPOINT);
  u.searchParams.set("client_id", args.config.client_id);
  u.searchParams.set("redirect_uri", args.config.redirect_uri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", args.scopes.join(" "));
  u.searchParams.set("access_type", "offline");      // нужен refresh_token
  u.searchParams.set("prompt", "consent");           // форсим refresh при повторе
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", args.state);
  if (args.loginHint) u.searchParams.set("login_hint", args.loginHint);
  return u.toString();
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export async function exchangeGoogleCode(args: {
  config: GoogleOAuthConfig;
  code: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.config.client_id,
    client_secret: args.config.client_secret,
    redirect_uri: args.config.redirect_uri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`google token exchange failed: ${res.status} ${txt.slice(0, 400)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<{ email?: string; name?: string }> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`google userinfo failed: ${res.status}`);
  }
  return (await res.json()) as { email?: string; name?: string };
}
