# AIBooster iOS

Swift + SwiftUI client for AIBooster. Consumes `/api/*` on the production Vercel deploy.

See **§11** of the project constitution (`/CLAUDE.md`) for the architectural rules around this folder.

## Prerequisites

- macOS with Xcode 15+ (iOS 17 SDK).
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`.

## First-time setup

```bash
cd mobile
xcodegen generate     # writes AIBOOSTER.xcodeproj (gitignored)
open AIBOOSTER.xcodeproj
```

In Xcode:

1. Target **AIBOOSTER** → **Signing & Capabilities** → Team: pick your Apple Developer team.
2. Plug iPhone in (or enable wireless debug), pick it as run destination, hit **⌘R**.

## Identity

- **Bundle ID:** `aibooster`
- **Display name:** `AIBooster`
- **App Store Connect Apple ID:** `6776967096` (the numeric ID — distribution is ad-hoc / TestFlight closed, **not App Store**)

## Layout

```
mobile/
├── project.yml                        # XcodeGen spec — single source of truth
└── AIBOOSTER/
    ├── App.swift                      # @main entry
    ├── Views/RootView.swift           # root view
    ├── Config/AppConfig.swift         # API base URL, token resolution
    ├── Networking/APIClient.swift     # async HTTP wrapper, Bearer auth
    ├── Networking/Keychain.swift      # token storage
    └── Models/API.swift               # mirror of lib/api-types.ts (web)
```

## API config

By default the app talks to `https://aibooster.vercel.app`. To point a build at a Vercel preview, add an `APIBaseURL` string to `Info.plist` (or via XcodeGen `info.properties`). For DEV bearer token use `DevAPIToken` Info.plist key (overrides Keychain only when Keychain is empty).

## After changes to `project.yml`

```bash
xcodegen generate
```

Don't commit `AIBOOSTER.xcodeproj` — it's regenerated.
