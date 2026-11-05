/**
 * CareSchedule – Google Drive version.
 *
 * Serves the rota (CareSchedule.html, kept in a shared Google Drive folder) as a private web page and keeps the
 * data in that same folder. Only ONE person can have the rota open at a time: anyone else who opens the link is
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
const DATA_FILE = 'careschedule-online.json';
const BACKUP_FOLDER = 'backups';
const KEEP_BACKUPS = 30;
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
    const file = newest_(folder_().getFilesByName(DATA_FILE));
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
    const file = newest_(folder.getFilesByName(DATA_FILE));
    if (file) {
      backup_(folder, file);
      file.setContent(json);
    } else {
      folder.createFile(DATA_FILE, json, 'application/json');
    }
    const v = version_() + 1;
    const props = PropertiesService.getScriptProperties();
    props.setProperty('version', String(v));
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

/** The first save each day keeps the previous copy in backups/, for the last 30 days. */
function backup_(folder, file) {
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const name = `careschedule-online-${day}.json`;
  const backups = folder.getFoldersByName(BACKUP_FOLDER);
  const dir = backups.hasNext() ? backups.next() : folder.createFolder(BACKUP_FOLDER);
  if (dir.getFilesByName(name).hasNext()) return;
  dir.createFile(name, file.getBlob().getDataAsString('UTF-8'), 'application/json');
  const all = [];
  const it = dir.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^careschedule-online-\d{4}-\d{2}-\d{2}\.json$/.test(f.getName())) all.push(f);
  }
  all.sort((a, b) => (a.getName() < b.getName() ? 1 : -1));
  all.slice(KEEP_BACKUPS).forEach(f => {
    try { f.setTrashed(true); } catch (e) { /* only the file's owner can bin it in a shared folder – their next save will */ }
  });
}

function escape_(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
