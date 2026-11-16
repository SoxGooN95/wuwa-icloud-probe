// Filled in after the iCloud container and API token exist (step 2a).
// The API token is meant to be public: CloudKit only accepts it from the allowed origin
// (soxgoon95.github.io), and private data needs a sign-in with the Apple ID.
window.PROBE_CONFIG = {
  containerIdentifier: "iCloud.io.github.soxgoon95.wuwateams",
  apiToken: "c4a59016e3df709fc36e7e28ce005c9a451b5a905f6553a1ba956f5d75d659a1",
  environment: "development",
};
