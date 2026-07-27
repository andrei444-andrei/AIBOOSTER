# AIBooster iOS

Swift + SwiftUI client for AIBooster. Consumes `/api/*` on the production Vercel deploy.

See **§11** of the project constitution (`/CLAUDE.md`) for the architectural rules around this folder.

## Prerequisites

- macOS with **Xcode 16+** (iOS 17 SDK).
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) **2.44.0+**: `brew install xcodegen`
  (already installed? `brew upgrade xcodegen`). The source folder uses Xcode 16
  synchronized folders, which need this version.

## First-time setup

```bash
cd mobile
xcodegen generate     # writes AIBOOSTER.xcodeproj (gitignored)
open AIBOOSTER.xcodeproj
```

In Xcode:

1. Pick a run destination — an **iOS Simulator** (no signing needed) or a
   physical device (Target **AIBOOSTER** → **Signing & Capabilities** → Team).
2. Hit **⌘R**.

## Adding / changing source files

The `AIBOOSTER` source is a **synchronized folder** (`type: syncedFolder` in
`project.yml`). New `.swift` files on disk — e.g. after `git pull` — show up in
the project **automatically**: no `xcodegen generate`, no manual "Add Files".

Re-run `xcodegen generate` only when you edit `project.yml` itself (targets,
build settings, identity) or to first adopt this setup on an old checkout.

## Identity

- **Bundle ID:** `aibooster`
- **Display name:** `AIBooster`
- **App Store Connect Apple ID:** `6776967096` (the numeric ID — distribution is ad-hoc / TestFlight closed, **not App Store**)

## Layout

```
mobile/
├── project.yml                            # XcodeGen spec — single source of truth
└── AIBOOSTER/
    ├── App.swift                          # @main entry
    ├── Config/AppConfig.swift             # API base URL, token resolution
    ├── Networking/APIClient.swift         # async HTTP wrapper, Bearer auth
    ├── Networking/Keychain.swift          # token storage
    ├── Models/API.swift                   # mirror of lib/api-types.ts (web)
    ├── Design/Theme.swift                 # design tokens — mirror of web UX Kit
    └── Views/
        ├── RootView.swift                 # NavigationStack → HomeView
        ├── Components/Components.swift     # IconBadge, PressableStyle, AppearAnimator
        ├── Home/                          # home screen: feature tiles + animations
        │   ├── Feature.swift              # tile model + navigation routes
        │   └── HomeView.swift             # header, hero tile, "coming soon" grid
        ├── YouTubePodcasts/               # translated video podcasts + player
        │   ├── YouTubePodcastsView.swift  # feed (list / empty / loading / error)
        │   ├── PodcastsStore.swift        # feed state, polling, submit
        │   ├── EpisodeRow.swift           # feed row
        │   ├── EpisodeDetailView.swift    # player + transcript
        │   ├── AddPodcastSheet.swift      # submit a YouTube URL
        │   ├── AudioPlayer.swift          # AVPlayer wrapper (background audio)
        │   └── PodcastFormatting.swift    # shared formatters
        ├── News/                          # validated feed + inline AI deep-dive
        ├── Chat/                          # sessions, SSE streaming, voice input
        ├── English/                       # generated dialogues + bilingual player
        └── Browser/                       # type a URL → fullscreen WKWebView
            ├── BrowserView.swift          # address entry, recents, fullscreen cover
            └── WebView.swift              # WKWebView wrapper (progress, _blank)
```

> `Design/Theme.swift` mirrors the web UX Kit tokens (`app/globals.css`) — warm
> cream palette, near-black accent, hairline borders. Keep it in sync by hand,
> same discipline as `Models/API.swift`.

## API config

By default the app talks to the production deploy `https://aibooster-pied.vercel.app`
(the bare `aibooster.vercel.app` subdomain is squatted by an unrelated site). To
point a build at a Vercel preview, add an `APIBaseURL` string to `Info.plist` (or
via XcodeGen `info.properties`). For DEV bearer token use the `DevAPIToken`
Info.plist key (overrides Keychain only when Keychain is empty).

The YouTube Podcasts screen consumes the existing open `/api/jobs`,
`/api/jobs/[id]` and `/api/translate-video` routes — see `lib/api-types.ts` for
the shared contract.

## After changes to `project.yml`

```bash
xcodegen generate
```

Don't commit `AIBOOSTER.xcodeproj` — it's regenerated.
