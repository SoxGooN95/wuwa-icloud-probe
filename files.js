// iCloud probe, step 2d: store files as CloudKit assets in the private database and read them back.
// Test files are random bytes generated in the browser, so no real data leaves the device.
// Record type "ProbeFile": name (String), size (Int64), sha256 (String), file (Asset).
// The list of uploaded files lives in the ProbeNote record "probe-files" as JSON, so no query index is needed.
(function () {
  const FILE_TYPE = "ProbeFile";
  const NOTE_TYPE = "ProbeNote";
  const MANIFEST = "probe-files";
  const SIZES_MB = [1, 10, 50, 100, 250];
  const $ = (id) => document.getElementById(id);
  const log = (m, c) => window.PROBE && window.PROBE.log(m, c);
  const db = () => window.PROBE && window.PROBE.db;
  let manifest = { tag: null, names: [] };

  const fmtMB = (bytes) => (bytes / 1048576).toFixed(1) + " MB";
  const secs = (t0) => ((performance.now() - t0) / 1000).toFixed(1) + " s";
  const ckError = (e) => !e ? "unknown error" : [e.ckErrorCode, e.serverErrorCode, e.reason, e.message].filter(Boolean).join(" · ");

  async function sha256(blob) {
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function randomBlob(bytes) {
    const parts = [];
    const chunk = 65536; // getRandomValues limit per call
    for (let left = bytes; left > 0; left -= chunk) {
      const a = new Uint8Array(Math.min(chunk, left));
      crypto.getRandomValues(a);
      parts.push(a);
    }
    return new Blob(parts, { type: "application/octet-stream" });
  }

  async function loadManifest() {
    const res = await db().fetchRecords([MANIFEST]);
    if (res.hasErrors) {
      if (res.errors[0] && res.errors[0].ckErrorCode === "NOT_FOUND") { manifest = { tag: null, names: [] }; return; }
      throw res.errors[0];
    }
    const rec = res.records[0];
    manifest = { tag: rec.recordChangeTag, names: JSON.parse(rec.fields.text.value || "[]") };
  }

  async function saveManifest() {
    const rec = { recordType: NOTE_TYPE, recordName: MANIFEST, fields: { text: { value: JSON.stringify(manifest.names) } } };
    if (manifest.tag) rec.recordChangeTag = manifest.tag;
    const res = await db().saveRecords([rec]);
    if (res.hasErrors) throw res.errors[0];
    manifest.tag = res.records[0].recordChangeTag;
  }

  function render() {
    const list = $("files");
    list.innerHTML = "";
    if (!manifest.names.length) { list.textContent = "– no files stored"; return; }
    for (const n of manifest.names) {
      const row = document.createElement("div");
      row.className = "row";
      row.style.marginBottom = "6px";
      const label = document.createElement("span");
      label.textContent = n;
      label.style.flex = "1 1 160px";
      const dl = document.createElement("button");
      dl.textContent = "Download + verify";
      dl.onclick = () => download(n);
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.onclick = () => remove(n);
      row.append(label, dl, del);
      list.append(row);
    }
  }

  async function upload(name, blob) {
    try {
      log(`Hashing ${name} (${fmtMB(blob.size)}) …`);
      const hash = await sha256(blob);
      const recordName = "file-" + name.replace(/[^A-Za-z0-9._-]/g, "_");
      // An existing record with the same name needs its change tag to be overwritten.
      const prev = await db().fetchRecords([recordName]);
      const prevTag = !prev.hasErrors && prev.records[0] ? prev.records[0].recordChangeTag : null;
      const record = {
        recordType: FILE_TYPE,
        recordName,
        fields: { name: { value: name }, size: { value: blob.size }, sha256: { value: hash }, file: { value: blob } },
      };
      if (prevTag) record.recordChangeTag = prevTag;
      const t0 = performance.now();
      log(`Uploading ${name} …`);
      const res = await db().saveRecords([record]);
      if (res.hasErrors) throw res.errors[0];
      const t = secs(t0);
      await loadManifest();
      if (!manifest.names.includes(recordName)) { manifest.names.push(recordName); await saveManifest(); }
      render();
      log(`Uploaded ${name}: ${fmtMB(blob.size)} in ${t}.`, "ok");
    } catch (e) {
      log(`Upload ${name} failed: ${ckError(e)}`, "err");
    }
  }

  async function download(recordName) {
    try {
      const t0 = performance.now();
      const res = await db().fetchRecords([recordName]);
      if (res.hasErrors) throw res.errors[0];
      const f = res.records[0].fields;
      const url = f.file && f.file.value && f.file.value.downloadURL;
      if (!url) throw { message: "record has no downloadURL" };
      const blob = await (await fetch(url)).blob();
      const t = secs(t0);
      const hash = await sha256(blob);
      const same = hash === f.sha256.value && blob.size === f.size.value;
      log(`Downloaded ${f.name.value}: ${fmtMB(blob.size)} in ${t}, checksum ${same ? "matches" : "DIFFERS"}.`, same ? "ok" : "err");
    } catch (e) {
      log(`Download ${recordName} failed: ${ckError(e)}`, "err");
    }
  }

  async function remove(recordName) {
    try {
      const res = await db().deleteRecords([recordName]);
      if (res.hasErrors && !(res.errors[0] && res.errors[0].ckErrorCode === "NOT_FOUND")) throw res.errors[0];
      await loadManifest();
      manifest.names = manifest.names.filter((n) => n !== recordName);
      await saveManifest();
      render();
      log(`Deleted ${recordName}.`, "ok");
    } catch (e) {
      log(`Delete ${recordName} failed: ${ckError(e)}`, "err");
    }
  }

  function setEnabled(on) {
    document.querySelectorAll("#files-section button, #files-section input").forEach((el) => { el.disabled = !on; });
  }

  function init() {
    const sizes = $("sizes");
    for (const mb of SIZES_MB) {
      const b = document.createElement("button");
      b.textContent = mb + " MB";
      b.onclick = () => upload(`random-${mb}MB.bin`, randomBlob(mb * 1048576));
      sizes.append(b);
    }
    $("pick").addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (file) upload(file.name, file);
      ev.target.value = "";
    });
    $("refresh").onclick = async () => {
      try { await loadManifest(); render(); log("File list loaded.", "ok"); } catch (e) { log("File list failed: " + ckError(e), "err"); }
    };
    setEnabled(false);
    window.addEventListener("probe-auth", async (ev) => {
      setEnabled(ev.detail);
      if (ev.detail) { try { await loadManifest(); render(); } catch (e) { log("File list failed: " + ckError(e), "err"); } }
      else { manifest = { tag: null, names: [] }; render(); }
    });
  }

  init();
})();
