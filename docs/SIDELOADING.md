# Install TailorStitch on iPhone

Download **[TailorStitch-unsigned.ipa](https://github.com/dev1niscool/TailorStitch/releases/latest/download/TailorStitch-unsigned.ipa)** from the [latest GitHub Release](https://github.com/dev1niscool/TailorStitch/releases/latest).

The app requires **iOS 15.4 or newer**. This IPA contains the ARM64 device application, not the simulator build. It is unsigned: the project can build and publish it without the owner's Apple credentials, but a recipient must sign it through a sideloading tool before installation. Downloading or tapping the IPA alone does not install it.

**Download access:** this repository is currently private. GitHub requires an account with repository access to download its releases. Public distribution requires the owner to change distribution visibility; the build workflow does not do that.

## Install with Sideloadly

1. Install [Sideloadly from its official website](https://sideloadly.io/) on your Mac or Windows computer and complete its device setup.
2. Connect and trust your iPhone. Open Sideloadly and select the phone.
3. Drag `TailorStitch-unsigned.ipa` into Sideloadly.
4. Use your own Apple Account in the sideloading tool and start installation. Follow its signing, trust, and Developer Mode prompts.

With a free Apple Account, Sideloadly documents a seven-day signing period; refresh the app through the tool before it expires. Its current setup instructions cover computer requirements and automatic refreshing. Credentials belong in the tool you choose, never in this repository or an issue. [Sideloadly instructions and FAQ](https://sideloadly.io/).

[AltStore Classic](https://faq.altstore.io/altstore-classic/your-altstore) is another sideloading option. Follow its current installation and IPA-import instructions. Its documentation explains refresh requirements and account limits; compatibility depends on the tool version and device.

## Check the download

The same release includes `SHA256SUMS` and `build-info.json`. Keep all three files in one folder.

On macOS or Linux:

```sh
shasum -a 256 -c SHA256SUMS
```

On Windows PowerShell:

```powershell
Get-FileHash .\TailorStitch-unsigned.ipa -Algorithm SHA256
```

Compare the Windows hash with the IPA entry in `SHA256SUMS`. A matching checksum confirms that your download matches the release asset. `build-info.json` records the source/build details and package validation.

## What has been verified

The device release pipeline checks package structure, device architecture/platform, bundled web assets, and the absence of a provisioning profile. The existing simulator workflow exercises automatic stitching inside the native WKWebView. This release is not claimed to have been installed or tested on a physical iPhone with your sideloading tool.

After signing and installing, try the built-in example, select your own screenshots, and test the native Share action. The app processes screenshots locally and does not need the website to be online.

For building from source or App Store distribution, see [the iPhone project guide](IOS.md).
