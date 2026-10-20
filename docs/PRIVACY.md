# Privacy

TailorStitch processes selected screenshots on your device. It has no image-upload endpoint, user accounts, advertisements, analytics, or tracking SDKs.

Selected images and the result remain in the application's memory. Clear all removes the app's references and releases its canvases; closing the app also ends the session. The browser or operating system manages physical memory reclamation. TailorStitch does not save screenshot sessions in cookies, local storage, IndexedDB, or its service worker cache.

The offline cache contains the application code, icons, and fictional example screenshots only. Normal requests to GitHub Pages may be logged by GitHub under its own policies.

Saving a PNG writes a file at the user's direction. On native iPhone builds, sharing temporarily writes a PNG into the application's cache, passes the local file to the system share sheet, and deletes it after the share activity finishes. A force-quit during sharing may leave that temporary file in the operating system's cache until it is cleaned. Saved/shared copies are controlled by the destinations you select.

The app uses a system picker to select individual images. It does not scan or delete your photo library.

The Xcode project's privacy manifest declares no tracking or collected data and documents the file timestamp API used by the Filesystem dependency. Anyone distributing a modified build should review its actual behavior and update its privacy disclosures.
