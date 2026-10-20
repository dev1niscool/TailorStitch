Version **1.0.1** improves automatic stitching of text conversations:

- Joins use clean rows inside the shared content, avoiding repeated composer borders and obscured messages.
- Resized screenshots can match when the scroll offset falls between pixels.
- Changing navigation badges no longer interrupt repeated-header detection.
- Added fictional chat regressions for sparse attachments, overlays, and resized text. The same engine powers the website and this iPhone build.

An unsigned **ARM64 iPhoneOS Release build** for people to sign with their own sideloading tool. No Apple account, signing certificate, or provisioning profile was used to build this IPA.

Download **TailorStitch-unsigned.ipa** and import it into Sideloadly or AltStore Classic. The recipient supplies their own signing account in that tool. An unsigned IPA cannot be installed by tapping its download link. See the [sideloading guide](https://github.com/dev1niscool/TailorStitch/blob/main/docs/SIDELOADING.md).

- Requires iOS **15.4 or newer**.
- Automatic screenshot overlap detection, ordering, manual adjustments, PNG export, and native sharing.
- Image processing happens entirely on-device; the web app is bundled for offline use.
- `SHA256SUMS` verifies the download. `build-info.json` identifies the source commit and validated device binaries.
- The app's stitching flow has been tested in the iPhone simulator. Installation and sharing on a physical phone after recipient signing have not been verified.

This is a public release. No GitHub account is required to download the IPA.
