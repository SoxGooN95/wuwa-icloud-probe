// iCloud probe: CloudKit JS sign-in, then save and fetch one record in the private database.
// One fixed record ("probe-latest") is overwritten on each save, so no query index is needed.
(function () {
  const RECORD_TYPE = "ProbeNote";
  const RECORD_NAME = "probe-latest";
  const cfg = window.PROBE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  let db = null;
  let changeTag = null;

  function log(msg, cls) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = new Date().toLocaleTimeString() + "  " + msg;
    $("log").prepend(line);
  }

  function describeDevice() {
    const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    return (standalone ? "installed web app" : "browser tab") + " · " + navigator.userAgent;
  }

  function setSignedIn(identity) {
    const on = Boolean(identity);
    $("user").textContent = on ? (identity.userRecordName || "signed in") : "not signed in";
    $("save").disabled = !on;
    $("load").disabled = !on;
    window.PROBE = { db: on ? db : null, log };
    window.dispatchEvent(new CustomEvent("probe-auth", { detail: on }));
  }

  function showRecord(rec) {
    if (!rec) { $("stored").textContent = "– (no record yet)"; $("modified").textContent = "–"; changeTag = null; return; }
    changeTag = rec.recordChangeTag;
    $("stored").textContent = rec.fields && rec.fields.text ? rec.fields.text.value : "–";
    $("modified").textContent = rec.modified ? new Date(rec.modified.timestamp).toLocaleString() : "–";
  }

  function ckError(e) {
    if (!e) return "unknown error";
    return [e.ckErrorCode, e.serverErrorCode, e.reason, e.message].filter(Boolean).join(" · ");
  }

  async function load() {
    try {
      const res = await db.fetchRecords([RECORD_NAME]);
      const rec = res.records && res.records[0];
      if (res.hasErrors) {
        const err = res.errors[0];
        if (err && err.ckErrorCode === "NOT_FOUND") { showRecord(null); log("No record stored yet."); return; }
        throw err;
      }
      showRecord(rec);
      log("Loaded record.", "ok");
    } catch (e) {
      log("Load failed: " + ckError(e), "err");
    }
  }

  async function save() {
    const text = $("text").value.trim() || "(empty)";
    const record = {
      recordType: RECORD_TYPE,
      recordName: RECORD_NAME,
      fields: { text: { value: text + "  [" + describeDevice().slice(0, 60) + "]" } },
    };
    if (changeTag) record.recordChangeTag = changeTag;
    try {
      const res = await db.saveRecords([record]);
      if (res.hasErrors) throw res.errors[0];
      showRecord(res.records[0]);
      log("Saved record.", "ok");
    } catch (e) {
      log("Save failed: " + ckError(e) + (changeTag ? "" : " (tip: press Load first if a record already exists)"), "err");
    }
  }

  function start() {
    $("mode").textContent = describeDevice();
    $("container").textContent = cfg.containerIdentifier || "(not configured)";
    if (!cfg.containerIdentifier || !cfg.apiToken) {
      log("config.js has no container identifier or API token yet.", "err");
      return;
    }
    CloudKit.configure({
      containers: [{
        containerIdentifier: cfg.containerIdentifier,
        apiTokenAuth: {
          apiToken: cfg.apiToken,
          persist: true,
          signInButton: { id: "apple-sign-in-button", theme: "black" },
          signOutButton: { id: "apple-sign-out-button", theme: "black" },
        },
        environment: cfg.environment || "development",
      }],
    });
    const container = CloudKit.getDefaultContainer();
    db = container.privateCloudDatabase;

    const waitForSignIn = () => container.whenUserSignsIn().then((id) => { setSignedIn(id); log("Signed in.", "ok"); load(); waitForSignOut(); })
      .catch((e) => log("Sign-in failed: " + ckError(e), "err"));
    const waitForSignOut = () => container.whenUserSignsOut().then(() => { setSignedIn(null); showRecord(null); log("Signed out."); waitForSignIn(); });

    container.setUpAuth().then((identity) => {
      if (identity) { setSignedIn(identity); log("Session restored.", "ok"); load(); waitForSignOut(); }
      else { setSignedIn(null); log("Please sign in."); waitForSignIn(); }
    }).catch((e) => log("Auth setup failed: " + ckError(e), "err"));
  }

  $("save").addEventListener("click", save);
  $("load").addEventListener("click", load);
  // cloudkit.js may finish before or after this script; start exactly once either way.
  let started = false;
  const startOnce = () => { if (!started && window.CloudKit) { started = true; start(); } };
  window.addEventListener("cloudkitloaded", startOnce);
  const ckScript = document.querySelector('script[src*="cloudkit.js"]');
  if (ckScript) ckScript.addEventListener("load", startOnce);
  startOnce();
})();
