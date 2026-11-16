// iCloud probe, step 2d (revised): game data as one file in iCloud Drive.
// - The file is picked once per device and update, verified (SHA-256) and kept in IndexedDB.
// - The published data version is a normal record ("data-version", type ProbeNote) in the private database.
//   On sign-in the page compares it with the local copy and offers the file picker if a newer version exists.
(function () {
  const NOTE_TYPE = "ProbeNote";
  const VERSION_RECORD = "data-version";
  const $ = (id) => document.getElementById(id);
  const log = (m, c) => window.PROBE && window.PROBE.log(m, c);
  const db = () => window.PROBE && window.PROBE.db;
  const fmtMB = (b) => (b / 1048576).toFixed(2) + " MB";
  let published = null; // { version, date }

  // --- IndexedDB (one store, one key) ---
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("wuwa-probe", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(key, value) {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction("files", "readwrite");
      tx.objectStore("files").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key) {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const req = d.transaction("files").objectStore("files").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function sha256(blob) {
    const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function showLocal() {
    const local = await idbGet("gamedata");
    $("gd-local").textContent = local
      ? `${local.name} · ${fmtMB(local.size)} · version ${local.version || "–"} · imported ${new Date(local.importedAt).toLocaleString()} · sha256 ${local.sha256.slice(0, 12)}…`
      : "– nothing stored";
    try {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
      $("gd-storage").textContent = (est ? `used ${fmtMB(est.usage || 0)} of ${fmtMB(est.quota || 0)}` : "no estimate") + ` · persistent: ${persisted === null ? "unknown" : persisted}`;
    } catch (e) {
      $("gd-storage").textContent = "storage info unavailable";
    }
    return local;
  }

  async function importFile(file) {
    try {
      const t0 = performance.now();
      const hash = await sha256(file);
      await idbPut("gamedata", {
        name: file.name, size: file.size, sha256: hash, importedAt: Date.now(),
        version: published ? published.version : null, blob: file,
      });
      if (navigator.storage && navigator.storage.persist) {
        const ok = await navigator.storage.persist();
        log(`Persistent storage requested: ${ok}`);
      }
      // Read back to prove it is stored, not just held in memory.
      const back = await idbGet("gamedata");
      const same = back && (await sha256(back.blob)) === hash;
      log(`Imported ${file.name} (${fmtMB(file.size)}) in ${((performance.now() - t0) / 1000).toFixed(1)} s, read-back ${same ? "matches" : "DIFFERS"}.`, same ? "ok" : "err");
      await showLocal();
      await checkVersion();
    } catch (e) {
      log(`Import failed: ${e && (e.message || e.name) || e}`, "err");
    }
  }

  async function checkVersion() {
    const banner = $("gd-banner");
    banner.hidden = true;
    if (!db()) return;
    try {
      const res = await db().fetchRecords([VERSION_RECORD]);
      if (res.hasErrors) {
        if (res.errors[0] && res.errors[0].ckErrorCode === "NOT_FOUND") { published = null; $("gd-published").textContent = "– none"; return; }
        throw res.errors[0];
      }
      const rec = res.records[0];
      published = JSON.parse(rec.fields.text.value);
      published.tag = rec.recordChangeTag;
      $("gd-published").textContent = `${published.version} (${new Date(published.date).toLocaleString()})`;
      const local = await idbGet("gamedata");
      if (!local || local.version !== published.version) {
        banner.hidden = false;
        $("gd-banner-text").textContent = `New game data available: ${published.version}`;
      }
    } catch (e) {
      log("Version check failed: " + (e.ckErrorCode || e.message || e), "err");
    }
  }

  async function publishVersion() {
    const version = $("gd-version").value.trim();
    if (!version) { log("Enter a version first.", "err"); return; }
    try {
      const rec = { recordType: NOTE_TYPE, recordName: VERSION_RECORD, fields: { text: { value: JSON.stringify({ version, date: Date.now() }) } } };
      const prev = await db().fetchRecords([VERSION_RECORD]);
      if (!prev.hasErrors && prev.records[0]) rec.recordChangeTag = prev.records[0].recordChangeTag;
      const res = await db().saveRecords([rec]);
      if (res.hasErrors) throw res.errors[0];
      log(`Published data version ${version}.`, "ok");
      await checkVersion();
    } catch (e) {
      log("Publish failed: " + (e.ckErrorCode || e.message || e), "err");
    }
  }

  function init() {
    $("gd-pick").addEventListener("change", (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) importFile(f);
      ev.target.value = "";
    });
    $("gd-banner-btn").onclick = () => $("gd-pick").click();
    $("gd-publish").onclick = publishVersion;
    showLocal();
    window.addEventListener("probe-auth", (ev) => {
      $("gd-publish").disabled = !ev.detail;
      if (ev.detail) checkVersion();
    });
    $("gd-publish").disabled = true;
  }
  init();
})();
