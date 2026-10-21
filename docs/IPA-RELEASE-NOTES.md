Version **1.0.2** fixes a rejected overlap in text conversations:

- Matching text and image details can verify an overlap when message-bubble shading changes as the screen scrolls.
- The matcher checks detailed content before rejecting a promising alignment based on its average color difference.
- Ambiguous matches, plain backgrounds, and similar bubbles containing different text still require review.
- Added fictional regression coverage for changing bubble colors and content preservation. The website and this iPhone build use the same corrected engine.

An unsigned **ARM64 iPhoneOS Release build** for people to sign with their own sideloading tool. No Apple account, signing certificate, or provisioning profile was used to build this IPA.

Download **TailorStitch-unsigned.ipa** and import it into Sideloadly or AltStore Classic. The recipient supplies their own signing account in that tool. An unsigned IPA cannot be installed by tapping its download link. See the [sideloading guide](https://github.com/dev1niscool/TailorStitch/blob/main/docs/SIDELOADING.md).

- Requires iOS **15.4 or newer**.
- Automatic screenshot overlap detection, ordering, manual adjustments, PNG export, and native sharing.
- Image processing happens entirely on-device; the web app is bundled for offline use.
- `SHA256SUMS` verifies the download. `build-info.json` identifies the source commit and validated device binaries.
- The app's stitching flow has been tested in the iPhone simulator. Installation and sharing on a physical phone after recipient signing have not been verified.

This is a public release. No GitHub account is required to download the IPA.
