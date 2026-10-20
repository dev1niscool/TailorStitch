# Publish on GitHub Pages

The repository contains a complete static production build pipeline. No server, database, paid API, or secret is required.

## One-time repository configuration

1. Open [TailorStitch's Pages settings](https://github.com/dev1niscool/TailorStitch/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open [Test and publish web app](https://github.com/dev1niscool/TailorStitch/actions/workflows/web.yml) and run it on `main`, or push a change to `main`.
4. Wait for both the `build` and `deploy` jobs to succeed. The deployment job provides the live URL.

The workflow attempts to enable Pages automatically, but GitHub may require a repository administrator to enable it in Settings first. A GitHub integration can have permission to push code without having permission to manage Pages.

GitHub Free supports Pages from public repositories. Publishing from a private repository requires an eligible plan. This project does not automatically change repository visibility. If your account uses GitHub Free, an owner must decide whether to make the repository public before enabling Pages. [GitHub's Pages availability and setup documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

Expected project URL: `https://dev1niscool.github.io/TailorStitch/`. This is a deployment target, not proof of successful publication.

## What the workflow checks

The web workflow installs pinned dependencies, runs the pixel-level stitching tests, builds the app, runs Chromium and WebKit browser tests, uploads `dist/`, and deploys the artifact using GitHub's official Pages actions.

The separate iPhone workflow builds an unsigned simulator application on macOS, launches it on an iPhone simulator, and uploads the simulator application and launch screenshot. It does not publish to the App Store or produce a signed device `.ipa`.

## Local production preview

```sh
npm ci
npm run build
npm run preview
```

Wait for the offline cache to finish after the first visit before going offline. A newly deployed version has a new cache identity. Screenshots are never added to the cache.
