/**
 * Quasar boot file: axios
 *
 * Development convenience: on startup, automatically logs in with the default
 * dev credentials (default_user@example.com / default_password).
 *
 * The backend uses CookieTransport: login sets an `auth_token` cookie which
 * the browser re-sends automatically on every subsequent request.
 * We therefore only need to ensure `withCredentials: true` is the global
 * default so axios always includes cookies in cross-origin requests.
 *
 * In production you would replace the auto-login block with a proper auth flow.
 */

import { defineBoot } from '#q-app/wrappers';
import axios from 'axios';
import { AuthService } from 'src/services/auth';

const DEV_EMAIL = import.meta.env.VITE_DEV_EMAIL || 'default_user@example.com';
const DEV_PASSWORD = import.meta.env.VITE_DEV_PASSWORD || 'default_password';

export default defineBoot(async () => {
  // Send cookies on every cross-origin request (required for CookieTransport).
  axios.defaults.withCredentials = true;

  // Auto-login so the browser holds a valid auth_token cookie from the start.
  // Short timeout so a slow/unavailable backend doesn't block the whole app.
  try {
    await AuthService.login({ username: DEV_EMAIL, password: DEV_PASSWORD }, 3000);
  } catch (err) {
    console.warn('[axios boot] Auto-login failed (backend may be unavailable):', err);
  }
});
