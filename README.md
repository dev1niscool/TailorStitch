# TailorStitch

**Overlapping screenshots, one complete picture.** A free screenshot stitcher for the web and iPhone. All image processing happens on the device, with no account, image upload, ads, or watermarks.

![TailorStitch web workspace with its sample screenshots](docs/preview.png)

## Use it

The GitHub Pages deployment target is **https://dev1niscool.github.io/TailorStitch/**. Deployment is handled by [Test and publish web app](../../actions/workflows/web.yml); the URL becomes available after GitHub Pages is enabled and the deployment succeeds.

1. Take overlapping screenshots while scrolling vertically. Keep about a third of the previous screen visible.
2. Add two or more PNG, JPEG, or WebP images from the same screen size. They are automatically matched and stitched.
3. Review the preview. If a join is uncertain, adjust its overlap or use 0 px before exporting.
4. Save a PNG, or use Share. On iPhone, add the website to your Home Screen from Safari.

The bundled **Try it with an example** uses original fictional screenshots and exercises the actual stitching engine.

## Features

- Automatic vertical overlap detection and screenshot ordering.
- Removal of repeated app headers and footers at joins, retaining the first header and final footer.
- Exact duplicate removal.
- Manual reordering, top/bottom crops, and per-join overlap adjustment.
- Conservative review mode: uncertain matches preserve all content and require confirmation before export.
- On-device processing in a web worker, with cancellation.
- PNG export and supported browser/native share sheets.
- Responsive, installable web app with offline support after its initial cache completes.
- Bundled iPhone app using Capacitor, native sharing, an Xcode project, simulator CI, and an unsigned device IPA for sideload signing.

## Development

Use Node.js **22.12 or newer**.

```sh
npm ci
npm run dev
```

Build and test:

```sh
npm test
npm run build
npx playwright install --with-deps chromium webkit
npm run test:e2e
```

The production build is in `dist/`. Relative URLs support GitHub Pages project paths such as `/TailorStitch/`. The build generates a versioned service worker that caches only the app and its example assets.

See [publishing instructions](docs/PUBLISHING.md), [iPhone installation and signing](docs/IOS.md), and [stitching algorithm](docs/ALGORITHM.md).

## iPhone

The native iPhone app bundles the same interface and engine in a local WKWebView. It does not require the website to be reachable.

**[Download the unsigned iPhone IPA](https://github.com/dev1niscool/TailorStitch/releases/latest/download/TailorStitch-unsigned.ipa)** from [GitHub Releases](https://github.com/dev1niscool/TailorStitch/releases/latest), then follow the [sideloading guide](docs/SIDELOADING.md). Recipients sign the IPA using their own sideloading tool; the build needs no owner's Apple credentials. Tapping the download alone does not install it.

Release downloads follow repository visibility. While this repository is private, only people with repository access can download them.

To build and run from source instead:

```sh
npm run ios:sync
npm run ios:open
```

Open the existing Xcode project on a Mac, select your signing team and bundle identifier, and run on your device. A free Apple Personal Team can be used for personal development installs under Apple's restrictions. App Store/TestFlight distribution requires the appropriate Apple membership and signing. No signed App Store release is included. See the [complete iPhone guide](docs/IOS.md).

## Limits and privacy

This version stitches **vertical screenshots of the same pixel width**. It cannot recover uncaptured content. Repeated text, blank areas, animations, expanding headers, different zoom levels, and sideways movement may need manual adjustment.

Up to 12 images are accepted. Each source must be at most 25 MB and 24 megapixels. Sources wider than 1,440 px are resized to that width; the batch is limited to 20 megapixels after resizing. Output is limited to 16 megapixels and 16,384 px tall to reduce mobile canvas/memory failures. Crop and overlap values refer to these processed pixels.

Screenshots stay in memory until cleared or the app closes. They are never cached by the service worker or uploaded. Native sharing creates a temporary file and removes it after the share sheet finishes. Hosting providers may log normal requests for website assets. See [privacy details](docs/PRIVACY.md).

## Relationship to Tailor and REA

TailorStitch is an **independent implementation inspired by [Tailor's public behavior](https://apps.apple.com/us/app/tailor-screenshot-stitching/id926653095)**. No Tailor source, decompiled code, artwork, branding, or original binary is included. The project owner reports permission from the original creator.

The suggested [REA repository](https://github.com/morluto/rea) is a general reverse-engineering framework. Its [Apple analysis workflow](https://github.com/morluto/rea/blob/main/docs/apple-application-analysis.md) needs a supplied app bundle or binary. No such artifact was available, so REA was researched but not executed or added as a dependency. This implementation does not claim to recover Tailor's original algorithm.
