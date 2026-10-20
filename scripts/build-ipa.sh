#!/usr/bin/env bash
# Build an unsigned physical-device IPA. Recipient sideloading tools provide signing.
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
if [[ "$(uname -s)" != Darwin ]]; then
  echo "An iPhone IPA requires macOS and Xcode. Run the Build iPhone sideload IPA workflow on GitHub." >&2
  exit 1
fi

output_dir="$project_root/build/ipa"
version="$(node -p "require('./package.json').version")"
build_number="${GITHUB_RUN_NUMBER:-1}"
source_commit="${GITHUB_SHA:-$(git rev-parse HEAD)}"
mkdir -p "$output_dir"

npm run build
npx cap sync ios
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$output_dir/DerivedData" \
  -archivePath "$output_dir/TailorStitch.xcarchive" \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY='' DEVELOPMENT_TEAM='' \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build_number" \
  archive

staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/tailorstitch-ipa.XXXXXX")"
trap 'rm -rf "$staging_dir"' EXIT
mkdir -p "$staging_dir/Payload"
ditto "$output_dir/TailorStitch.xcarchive/Products/Applications/App.app" "$staging_dir/Payload/App.app"
python3 scripts/native-notices.py "$staging_dir/Payload/App.app" "$output_dir/DerivedData/SourcePackages/checkouts"

ipa_path="$output_dir/TailorStitch-unsigned.ipa"
rm -f "$ipa_path"
ditto -c -k --norsrc --noextattr --keepParent "$staging_dir/Payload" "$ipa_path"
python3 scripts/verify-ipa.py "$ipa_path" --source-commit "$source_commit" --expected-version "$version"
echo "Unsigned iPhone IPA, checksums, and build metadata: $output_dir"
