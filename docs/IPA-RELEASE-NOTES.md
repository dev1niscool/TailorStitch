Version **1.0.3** improves registration of screenshots with changing fixed headers:

- Header detection uses brightness and shape evidence instead of treating a small change in glass tint as the start of the conversation.
- Content regions can propose a scroll alignment independently of an uncertain header estimate; the full overlap must still verify it.
- Distinct competing alignments remain in the comparison, including repeated stickers and emoji.
- The manual zero-overlap action is now labeled **Stack without matching**, with an explanation that it leaves repeated content in the result.
- Added fictional regression coverage for changing headers, repeated stickers, and crops that could hide different messages. The website and this iPhone build use the same engine.

An unsigned **ARM64 iPhoneOS Release build** for people to sign with their own sideloading tool. No Apple account, signing certificate, or provisioning profile was used to build this IPA.

Download **TailorStitch-unsigned.ipa** and import it into Sideloadly or AltStore Classic. The recipient supplies their own signing account in that tool. An unsigned IPA cannot be installed by tapping its download link. See the [sideloading guide](https://github.com/dev1niscool/TailorStitch/blob/main/docs/SIDELOADING.md).

- Requires iOS **15.4 or newer**.
- Automatic screenshot overlap detection, ordering, manual adjustments, PNG export, and native sharing.
- Image processing happens entirely on-device; the web app is bundled for offline use.
- `SHA256SUMS` verifies the download. `build-info.json` identifies the source commit and validated device binaries.
- The app's stitching flow has been tested in the iPhone simulator. Installation and sharing on a physical phone after recipient signing have not been verified.

This is a public release. No GitHub account is required to download the IPA.
