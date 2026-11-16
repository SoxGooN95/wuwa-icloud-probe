# iCloud Probe

Minimal test page for a private project: sign in with an Apple ID through CloudKit JS, then save and read one record in the private iCloud database. It contains no game data, no images and no personal data.

The API token in `config.js` is public by design. CloudKit only accepts it from the allowed origin, and private records require the owner's Apple ID sign-in.
