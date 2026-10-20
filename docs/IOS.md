# TailorStitch for iPhone

The iPhone project bundles the same screenshot stitching application inside a Capacitor WKWebView. It works with local screenshots and opens the native share sheet for PNG export. The website does not have to be online for an installed native build to work. No account, subscription, watermark, or image upload is part of the app.

## Use the web app on iPhone

Open the published TailorStitch web app in Safari. Use Safari's Share menu → **Add to Home Screen** for an app shortcut. This does not require Xcode or an Apple developer membership.

## Build the native app

Requirements: a Mac, Node.js 22 or newer, Xcode 26 or newer, and an iPhone running iOS 15 or newer. The project uses Swift Package Manager; Xcode downloads its native dependencies when first opened. See [Capacitor's iOS requirements](https://capacitorjs.com/docs/ios) and [Swift Package Manager support](https://capacitorjs.com/docs/ios/spm).

From the repository root:

```sh
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

The committed project is `ios/App/App.xcodeproj`. Do not run `cap add ios` again.

In Xcode:

1. Select the **App** project, then the **App** target.
2. In **Signing & Capabilities**, select **Automatically manage signing** and your own team.
3. Change `com.tailorstitch.app` to a bundle identifier you control, such as `com.yourname.tailorstitch`. Keep `appId` in `capacitor.config.ts` consistent.
4. Connect your iPhone, trust the Mac, enable Developer Mode if requested, and select the phone as the run destination.
5. Press **Run**. Choose a few overlapping screenshots in the app, stitch them, and use **Share** to save the PNG to Photos or Files.

An Apple Account with a Personal Team can install a development build on a personal device. Apple currently requires these free builds to be reprovisioned after seven days. TestFlight and App Store distribution require the appropriate Apple Developer Program membership, signing, and submission. TailorStitch can remain free to its users; Apple controls its distribution requirements. See [Apple's account and Personal Team documentation](https://developer.apple.com/help/account/basics/about-your-developer-account).

The original creator's Apple account is not needed for a new app under your own bundle identifier. This repository does not transfer or update the original Tailor App Store listing.

## Verify on a simulator

```sh
npm run build
npx cap sync ios
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The **Build iPhone simulator app** GitHub Actions workflow performs this build on macOS, launches it on an iPhone simulator, and captures a screenshot. Its zipped `.app` artifact is for an iOS simulator on a Mac. It is not a signed `.ipa` and cannot be installed directly on a physical iPhone. This smoke check does not replace a physical-device test of Photos selection, memory limits, safe areas, and sharing.

## Native privacy and exports

The native application uses the system file/photo picker through the web interface, which lets people select individual images. It does not scan or delete the photo library. Sharing writes one temporary PNG to the app's cache, passes its local file URL to the system share sheet, then removes it when the share activity ends.

`PrivacyInfo.xcprivacy` declares no tracking or collected data and includes the app-container file timestamp reason required by the Filesystem plugin. The Photos add usage description covers saving an exported image through the share sheet. Before App Store submission, review the full app and dependency behavior and complete Apple's privacy answers for the version you are shipping. [Filesystem plugin privacy guidance](https://capacitorjs.com/docs/apis/filesystem).

## Update the app after web changes

Run `npm run build` and `npx cap sync ios`, then rebuild in Xcode. The app intentionally loads bundled assets rather than a remote website. Never commit Apple signing certificates, provisioning profiles, or account credentials.
