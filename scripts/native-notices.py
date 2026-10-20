#!/usr/bin/env python3
"""Append notices from the native dependencies actually resolved by Xcode."""

import argparse
from pathlib import Path


MARKER = "\n\n=== Native dependency notices ===\n"
REQUIRED_PACKAGES = {"capacitor-swift-pm", "ion-ios-filesystem"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_bundle", type=Path)
    parser.add_argument("sourcepackages_checkouts", type=Path)
    args = parser.parse_args()
    notice_file = args.app_bundle / "public" / "THIRD_PARTY_NOTICES.txt"
    if not notice_file.is_file():
        parser.error(f"Existing web dependency notices are missing: {notice_file}")
    if not args.sourcepackages_checkouts.is_dir():
        parser.error(f"Resolved SPM checkouts are missing: {args.sourcepackages_checkouts}")

    packages = sorted(
        path for path in args.sourcepackages_checkouts.iterdir()
        if path.is_dir() and not path.name.startswith(".")
    )
    missing = REQUIRED_PACKAGES - {path.name.lower() for path in packages}
    if missing:
        parser.error(f"Required runtime checkouts are missing: {', '.join(sorted(missing))}")

    sections = []
    for package in packages:
        files = sorted(
            path for path in package.iterdir()
            if path.is_file() and path.name.upper().startswith(("LICENSE", "NOTICE"))
        )
        if not any(path.name.upper().startswith("LICENSE") for path in files):
            parser.error(f"Resolved package has no root LICENSE file: {package}")
        for path in files:
            contents = path.read_text(encoding="utf-8").strip()
            if not contents:
                parser.error(f"Resolved dependency notice is empty: {path}")
            sections.append(f"{package.name}/{path.name}\n{'-' * 60}\n{contents}")

    apache_path = Path(__file__).resolve().parents[1] / "docs/licenses/Apache-2.0.txt"
    if not apache_path.is_file():
        parser.error(f"Bundled Apache 2.0 license is missing: {apache_path}")
    apache = apache_path.read_text(encoding="utf-8").strip()
    if "Apache License" not in apache or "Version 2.0" not in apache:
        parser.error(f"Bundled Apache license text is invalid: {apache_path}")
    sections.append(
        "Cordova compatibility code bundled by Capacitor\n"
        "Includes code licensed to the Apache Software Foundation (ASF) under "
        "the Apache License, Version 2.0.\n"
        "Source: https://github.com/ionic-team/capacitor/tree/8.5.3/ios/CapacitorCordova\n"
        "License source: https://www.apache.org/licenses/LICENSE-2.0.txt\n\n"
        + apache
    )

    # Re-running packaging replaces this generated section rather than duplicating it.
    existing = notice_file.read_text(encoding="utf-8").split(MARKER, 1)[0].rstrip()
    if not existing:
        parser.error(f"Existing web dependency notices are empty: {notice_file}")
    notice_file.write_text(existing + MARKER + "\n\n".join(sections) + "\n", encoding="utf-8")
    print(f"Added native notices from {len(packages)} resolved SPM packages to {notice_file}")


if __name__ == "__main__":
    main()
