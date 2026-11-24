# YouTube Music Account Authentication (FEATURE-043)

## Overview
Echo Music Web implements account-aware YouTube Music authentication matching upstream Android Echo Music (`LoginScreen.kt`, `AccountViewModel.kt`, `AccountData.kt`). Users can authenticate their personal YouTube Music session using their browser cookies (`SAPISID`, `__Secure-3PSID`, etc.) and visitor data to access their personal library, liked playlists, liked albums, and followed artists.

## Upstream Parity & Architecture
- **Upstream Pattern:** `LoginScreen.kt` captures user session cookies and visitor data, initializing the `YouTube` client object to make authenticated InnerTube calls (`YouTube.accountInfo()`, `YouTube.library("FEmusic_liked_playlists")`, etc.).
- **Multi-Account Storage:** Users can store up to 5 YouTube Music accounts and switch seamlessly between them without re-entering cookies.
- **Account Verification Endpoint (`/api/innertube/account/info`):**
  - Accepts session cookies and queries `account/account_menu` or `FEmusic_account_menu`.
  - Parses account display name, channel handle, email, and avatar image.
- **Settings UI (`SettingsPage.tsx` & `YouTubeAccountModal.tsx`):**
  - Dedicated YouTube Music Account management card.
  - Interactive status banner showing current user identity, channel handle, and sync state.
  - One-click account switching and disconnect controls.

## Telemetry
- `authSuccessCount`: Successful YouTube Music authentications.
- `authFailureCount`: Failed authentication or invalid cookie attempts.
- `accountInfoLoadsCount`: Account menu and profile verifications.
- `librarySyncCount`: Account-aware library fetches.
- `accountSwitchesCount`: Active account transitions.
