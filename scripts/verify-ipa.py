#!/usr/bin/env python3
"""Validate a device IPA before distribution; works on macOS and Linux."""
import argparse
import hashlib
import json
import plistlib
import re
import stat
import struct
import zipfile
from pathlib import Path, PurePosixPath

ARM64 = 0x0100000C
MAGICS = {b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def macho_slices(data):
    magic = data[:4]
    if magic == b"\xcf\xfa\xed\xfe":
        return [data]
    require(magic in MAGICS, "Unsupported Mach-O format")
    count = struct.unpack_from(">I", data, 4)[0]
    require(0 < count < 16, "Invalid universal Mach-O slice count")
    slices = []
    for index in range(count):
        if magic == b"\xca\xfe\xba\xbf":
            _, _, offset, size, _, _ = struct.unpack_from(">iiQQII", data, 8 + index * 32)
        else:
            _, _, offset, size, _ = struct.unpack_from(">iiIII", data, 8 + index * 20)
        require(offset + size <= len(data), "Mach-O slice exceeds file")
        slices.append(data[offset:offset + size])
    return slices


def validate_macho(data, name, executable=False):
    for binary in macho_slices(data):
        require(binary[:4] == b"\xcf\xfa\xed\xfe", f"{name}: expected 64-bit little-endian Mach-O")
        _, cpu, _, kind, count, command_size, _, _ = struct.unpack_from("<IiiIIIII", binary)
        require(cpu == ARM64, f"{name}: only ARM64 device binaries are allowed")
        if executable:
            require(kind == 2, f"{name}: main binary is not an executable")
        require(32 + command_size <= len(binary), f"{name}: invalid load commands")
        position = 32
        platforms = []
        for _ in range(count):
            command, length = struct.unpack_from("<II", binary, position)
            require(length >= 8 and position + length <= 32 + command_size, f"{name}: invalid load-command length")
            if command == 0x32:  # LC_BUILD_VERSION: iOS=2, iOS Simulator=7
                platforms.append(struct.unpack_from("<I", binary, position + 8)[0])
            elif command == 0x25:  # Legacy LC_VERSION_MIN_IPHONEOS
                platforms.append(2)
            position += length
        require(platforms and all(platform == 2 for platform in platforms), f"{name}: must target iOS devices, not Simulator/Mac")


def validate_ipa(path, source_commit, expected_version):
    require(re.fullmatch(r"[0-9a-f]{40}", source_commit), "A full source commit SHA is required")
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, "ZIP integrity check failed")
        names = archive.namelist()
        require(len(names) == len(set(names)), "Duplicate ZIP entries")
        for name in names:
            parts = PurePosixPath(name).parts
            require(not name.startswith("/") and ".." not in parts, "Unsafe ZIP path")
            require(name.startswith("Payload/"), f"Unexpected IPA top-level entry: {name}")
            require(not name.endswith("embedded.mobileprovision"), "IPA must not contain a provisioning profile")
        root = "Payload/App.app/"
        require(root + "Info.plist" in names, "Missing Payload/App.app/Info.plist")
        plist = plistlib.loads(archive.read(root + "Info.plist"))
        require(plist["CFBundleIdentifier"] == "com.tailorstitch.app", "Unexpected bundle identifier")
        require(plist["CFBundleSupportedPlatforms"] == ["iPhoneOS"], "Not an iPhoneOS application")
        require(plist.get("DTPlatformName") == "iphoneos", "Incorrect build SDK/platform")
        require(tuple(int(p) for p in plist["MinimumOSVersion"].split(".")) >= (15, 4), "Unexpected minimum iOS version")
        require(plist["CFBundleShortVersionString"] == expected_version, "App version differs from package/release version")
        require("arm64" in plist.get("UIRequiredDeviceCapabilities", []), "App must declare ARM64 support")
        require(not any(name.startswith(root + "_CodeSignature/") for name in names), "Main app must be unsigned")
        for resource in ["public/index.html", "public/THIRD_PARTY_NOTICES.txt", "PrivacyInfo.xcprivacy", "capacitor.config.json"]:
            require(root + resource in names, f"Missing bundled resource: {resource}")
        require(any(name.startswith(root + "public/assets/") and name.endswith(".js") for name in names), "Missing JavaScript application")
        binary_name = root + plist["CFBundleExecutable"]
        binary = archive.read(binary_name)
        validate_macho(binary, binary_name, executable=True)
        mode = archive.getinfo(binary_name).external_attr >> 16
        require(mode & stat.S_IXUSR, "Main executable lost its executable permission")
        require(b"TAILORSTITCH_SMOKE_TEST" not in binary, "Debug-only smoke harness leaked into Release")
        macho_names = []
        for item in archive.infolist():
            if item.is_dir() or stat.S_ISLNK(item.external_attr >> 16):
                continue
            with archive.open(item) as stream:
                magic = stream.read(4)
            if magic in MAGICS:
                validate_macho(archive.read(item), item.filename)
                macho_names.append(item.filename)
        require(any(".framework/" in name for name in macho_names), "Expected embedded native frameworks are missing")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "app": "TailorStitch",
        "version": plist["CFBundleShortVersionString"],
        "build": plist["CFBundleVersion"],
        "bundle_identifier": plist["CFBundleIdentifier"],
        "minimum_ios": plist["MinimumOSVersion"],
        "platform": "iPhoneOS",
        "architecture": "arm64",
        "configuration": "Release",
        "signing": "unsigned; recipient must sign using their sideloading tool",
        "physical_device_install_tested": False,
        "source_commit": source_commit,
        "ipa_file": path.name,
        "ipa_sha256": digest,
        "verified_macho_files": macho_names,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--expected-version", required=True)
    args = parser.parse_args()
    result = validate_ipa(args.ipa, args.source_commit, args.expected_version)
    (args.ipa.parent / "build-info.json").write_text(json.dumps(result, indent=2) + "\n")
    (args.ipa.parent / "SHA256SUMS").write_text(f"{result['ipa_sha256']}  {args.ipa.name}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
