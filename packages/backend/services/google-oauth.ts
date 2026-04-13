/**
 * google-oauth.ts — Google OAuth 2.0 flow for Gmail, Calendar, Drive.
 *
 * Handles:
 * 1. Generating OAuth URL (redirect user to Google)
 * 2. Exchanging authorization code for tokens
 * 3. Registering token refresher with oauth-manager
 *
 * Requires .env:
 *   GOOGLE_CLIENT_ID=...
 *   GOOGLE_CLIENT_SECRET=...
 *   GOOGLE_REDIRECT_URI=https://tower.moatai.app/api/auth/google/callback
 */

import { config } from '../config.js';
import type { RefreshFn } from 'notify-hub';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Scopes for Gmail + Calendar + Drive (read-only by default, send for Gmail)
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export function isGoogleOAuthConfigured(): boolean {
  return !!(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);
}

/**
 * Generate Google OAuth consent URL.
 * @param state - Opaque state to pass through (e.g., userId or session token)
 */
export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: DEFAULT_SCOPES.join(' '),
    access_type: 'offline',      // Get refresh_token
    prompt: 'consent',           // Force consent to always get refresh_token
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access + refresh tokens.
 */
export async function exchangeGoogleCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  idToken?: string;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.googleRedirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in ?? 3600,
    idToken: data.id_token,
  };
}

/**
 * Get user info (email, name) from Google.
 */
export async function getGoogleUserInfo(accessToken: string): Promise<{
  email: string;
  name: string;
}> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error('Failed to get Google user info');
  }

  const data = await res.json();
  return {
    email: data.email ?? '',
    name: data.name ?? data.email ?? '',
  };
}

/**
 * Create a Google token refresher for oauth-manager.
 */
export function createGoogleRefresher(): RefreshFn {
  return async (refreshToken: string) => {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google refresh failed: ${err}`);
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in ?? 3600,
      // Google doesn't return a new refresh_token on refresh
    };
  };
}
