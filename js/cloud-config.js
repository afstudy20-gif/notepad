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
//        - Authorized JavaScript origins:
//            https://not.drtr.uk
//            http://localhost:8000   (for local dev)
//        - Save → copy "Client ID"
//   5. Paste it below (REPLACE the placeholder). Client IDs are PUBLIC — safe to commit.
//   6. Deploy.
//
// If empty/placeholder, the cloud sync UI shows a "setup required" hint and stays disabled.

(function () {
  'use strict';
  window.NP_CLOUD_CONFIG = {
    // PASTE OAUTH CLIENT ID HERE (format: 1234567890-abcdef.apps.googleusercontent.com)
    GOOGLE_CLIENT_ID: '',
    // Scope: hidden app-private folder in user's Drive
    SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
    // Drive API base
    DRIVE_API: 'https://www.googleapis.com/drive/v3',
    DRIVE_UPLOAD: 'https://www.googleapis.com/upload/drive/v3',
    // Sync tuning
    PUSH_DEBOUNCE_MS: 10000,     // wait N ms after last edit before pushing
    PULL_INTERVAL_MS: 60000,     // background pull cadence
    MAX_NOTE_BYTES: 5 * 1024 * 1024, // 5 MB per note JSON (Drive accepts larger; cap for sanity)
  };
})();
