// Runs apps-script/Code.gs in Node with small stand-ins for the Google services it uses (Drive, properties, lock, session).
const vm = require('vm'), fs = require('fs');
module.exports = function makeGas(codePath, opts = {}) {
  const props = new Map();
  let now = () => Date.now();
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const sharedWith = new Set(opts.sharedWith || []);
  let currentUser = '';
  function mkFile(name, content, owner) {
    const f = { name, content, updated: new Date(), owner, trashed: false,
      getName: () => f.name, getLastUpdated: () => f.updated,
      getBlob: () => ({ getDataAsString: () => f.content }),
      setContent: c => { f.content = c; f.updated = new Date(); return f; },
      setTrashed: t => { if (currentUser !== f.owner) throw new Error('Access denied'); f.trashed = t; } };
    return f;
  }
  function mkFolder(name) {
    const d = { name, files: [], folders: [],
      getFilesByName: n => iter(d.files.filter(f => f.name === n && !f.trashed)),
      getFiles: () => iter(d.files.filter(f => !f.trashed)),
      getFoldersByName: n => iter(d.folders.filter(x => x.name === n)),
      createFile: (n, c) => { const f = mkFile(n, c, currentUser); d.files.push(f); return f; },
      createFolder: n => { const x = mkFolder(n); d.folders.push(x); return x; } };
    return d;
  }
  const root = mkFolder('CareSchedule');
  root.files.push(mkFile('CareSchedule.html', fs.readFileSync(opts.page, 'utf8'), 'owner@x.uk'));
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => props.set(k, String(v)), deleteProperty: k => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => currentUser }), getScriptTimeZone: () => 'Europe/London' },
    DriveApp: { getFolderById: id => { if (id !== 'FOLDER123' || !sharedWith.has(currentUser)) throw new Error('No item with the given ID could be found'); return root; } },
    // dates in UTC, from the test's clock: 'yyyy-MM-dd' or 'yyyy-MM-dd HH.mm.ss'
    Utilities: { formatDate: (d, tz, fmt) => { const t = d.toISOString(); return fmt.includes('HH') ? `${t.slice(0, 10)} ${t.slice(11, 19).replace(/:/g, '.')}` : t.slice(0, 10); } },
    HtmlService: { createHtmlOutput: h => { const o = { html: h, title: '', meta: {}, setTitle: t => (o.title = t, o), addMetaTag: (k, v) => (o.meta[k] = v, o) }; return o; } },
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } },
  };
  vm.createContext(ctx);
  const code = fs.readFileSync(codePath, 'utf8').replace("const FOLDER_ID = 'PASTE-THE-FOLDER-ID-HERE';", "const FOLDER_ID = 'FOLDER123';");
  vm.runInContext(code, ctx);
  return {
    root, props,
    setNow: f => { now = f; },
    call(user, fn, args) {
      currentUser = user;
      if (!/^cs[A-Z]\w*$|^doGet$/.test(fn)) throw new Error('not callable: ' + fn);
      return JSON.parse(JSON.stringify(ctx[fn] ? ctx[fn](...args) : vm.runInContext(fn, ctx)(...args)));
    },
    doGet(user) { currentUser = user; return vm.runInContext('doGet', ctx)(); },
  };
};
