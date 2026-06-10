// Google OAuth client configuration.
//
// SETUP (one-time, by app owner):
//   1. Open https://console.cloud.google.com  →  New Project: "Notepad PWA"
//   2. APIs & Services → Enabled APIs → enable "Google Drive API"
//   3. OAuth consent screen:
//        - User type: External
//        - App name: Notepad
//        - Authorized domains: drtr.uk
//        - Add scope: https://www.googleapis.com/auth/drive.appdata
//        - Save (no need to publish for ≤100 testers; publish later for prod)
//   4. Credentials → Create Credentials → OAuth client ID
//        - Application type: Web application
//        - Authorized JavaScript origins (for popup sign-in — desktop/Android):
//            https://not.drtr.uk
//            http://localhost:8000   (for local dev)
//        - Authorized redirect URIs (for redirect sign-in — iOS standalone PWA / TWA):
//            https://not.drtr.uk/
//            http://localhost:8000/
//            (NOTE the trailing slash — must EXACTLY match location.origin + '/')
//        - Save → copy "Client ID"
//   5. Paste it below (REPLACE the placeholder). Client IDs are PUBLIC — safe to commit.
//   6. Deploy.
//
// Cross-platform notes:
//   - Desktop/Android browsers + Android TWA: GIS popup flow (no page reload).
//   - iOS standalone PWA (Add to Home Screen): popups are broken there, so the app
//     auto-switches to a full-page redirect flow. This REQUIRES the redirect URIs above.
//   - Same Google account on any platform ⇒ same hidden appDataFolder ⇒ same notes.
//
// If empty/placeholder, the cloud sync UI shows a "setup required" hint and stays disabled.

(function () {
  'use strict';
  window.NP_CLOUD_CONFIG = {
    // PASTE OAUTH CLIENT ID HERE (format: 1234567890-abcdef.apps.googleusercontent.com)
    GOOGLE_CLIENT_ID: '866965837196-e30js8ltie1pirn0ohuv3is2uhcecmd3.apps.googleusercontent.com',
    // Scope: hidden app-private folder in user's Drive + profile info
    SCOPE: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    // Drive API base
    DRIVE_API: 'https://www.googleapis.com/drive/v3',
    DRIVE_UPLOAD: 'https://www.googleapis.com/upload/drive/v3',
    // Sync tuning
    PUSH_DEBOUNCE_MS: 30000,     // wait N ms after last edit before pushing
    PULL_INTERVAL_MS: 120000,    // background pull cadence
    MAX_NOTE_BYTES: 5 * 1024 * 1024, // 5 MB per note JSON (Drive accepts larger; cap for sanity)
  };
})();
