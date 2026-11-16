// Filled in after the iCloud container and API token exist (step 2a).
// The API token is meant to be public: CloudKit only accepts it from the allowed origin
// (prepwerk-apps.github.io), and private data needs a sign-in with the Apple ID.
window.PROBE_CONFIG = {
  containerIdentifier: "",
  apiToken: "",
  environment: "development",
};
