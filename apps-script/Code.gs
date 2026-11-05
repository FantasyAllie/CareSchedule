/**
 * CareSchedule – Google Drive version.
 *
 * Serves the rota (CareSchedule.html, kept in a shared Google Drive folder) as a private web page and keeps the
 * data in that same folder: every change is saved as a new file ("CareSchedule data <date time> (change N).json"),
 * and opening the rota loads the newest one – so to go back, delete the newer files. Only ONE person can have the rota open at a time: anyone else who opens the link is
 * shown who is using it, and gets in once they close it, leave it unused for 15 minutes, or their device stops
 * checking in for 90 seconds (e.g. the phone went to sleep).
 *
 * Set up (see README → Google Drive version):
 *   1. Put CareSchedule.html in a Google Drive folder and share the folder (Editor) with everyone who uses the rota.
 *   2. Paste the folder's ID below (the long code at the end of the folder's web address).
 *   3. Deploy → New deployment → Web app, "Execute as: User accessing the web app",
 *      "Who has access: Anyone with a Google account". Only people the folder is shared with can open the rota.
 */
const FOLDER_ID = 'PASTE-THE-FOLDER-ID-HERE';

const PAGE_FILE = 'CareSchedule.html';
const DATA_PREFIX = 'CareSchedule data ';
const DATA_NAME = /^CareSchedule data (\d{4}-\d{2}-\d{2}) (\d{2}\.\d{2}\.\d{2}) \(change (\d+)\)\.json$/;
const OLD_DATA_FILE = 'careschedule-online.json'; // used by the first version of this script – still read if it's all there is
const KEEP_CHANGES = 200; // the newest changes kept in full…
const KEEP_DAYS = 30;     // …and before those, the last change of each day for this many days
const STALE_MS = 90 * 1000; // an open page checks in every 20 seconds; after this long without, it is treated as closed

function doGet() {
  let html;
  try {
    const page = newest_(folder_().getFilesByName(PAGE_FILE));
    if (!page) throw new Error(`There is no ${PAGE_FILE} in the CareSchedule folder – upload it there.`);
    html = page.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    html = `<!doctype html><meta charset="utf-8"><div style="font:16px system-ui;max-width:520px;margin:40px auto;padding:0 16px">
      <h2>CareSchedule</h2><p>${escape_(e.message)}</p></div>`;
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('CareSchedule')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- called from the page (google.script.run) ----------

/** Open the rota if nobody else has it open. takeOver: the same person may move it from another of their devices. */
function csOpen(session, device, takeOver) {
  return withLock_(() => {
    folder_(); // only people the folder is shared with get any answer
    const me = me_();
    const lock = currentLock_();
    if (lock && lock.session !== session && !(takeOver && lock.email === me.email)) {
      return { ok: false, holder: holderView_(lock, me.email) };
    }
    const now = Date.now();
    writeLock_({ session, email: me.email, name: me.name, device: String(device || ''), since: lock && lock.session === session ? lock.since : now, ping: now, request: null });
    const file = latestData_(folder_());
    return { ok: true, me: me.name, data: file ? file.getBlob().getDataAsString('UTF-8') : null, version: version_() };
  });
}

/** "Still here" from the open page, every 20 seconds. Also passes on a request from someone waiting. */
function csPing(session) {
  return withLock_(() => {
    folder_(); // only people the folder is shared with get any answer
    const raw = rawLock_();
    if (raw && raw.session === session) {
      raw.ping = Date.now();
      writeLock_(raw);
      return { ok: true, request: raw.request || null };
    }
    const lock = currentLock_();
    return { ok: false, holder: lock ? holderView_(lock, me_().email) : null };
  });
}

/** Save the rota. Only the page that has it open can save, and only on top of the version it was given. */
function csSave(session, expectedVersion, json) {
  return withLock_(() => {
    folder_(); // only people the folder is shared with get any answer
    const raw = rawLock_();
    if (!raw || raw.session !== session) {
      const lock = currentLock_();
      return { ok: false, holder: lock ? holderView_(lock, me_().email) : null };
    }
    if (Number(expectedVersion) !== version_()) return { ok: false, holder: null, reason: 'conflict' };
    JSON.parse(json); // refuse anything that isn't a rota
    const folder = folder_();
    const v = version_() + 1;
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm.ss');
    folder.createFile(`${DATA_PREFIX}${stamp} (change ${v}).json`, json, 'application/json');
    PropertiesService.getScriptProperties().setProperty('version', String(v));
    if (v % 10 === 0) tidy_(folder);
    raw.ping = Date.now();
    writeLock_(raw);
    return { ok: true, version: v };
  });
}

/** Close the rota so the next person can get in. */
function csClose(session) {
  return withLock_(() => {
    const raw = rawLock_();
    if (raw && raw.session === session) PropertiesService.getScriptProperties().deleteProperty('lock');
    return { ok: true };
  });
}

/** Ask whoever has it open to close it. */
function csAsk(session, device) {
  return withLock_(() => {
    folder_(); // only people the folder is shared with get any answer
    const me = me_();
    const lock = currentLock_();
    if (!lock || lock.session === session) return { ok: true, holder: null };
    lock.request = { name: me.name, email: me.email, device: String(device || ''), at: Date.now() };
    writeLock_(lock);
    return { ok: true, holder: holderView_(lock, me.email) };
  });
}

// ---------- helpers ----------

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function folder_() {
  if (!FOLDER_ID || FOLDER_ID.indexOf('PASTE') === 0) throw new Error('The folder ID has not been filled in at the top of Code.gs yet.');
  try {
    return DriveApp.getFolderById(FOLDER_ID);
  } catch (e) {
    throw new Error(`You (${me_().email || 'this account'}) don't have access to the CareSchedule folder – ask whoever set it up to share it with you.`);
  }
}

function me_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  const name = email ? email.split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Someone';
  return { email, name };
}

function rawLock_() {
  const raw = PropertiesService.getScriptProperties().getProperty('lock');
  return raw ? JSON.parse(raw) : null;
}
function currentLock_() {
  const lock = rawLock_();
  return lock && Date.now() - lock.ping < STALE_MS ? lock : null;
}
function writeLock_(lock) {
  PropertiesService.getScriptProperties().setProperty('lock', JSON.stringify(lock));
}
function holderView_(lock, email) {
  return { name: lock.name, device: lock.device, since: lock.since, mine: !!email && lock.email === email, asked: !!lock.request && lock.request.email === email };
}
function version_() {
  return Number(PropertiesService.getScriptProperties().getProperty('version') || 0);
}

function newest_(files) {
  let best = null;
  while (files.hasNext()) {
    const f = files.next();
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return best;
}

/** Every saved copy in the folder, newest first. */
function dataFiles_(folder) {
  const all = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = DATA_NAME.exec(f.getName());
    if (m) all.push({ file: f, day: m[1], key: `${m[1]} ${m[2]}`, change: Number(m[3]) });
  }
  return all.sort((a, b) => (a.key !== b.key ? (a.key < b.key ? 1 : -1) : b.change - a.change));
}

function latestData_(folder) {
  const files = dataFiles_(folder);
  if (files.length) return files[0].file;
  return newest_(folder.getFilesByName(OLD_DATA_FILE));
}

/** Keeps the newest KEEP_CHANGES copies, and before those the last copy of each day for KEEP_DAYS days. */
function tidy_(folder) {
  const files = dataFiles_(folder);
  const cutoff = Utilities.formatDate(new Date(Date.now() - KEEP_DAYS * 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const daysKept = new Set();
  files.forEach((f, i) => {
    if (i < KEEP_CHANGES) return;
    if (f.day >= cutoff && !daysKept.has(f.day)) { daysKept.add(f.day); return; }
    try { f.file.setTrashed(true); } catch (e) { /* only the person who saved a copy can bin it in a shared folder – their next tidy-up will */ }
  });
}

function escape_(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
