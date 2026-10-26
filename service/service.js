/*
 * Wallpaper helper for the launcher, running on the TV:
 *   share  (subscribe)  serves a page on the LAN that phones send a picture to (a file, or a Google
 *                       Photos / image link), and tells the launcher when one arrives. The page is up
 *                       only while the launcher's wallpaper panel is open.
 *   bing                Bing's pictures of the day, the last 15 or so.
 */
var http = require('http');
var https = require('https');
var os = require('os');
var fs = require('fs');
var path = require('path');
var Service = require('webos-service');

var service = new Service('com.gathin.tvhome.service');
var PORT = 8099;
var MAX_BYTES = 8 * 1024 * 1024;   // the launcher keeps pictures in localStorage: phones send ~0.5 MB
var PAGE = fs.readFileSync(path.join(__dirname, 'upload.html'));
// Every picture a phone sends is also kept here for the screensaver (tv/screensaver.qml).
var PHOTO_DIR = '/media/internal/tvhome-photos';   // the service's jail can write here
var MAX_PHOTOS = 60;
var EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

var server = null, latest = null, serial = 0;
var watchers = [];

function lanAddress() {
  var ifaces = os.networkInterfaces();
  for (var name in ifaces) {
    for (var i = 0; i < ifaces[name].length; i++) {
      var a = ifaces[name][i];
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

/** GET a URL, following redirects: resolves to {type, body}. */
function get(url, redirects) {
  if (redirects === undefined) redirects = 5;
  return new Promise(function (resolve, reject) {
    var lib = url.indexOf('https:') === 0 ? https : http;
    var req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      var chunks = [], size = 0;
      res.on('data', function (c) {
        size += c.length;
        if (size > MAX_BYTES) { req.abort(); reject(new Error('Ảnh quá lớn')); return; }
        chunks.push(c);
      });
      res.on('end', function () { resolve({ type: res.headers['content-type'] || '', body: Buffer.concat(chunks) }); });
    });
    req.on('error', reject);
    req.setTimeout(20000, function () { req.abort(); reject(new Error('Hết thời gian chờ')); });
  });
}

/** The picture behind a link: an image URL, or the og:image of a page such as a Google Photos share. */
function fromLink(link) {
  return get(link).then(function (r) {
    if (/^image\//.test(r.type)) return r;
    var html = r.body.toString('utf8');
    var m = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html) ||
      /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html);
    if (!m) throw new Error('Không tìm thấy ảnh trong link này');
    var img = m[1].replace(/&amp;/g, '&');
    // Google Photos serves any size: ask for the screen's.
    if (/googleusercontent\.com/.test(img)) img = img.replace(/=[\w-]*$/, '') + '=w1920-h1080-c';
    return get(img).then(function (r2) {
      if (!/^image\//.test(r2.type)) throw new Error('Link không phải ảnh');
      return r2;
    });
  });
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BYTES) { reject(new Error('Ảnh quá lớn')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/** Saves a phone picture for the screensaver, dropping the oldest beyond MAX_PHOTOS. */
function keepPhoto(type, body) {
  try {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(path.join(PHOTO_DIR, Date.now() + (EXTENSIONS[type] || '.jpg')), body);
    var names = fs.readdirSync(PHOTO_DIR).sort();   // names are timestamps: oldest first
    names.slice(0, Math.max(0, names.length - MAX_PHOTOS)).forEach(function (n) {
      fs.unlinkSync(path.join(PHOTO_DIR, n));
    });
  } catch (e) {
    console.error('keepPhoto: ' + e.message);   // the wallpaper still works without it
  }
}

function setLatest(type, body) {
  latest = { type: type.split(';')[0], body: body };
  keepPhoto(latest.type, body);
  serial++;
  watchers.forEach(function (msg) { msg.respond({ returnValue: true, subscribed: true, uploaded: serial }); });
}

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');   // the launcher reads /latest from file://
  var url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  } else if (req.method === 'GET' && url === '/latest') {
    if (!latest) { reply(res, 404, { ok: false }); return; }
    res.writeHead(200, { 'Content-Type': latest.type, 'Cache-Control': 'no-store' });
    res.end(latest.body);
  } else if (req.method === 'POST' && url === '/upload') {
    readBody(req).then(function (body) {
      var type = req.headers['content-type'] || '';
      if (!/^image\//.test(type) || !body.length) throw new Error('Tệp không phải ảnh');
      setLatest(type, body);
      reply(res, 200, { ok: true });
    }).catch(function (e) { reply(res, 400, { ok: false, error: e.message }); });
  } else if (req.method === 'POST' && url === '/link') {
    readBody(req).then(function (body) {
      var link = (JSON.parse(body.toString('utf8')).url || '').trim();
      if (!/^https?:\/\//i.test(link)) throw new Error('Link không hợp lệ');
      return fromLink(link);
    }).then(function (r) {
      setLatest(r.type, r.body);
      reply(res, 200, { ok: true });
    }).catch(function (e) { reply(res, 400, { ok: false, error: e.message }); });
  } else {
    reply(res, 404, { ok: false });
  }
}

function startServer() {
  if (server) return Promise.resolve();
  return new Promise(function (resolve, reject) {
    server = http.createServer(handle);
    server.on('error', function (e) { server = null; reject(e); });
    server.listen(PORT, resolve);
  });
}

function stopServer() {
  if (server) server.close();
  server = null;
  latest = null;
}

service.register('share', function (msg) {
  startServer().then(function () {
    if (msg.isSubscription) watchers.push(msg);
    msg.respond({ returnValue: true, subscribed: !!msg.isSubscription, url: 'http://' + lanAddress() + ':' + PORT + '/' });
  }, function (e) {
    msg.respond({ returnValue: false, errorText: e.message });
  });
}, function (msg) {
  watchers = watchers.filter(function (m) { return m !== msg; });
  if (!watchers.length) stopServer();   // the panel closed: don't leave the page up
});

// The launcher's LG home button: the Home watcher (tv/home-watch.sh) leaves LG's home alone when
// this file is fresh. The watcher runs as root outside the service's jail; /media/internal is shared.
var LG_HOME_FLAG = '/media/internal/.tvhome-lghome';

service.register('allowLgHome', function (msg) {
  try {
    fs.writeFileSync(LG_HOME_FLAG, String(Date.now()));
    msg.respond({ returnValue: true });
  } catch (e) {
    msg.respond({ returnValue: false, errorText: e.message });
  }
});

service.register('bing', function (msg) {
  var mkt = (msg.payload && msg.payload.mkt) || 'en-US';
  var base = 'https://www.bing.com/HPImageArchive.aspx?format=js&n=8&mkt=' + encodeURIComponent(mkt) + '&idx=';
  Promise.all([get(base + 0), get(base + 7)]).then(function (rs) {
    var seen = {}, images = [];
    rs.forEach(function (r) {
      (JSON.parse(r.body.toString('utf8')).images || []).forEach(function (im) {
        if (seen[im.urlbase]) return;
        seen[im.urlbase] = true;
        images.push({
          date: im.startdate,
          title: im.copyright || im.title || '',
          thumb: 'https://www.bing.com' + im.urlbase + '_400x240.jpg',
          url: 'https://www.bing.com' + im.urlbase + '_1920x1080.jpg'
        });
      });
    });
    images.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    msg.respond({ returnValue: true, images: images });
  }).catch(function (e) {
    msg.respond({ returnValue: false, errorText: e.message });
  });
});

// Uninstalling, for the launcher's hold-OK menu. Apps may not do this themselves: it works once
// Homebrew Channel's elevate-service has made this service root (install-root.sh does).
var DEV_APPS = '/media/developer/apps/usr/palm/applications/';

service.register('removeApp', function (msg) {
  if (needRoot(msg)) return;
  var id = (msg.payload && msg.payload.id) || '';
  if (!/^[\w.-]+$/.test(id) || id === 'com.gathin.tvhome') {
    msg.respond({ returnValue: false, errorText: 'Không gỡ được ứng dụng này' });
    return;
  }
  var dev = fs.existsSync(DEV_APPS + id);   // installed in developer mode, not from LG's store
  var sub = service.subscribe('luna://com.webos.appInstallService/' + (dev ? 'dev/remove' : 'remove'),
    { id: id, subscribe: true });
  var done = false, timer;
  function finish(ok, text) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    sub.cancel();
    msg.respond(ok ? { returnValue: true } : { returnValue: false, errorText: text });
  }
  sub.on('response', function (m) {
    var s = JSON.stringify(m.payload || {});
    if (/"state":"removed"/.test(s)) finish(true);
    else if (/"returnValue":false|remove failed/.test(s)) {
      finish(false, /Denied/.test(s) ? 'Dịch vụ chưa có quyền root (elevate-service)' : 'Không gỡ được: ' + s.slice(0, 120));
    }
  });
  timer = setTimeout(function () { finish(false, 'Hết thời gian chờ'); }, 60000);
});

// ---- running as root (Homebrew Channel's elevateService): apps, icons, advanced features ----

var child_process = require('child_process');

function isRoot() { return typeof process.getuid === 'function' && process.getuid() === 0; }

function lunaCall(uri, params) {
  return new Promise(function (resolve) {
    service.call(uri, params || {}, function (m) { resolve(m.payload || {}); });
  });
}

// Root methods answer only the launcher, and luna-send from a root shell (install-root.sh):
// another app on the TV must not uninstall apps or change boot scripts through this service.
function callerOf(msg) {
  return String(msg.sender || (msg.message && msg.message.senderAppID && msg.message.senderAppID()) || '');
}

function needRoot(msg) {
  var caller = callerOf(msg);
  if (!/^(com\.gathin\.tvhome|com\.webos\.lunasend)(-\d+)?$/.test(caller)) {   // exactly these, maybe with a -pid
    msg.respond({ returnValue: false, errorCode: 'DENIED', errorText: 'not allowed for ' + (caller || 'unknown caller') });
    return true;
  }
  if (isRoot()) return false;
  msg.respond({ returnValue: false, errorCode: 'NOT_ROOT', errorText: 'Dịch vụ chưa có quyền root' });
  return true;
}

// The best icon a launch point has on disk: LG's own list only gives apps a 130px one.
function iconFile(p) {
  var c = [p.extraLargeIcon, p.largeIcon, p.mediumLargeIcon, p.icon];
  for (var i = 0; i < c.length; i++) {
    if (c[i] && c[i].charAt(0) === '/' && fs.existsSync(c[i])) return c[i];
  }
  return '';
}

/** The TV's apps, as sync-apps.py would write them into apps.js (icons come from icon()). */
service.register('apps', function (msg) {
  if (needRoot(msg)) return;
  Promise.all([
    lunaCall('luna://com.webos.applicationManager/listLaunchPoints', {}),
    lunaCall('luna://com.webos.service.eim/getAllInputStatus', {})
  ]).then(function (r) {
    var apps = (r[0].launchPoints || []).filter(function (p) {
      return !p.hidden && p.id !== 'com.gathin.tvhome';
    }).map(function (p) {
      var f = iconFile(p), mtime = 0;
      try { mtime = fs.statSync(f).mtime.getTime(); } catch (e) { /* no icon on disk */ }
      return { id: p.id, title: p.title, icon: f, iconKey: f + '@' + mtime, iconColor: p.iconColor || p.bgColor || '' };
    });
    var inputs = (r[1].devices || []).filter(function (d) { return d.appId; }).map(function (d) {
      return { appId: d.appId, label: d.label || d.id };
    });
    msg.respond({ returnValue: true, apps: apps, inputs: inputs, synced: Date.now() });
  }).catch(function (e) {
    msg.respond({ returnValue: false, errorText: e.message });
  });
});

var ICON_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** One icon file as a data: URL: a canvas reading it isn't tainted, so the launcher gets its colours. */
service.register('icon', function (msg) {
  if (needRoot(msg)) return;
  var f = (msg.payload && msg.payload.file) || '';
  var type = ICON_TYPES[path.extname(f).toLowerCase()];
  if (!type || f.indexOf('..') >= 0 || !/\/(icon|launcher|assets|resources|applications)/i.test(f)) {
    msg.respond({ returnValue: false, errorText: 'not an icon' });
    return;
  }
  fs.readFile(f, function (err, data) {
    if (err) msg.respond({ returnValue: false, errorText: err.message });
    else msg.respond({ returnValue: true, data: 'data:' + type + ';base64,' + data.toString('base64') });
  });
});

// Advanced features: scripts in tv/ that Homebrew Channel runs from init.d at every boot.
var INIT_D = '/var/lib/webosbrew/init.d/';
var SCREENSAVER_QML = '/media/developer/tvhome-screensaver/main.qml';
var LG_SCREENSAVER = '/usr/palm/applications/com.webos.app.screensaver/qml/main.qml';
var FEATURES = {
  homeWatch: { script: 'home-watch.sh', file: 'tvhome-homewatch', off: 'pkill -f "tvhome-homewatch[ ]run"' },
  screensaver: { script: 'screensaver.sh', file: 'tvhome-screensaver', off: 'umount ' + LG_SCREENSAVER },
  noAssistant: { script: 'no-assistant.sh', file: 'tvhome-noassistant', off: '' }   // back after a reboot
};

function featureStates() {
  var s = {};
  Object.keys(FEATURES).forEach(function (k) { s[k] = fs.existsSync(INIT_D + FEATURES[k].file); });
  return s;
}

/** Puts a feature's script in init.d and runs it now (the scripts restart themselves if running). */
function enableFeature(name) {
  var f = FEATURES[name], dest = INIT_D + f.file;
  fs.mkdirSync(INIT_D, { recursive: true });
  if (name === 'screensaver') {
    fs.mkdirSync(path.dirname(SCREENSAVER_QML), { recursive: true });
    // Written in place: the bind mount follows the file, so an update is live at once.
    fs.writeFileSync(SCREENSAVER_QML, fs.readFileSync(path.join(__dirname, 'tv', 'screensaver.qml')));
  }
  fs.writeFileSync(dest, fs.readFileSync(path.join(__dirname, 'tv', f.script)));
  fs.chmodSync(dest, 493);   // 0755
  child_process.spawn('/bin/sh', [dest], { detached: true, stdio: 'ignore' }).unref();
}

function disableFeature(name) {
  var f = FEATURES[name];
  try { fs.unlinkSync(INIT_D + f.file); } catch (e) { /* already off */ }
  if (f.off) child_process.exec(f.off, function () {});
}

service.register('status', function (msg) {
  msg.respond({ returnValue: true, root: isRoot(), features: featureStates() });
});

service.register('setFeature', function (msg) {
  if (needRoot(msg)) return;
  var p = msg.payload || {};
  if (!FEATURES[p.name]) { msg.respond({ returnValue: false, errorText: 'unknown feature' }); return; }
  try {
    if (p.on) enableFeature(p.name); else disableFeature(p.name);
    msg.respond({ returnValue: true, features: featureStates() });
  } catch (e) {
    msg.respond({ returnValue: false, errorText: e.message });
  }
});

/** After an update: the features that are on get this version's scripts. */
service.register('refreshFeatures', function (msg) {
  if (needRoot(msg)) return;
  var on = featureStates();
  try {
    Object.keys(on).forEach(function (k) { if (on[k]) enableFeature(k); });
    msg.respond({ returnValue: true, features: on });
  } catch (e) {
    msg.respond({ returnValue: false, errorText: e.message });
  }
});
