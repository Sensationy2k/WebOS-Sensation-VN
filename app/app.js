/*
 * tvOS style home for webOS: black, a pinned dock row, an app grid, and one glass highlight that
 * springs between tiles. A port of the Android launcher in ../../launcher.
 *
 * webOS does not let third-party apps list installed apps, so sync-apps.py writes them into apps.js.
 */
(function () {
  'use strict';

  var COLUMNS = Math.max(1, CONFIG.columns || 4);
  var TILE_W = 360, TILE_H = 202;
  var CELL_W = (1920 - 2 * 112) / COLUMNS;
  var ROW_PITCH = 292;
  var DOCK_TOP = 708;           // tile top of the dock row: next row peeks in at the bottom
  var DOCK_GAP = 36;            // extra space below the dock
  var FOCUS_SCALE = 1.1;
  var GLASS_PAD = 12;           // room for the glass glow around the scaled tile
  var VIEW_TOP = 80, VIEW_BOTTOM = 1060;    // area grid rows scroll into (the header hides below the dock)

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, RED: 403, INFO: 457 };

  var GREETINGS = [[5, 'Good night'], [12, 'Good morning'], [17, 'Good afternoon'], [22, 'Good evening'], [24, 'Good night']];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];

  var ICON_INPUT = 'M18,7V4c0,-1.1 -0.9,-2 -2,-2H8C6.9,2 6,2.9 6,4v3H5v6l3,6v3h8v-3l3,-6V7H18zM8,4h8v3h-2V5h-1v2h-2V5h-1v2H8V4z';
  var ICON_LIVETV = 'M21,6h-7.59l3.29,-3.29L16,2l-4,4l-4,-4l-0.71,0.71L10.59,6H3c-1.1,0 -2,0.89 -2,2v12c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.89 2,-2V8C23,6.89 22.1,6 21,6zM21,20H3V8h18V20zM9,10v8l7,-4L9,10z';

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), tilesEl = $('tiles'), glass = $('glass'), hero = $('hero');
  var ambients = [$('ambientA'), $('ambientB')], ambientFront = 0, ambientColor = null;
  var pills = [$('btnInputs'), $('btnWifi'), $('btnWallpaper'), $('btnLgHome'), $('btnSettings')];
  var panel = $('inputsPanel'), tileMenu = $('tileMenu');

  var items = [];               // {app, el, color}
  var zone = 'grid';            // 'grid' | 'top' | 'inputs' | 'wall' | 'menu'
  var focused = 0, pillFocus = 0, inputFocus = 0, inputRows = [];
  var offset = 0, heroShown = false, glassShown = false;
  var editing = null;           // {item, snapshot} while a tile is being moved

  // ---- luna bus ------------------------------------------------------------------------------

  var bridges = [];   // keep a reference: a collected bridge drops its callback

  function luna(uri, params, cb) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var res;
        try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
        if (cb) cb(res);
        if (!params || !params.subscribe) bridges.splice(bridges.indexOf(b), 1);
      };
      bridges.push(b);
      b.call(uri, JSON.stringify(params || {}));
      return b;
    } catch (e) {
      if (cb) cb({ returnValue: false, errorText: String(e) });   // not on a TV (desktop preview)
      return null;
    }
  }

  /** Ends a subscription made with luna(). */
  function unsubscribe(b) {
    if (!b) return;
    try { b.cancel(); } catch (e) { /* already gone */ }
    var i = bridges.indexOf(b);
    if (i >= 0) bridges.splice(i, 1);
  }

  function launch(id, title, params) {
    luna('luna://com.webos.applicationManager/launch', { id: id, params: params || {} }, function (res) {
      if (res.returnValue === false) toast("Can't open " + (title || id));
    });
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('shown'); }, 2200);
  }

  // ---- apps ----------------------------------------------------------------------------------

  function orderedApps() {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    var byId = {};
    all.forEach(function (a) { byId[a.id] = a; });
    var hidden = {};
    (CONFIG.hiddenApps || []).forEach(function (id) { hidden[id] = true; });
    idList(HIDDEN_KEY).forEach(function (id) { hidden[id] = true; });   // hidden from the tile menu
    removedIds().forEach(function (id) { hidden[id] = true; });
    var byTitle = function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; };

    // An order arranged on the TV wins, until dockApps in config.js changes.
    var saved = loadOrder();
    if (saved) {
      var placed = [];
      saved.forEach(function (id) {
        if (byId[id] && !hidden[id]) { placed.push(byId[id]); hidden[id] = true; }
      });
      return placed.concat(all.filter(function (a) { return !hidden[a.id]; }).sort(byTitle));
    }

    var dock = [];
    (CONFIG.dockApps || []).forEach(function (id) {
      if (byId[id] && !hidden[id] && dock.length < COLUMNS) { dock.push(byId[id]); hidden[id] = true; }
    });
    var rest = all.filter(function (a) { return !hidden[a.id]; });
    rest.sort(byTitle);
    return dock.concat(rest);
  }

  var ORDER_KEY = 'tvhome.order';

  function loadOrder() {
    try {
      var s = JSON.parse(localStorage.getItem(ORDER_KEY));
      return s && s.dock === (CONFIG.dockApps || []).join(',') ? s.ids : null;
    } catch (e) {
      return null;
    }
  }

  function saveOrder() {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify({
        dock: (CONFIG.dockApps || []).join(','),
        ids: items.map(function (it) { return it.app.id; })
      }));
    } catch (e) { /* storage unavailable: the order lasts until the app restarts */ }
  }

  function rowOf(i) { return Math.floor(i / COLUMNS); }
  function tileLeft(i) { return 112 + (i % COLUMNS) * CELL_W + (CELL_W - TILE_W) / 2; }
  function tileTop(i) { var r = rowOf(i); return DOCK_TOP + r * ROW_PITCH + (r > 0 ? DOCK_GAP : 0); }

  function build() {
    tilesEl.innerHTML = '';
    items = orderedApps().map(function (app) {
      var el = document.createElement('div');
      el.className = 'item';
      var card = document.createElement('div');
      card.className = 'card';
      var img = document.createElement('img');
      var item = { app: app, el: el, card: card, color: null };
      img.onload = function () { paintTile(item, img); };
      img.src = app.icon;
      card.appendChild(img);
      el.appendChild(card);
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = app.title;
      el.appendChild(name);
      el.addEventListener('mouseover', function () {
        if (zone !== 'inputs' && !editing) focusTile(items.indexOf(item));
      });
      el.addEventListener('click', function () {
        if (editing) finishEdit(true);
        else launch(app.id, app.title);
      });
      tilesEl.appendChild(el);
      return item;
    });
    layout();
  }

  /** Places every tile by its position in items; tiles glide when the order changes. */
  function layout() {
    items.forEach(function (it, i) {
      it.el.style.left = tileLeft(i) + 'px';
      it.el.style.top = tileTop(i) + 'px';
      it.el.classList.toggle('dock', rowOf(i) === 0);   // the dock has no labels: the top shelf names it
    });

    var band = $('dockBand');
    var n = Math.min(COLUMNS, items.length);
    band.style.display = n ? 'block' : 'none';
    band.style.left = (tileLeft(0) - 28) + 'px';
    band.style.top = (DOCK_TOP - 28) + 'px';
    band.style.width = ((n - 1) * CELL_W + TILE_W + 56) + 'px';
    band.style.height = (TILE_H + 56) + 'px';
  }

  function animateIn() {
    items.forEach(function (it, i) {
      it.el.classList.remove('shown');
      setTimeout(function () { it.el.classList.add('shown'); }, 60 + Math.min(i, 16) * 40);
    });
  }

  /**
   * Store icons are square logos on a solid colour: fill the wide tile with that colour so the logo
   * reads as a banner. LG's system icons are glyphs on transparent: use the app's own colour.
   */
  function paintTile(item, img) {
    // sync-apps.py works the colours out ahead of time: the TV taints canvases drawn from file://.
    var px = null, bg = parseColor(item.app.bg), glow = parseColor(item.app.glow);
    if (!glow) {
      try {
        var c = document.createElement('canvas');
        c.width = 12; c.height = 12;
        var g = c.getContext('2d');
        g.drawImage(img, 0, 0, 12, 12);
        px = g.getImageData(0, 0, 12, 12).data;
        var edge = edgeColor(img);
        if (edge[3] > 200) bg = [edge[0], edge[1], edge[2]];
      } catch (e) { /* tainted canvas: fall back to the app's colour */ }
    }

    var glyphColor = null;
    if (bg) {
      item.card.style.background = 'rgb(' + bg.join(',') + ')';
    } else {
      item.card.classList.add('glyph');
      item.card.style.background = glyphBackground(item.app.iconColor);
      glyphColor = glyphBackground(item.app.iconColor) === '#2c2c2e' ? null : parseColor(item.app.iconColor);
    }
    // A white glyph says nothing about the app: glow in the tile's colour instead.
    item.color = glyphColor || glow || (px ? vividColor(px) : parseColor(item.app.iconColor));
    if (items[focused] === item) setAmbient(item.color);
  }

  /**
   * The icon's background at full size: a corner pixel, or the middle of the left edge for rounded
   * icons whose corners are transparent. A downscaled sample would blend in the logo.
   */
  function edgeColor(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var corner = g.getImageData(2, 2, 1, 1).data;
    return corner[3] > 200 ? corner : g.getImageData(2, Math.floor(h / 2), 1, 1).data;
  }

  function glyphBackground(hex) {
    var c = parseColor(hex);
    if (!c) return '#2c2c2e';
    var hsv = rgbToHsv(c);
    if (hsv[1] < 0.15 && (hsv[2] > 0.85 || hsv[2] < 0.1)) return '#2c2c2e';   // white or black glyph colour
    return 'rgb(' + c.join(',') + ')';
  }

  /** A vivid colour from the icon: the most saturated, not too dark pixel, or the lifted average. */
  function vividColor(px) {
    var best = null, bestScore = -1, sum = [0, 0, 0], n = 0;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      var p = [px[i], px[i + 1], px[i + 2]];
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++;
      var hsv = rgbToHsv(p);
      var score = hsv[1] * Math.min(1, hsv[2] * 1.4);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!n) return [68, 68, 68];
    if (bestScore < 0.25) {   // nearly monochrome icon (e.g. white): its average, lifted
      var avg = rgbToHsv([sum[0] / n, sum[1] / n, sum[2] / n]);
      avg[2] = Math.max(avg[2], 0.55);
      return hsvToRgb(avg);
    }
    var h = rgbToHsv(best);
    h[1] = Math.min(1, h[1] * 1.1);
    h[2] = Math.max(0.5, h[2]);
    return hsvToRgb(h);
  }

  function parseColor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  }

  function rgbToHsv(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  }

  function hsvToRgb(hsv) {
    var h = hsv[0], s = hsv[1], v = hsv[2];
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(function (k) { return Math.round((k + m) * 255); });
  }

  // ---- focus & glass -------------------------------------------------------------------------

  function focusTile(i) {
    if (!items.length) return;
    i = Math.max(0, Math.min(i, items.length - 1));
    setZone('grid');
    if (items[focused]) items[focused].el.classList.remove('focused');
    focused = i;
    items[i].el.classList.add('focused');

    var top = tileTop(i), row = rowOf(i);
    if (row === 0) {
      offset = 0;
    } else {
      // Scroll just enough so the whole glass and the name below the tile are visible.
      if (top - offset + TILE_H + 70 > VIEW_BOTTOM) offset = top + TILE_H + 70 - VIEW_BOTTOM;
      if (top - offset - 24 < VIEW_TOP) offset = top - 24 - VIEW_TOP;
    }
    stage.style.transform = 'translateY(' + (-offset) + 'px)';
    // Keep the header until the content (the dock band is topmost) would run into it.
    var header = document.querySelector('header');
    var headerBottom = header.offsetTop + header.offsetHeight;   // layout box: ignores the hide slide
    document.body.classList.toggle('scrolled', DOCK_TOP - 28 - offset < headerBottom + 24);

    var w = TILE_W * FOCUS_SCALE + 2 * GLASS_PAD, h = TILE_H * FOCUS_SCALE + 2 * GLASS_PAD;
    var x = tileLeft(i) + TILE_W / 2 - w / 2, y = top + TILE_H / 2 - h / 2;
    glass.style.width = w + 'px';
    glass.style.height = h + 'px';
    glass.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    if (!glassShown) {
      // First show: jump there without the spring, then fade in.
      glass.style.transition = 'none';
      glass.offsetWidth;   // flush the jump before restoring the transition
      glass.style.transition = '';
      glass.style.opacity = '1';
      glassShown = true;
    }

    if (row === 0) showHero(items[i]);
    else hideHero();
    setAmbient(items[i].color);   // the glow follows the focused tile in every row
  }

  function hideGlass() {
    glassShown = false;
    glass.style.opacity = '0';
  }

  function showHero(item) {
    var label = item.app.title;
    hero.style.top = (DOCK_TOP - 28 - 52 - 96) + 'px';
    if (!heroShown) {
      hero.textContent = label;
      hero.style.transform = 'none';
      hero.style.opacity = '1';
      heroShown = true;
    } else if (hero.textContent !== label) {
      hero.style.opacity = '0';
      hero.style.transform = 'translateX(-24px)';
      clearTimeout(hero.swap);
      hero.swap = setTimeout(function () {
        hero.textContent = label;
        hero.style.transition = 'none';
        hero.style.transform = 'translateX(24px)';
        hero.offsetWidth;
        hero.style.transition = '';
        hero.style.transform = 'none';
        hero.style.opacity = '1';
      }, 120);
    }
    setAmbient(item.color);
  }

  function hideHero() {
    if (!heroShown) return;
    heroShown = false;
    hero.style.opacity = '0';
  }

  /** Crossfades the glow to a new colour by swapping between two layers. */
  function setAmbient(color) {
    if (!color) return;
    var key = color.join(',');
    if (key === ambientColor) return;
    ambientColor = key;
    var back = ambients[1 - ambientFront];
    back.style.background = 'radial-gradient(circle 1190px at 32% 42%, rgba(' + key + ',0.36) 0%, rgba(' +
      key + ',0.15) 50%, rgba(' + key + ',0) 100%)';
    back.style.opacity = '1';
    ambients[ambientFront].style.opacity = '0';
    ambientFront = 1 - ambientFront;
  }

  function focusPill(i) {
    setZone('top');
    document.body.classList.remove('scrolled');
    pills[pillFocus].classList.remove('focused');
    pillFocus = Math.max(0, Math.min(i, pills.length - 1));
    pills[pillFocus].classList.add('focused');
  }

  function setZone(z) {
    if (zone === z) return;
    if (zone === 'top') pills[pillFocus].classList.remove('focused');
    if (zone === 'grid') {
      if (items[focused]) items[focused].el.classList.remove('focused');
      hideGlass();
    }
    zone = z;
  }

  /** The pill straight above a dock tile, by horizontal distance. */
  function pillAbove(i) {
    var cx = tileLeft(i) + TILE_W / 2, best = 0, bestD = Infinity;
    pills.forEach(function (p, k) {
      var r = p.getBoundingClientRect();
      var d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  // ---- top bar -------------------------------------------------------------------------------

  function updateClock() {
    var now = new Date(), h = now.getHours();
    for (var k = 0; k < GREETINGS.length; k++) {
      if (h < GREETINGS[k][0]) { $('greeting').textContent = GREETINGS[k][1]; break; }
    }
    var m = now.getMinutes();
    $('clock').textContent = ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m;
    $('ampm').textContent = h < 12 ? 'am' : 'pm';
    $('date').textContent = DAYS[now.getDay()] + '  ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
  }

  /** Shows the Wi-Fi network name when the TV reports it, otherwise the connection type. */
  function watchNetwork() {
    luna('luna://com.palm.connectionmanager/getStatus', { subscribe: true }, function (res) {
      if (res.returnValue === false && !res.wifi && !res.wired) return;
      var text = 'Wi-Fi';
      if (res.wired && res.wired.state === 'connected') text = 'Ethernet';
      else if (res.wifi && res.wifi.state === 'connected') text = res.wifi.ssid || 'Wi-Fi';
      else if (res.isInternetConnectionAvailable === false) text = 'Offline';
      $('wifiLabel').textContent = text;
    });
  }

  function activatePill(i) {
    if (i === 0) showInputs();
    else if (i === 1) launch('com.palm.app.settings', 'Settings', { target: 'network' });
    else if (i === 2) showWallPanel();
    else if (i === 3) openLgHome();
    else launch('com.palm.app.settings', 'Settings');
  }

  /**
   * LG's home, for its menus. The Home watcher on the TV sends LG's home straight back here, so
   * first tell it (through the service) that this one is on purpose.
   */
  function openLgHome() {
    luna(SERVICE + 'allowLgHome', {}, function () { launch('com.webos.app.home', 'LG Home'); });
  }

  // ---- inputs dropdown -----------------------------------------------------------------------

  function showInputs() {
    panel.innerHTML = '';
    inputRows = [];
    var inputs = (window.TV_APPS && TV_APPS.inputs) || [];
    inputs.forEach(function (inp) { addInputRow(ICON_INPUT, inp.label, inp.appId); });
    if (CONFIG.liveTvApp) {
      if (inputRows.length) panel.appendChild(Object.assign(document.createElement('div'), { className: 'separator' }));
      addInputRow(ICON_LIVETV, 'Live TV', CONFIG.liveTvApp);
    }
    if (!inputRows.length) { toast('No inputs found'); return; }

    // Hang right below the Inputs pill, at least as wide as it.
    var r = pills[0].getBoundingClientRect();
    panel.style.left = r.left + 'px';
    panel.style.top = (r.bottom + 20) + 'px';
    panel.style.minWidth = Math.max(r.width, 300) + 'px';
    panel.classList.remove('hidden');
    pills[pillFocus].classList.remove('focused');
    zone = 'inputs';
    focusInput(0);
  }

  function addInputRow(icon, label, appId) {
    var row = document.createElement('div');
    row.className = 'inputRow';
    row.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icon + '"/></svg>';
    row.appendChild(document.createTextNode(label));
    var idx = inputRows.length;
    row.addEventListener('mouseover', function () { focusInput(idx); });
    row.addEventListener('click', function () { hideInputs(); launch(appId, label); });
    row.appId = appId;
    row.label = label;
    inputRows.push(row);
    panel.appendChild(row);
  }

  function focusInput(i) {
    if (inputRows[inputFocus]) inputRows[inputFocus].classList.remove('focused');
    inputFocus = Math.max(0, Math.min(i, inputRows.length - 1));
    inputRows[inputFocus].classList.add('focused');
  }

  function hideInputs() {
    panel.classList.add('hidden');
    zone = 'none';
    focusPill(0);
  }

  // ---- wallpaper -----------------------------------------------------------------------------

  /*
   * The wallpaper is Bing's picture of the day (kept current), one picked from Bing's last fortnight,
   * or a picture sent from a phone. Phones send it to a page the bundled service serves on the LAN
   * while this panel is open; the picture itself is kept in localStorage.
   */
  var SERVICE = 'luna://com.gathin.tvhome.service/';
  var SHARE_LATEST = 'http://127.0.0.1:8099/latest';
  var WP_KEY = 'tvhome.wallpaper', WP_PHOTO_KEY = 'tvhome.wallpaper.photo', WP_BING_KEY = 'tvhome.wallpaper.bing';
  var WP_COLUMNS = 4;
  var wallPanel = $('wallPanel'), wpGrid = $('wpGrid');
  var wpCards = [], wpFocus = -1, wpOffset = 0, wpBing = [], shareBridge = null;

  function load(key, json) {
    try {
      var v = localStorage.getItem(key);
      return json ? JSON.parse(v) : v;
    } catch (e) {
      return null;
    }
  }

  /** false when localStorage refuses it, e.g. a picture too big. */
  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function today() {
    var d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /** Bing's pictures, newest first, asked of the service at most once a day. */
  function bingImages(cb) {
    var cache = load(WP_BING_KEY, true);
    if (cache && cache.day === today() && cache.images.length) { cb(cache.images); return; }
    luna(SERVICE + 'bing', {}, function (res) {
      if (res.returnValue && res.images && res.images.length) {
        store(WP_BING_KEY, { day: today(), images: res.images });
        cb(res.images);
      } else {
        cb(cache ? cache.images : []);   // offline: yesterday's list beats none
      }
    });
  }

  function currentWallpaper() { return load(WP_KEY, true) || { mode: 'none' }; }

  function showWallpaper(url) {
    if (!url) { document.body.classList.remove('hasWallpaper'); return; }
    var img = new Image();
    img.onload = function () {   // swap only once it has loaded, so a slow picture doesn't flash black
      $('wallpaper').style.backgroundImage = 'url("' + url + '")';
      document.body.classList.add('hasWallpaper');
    };
    img.src = url;
  }

  function applyWallpaper() {
    var wp = currentWallpaper();
    if (wp.mode === 'photo') showWallpaper(load(WP_PHOTO_KEY));
    else if (wp.mode === 'bing') showWallpaper(wp.url);
    else if (wp.mode === 'daily') bingImages(function (images) { showWallpaper(images.length ? images[0].url : null); });
    else showWallpaper(null);
  }

  function chooseWallpaper(wp) {
    store(WP_KEY, wp);
    applyWallpaper();
    markSelected();
  }

  function showWallPanel() {
    wallPanel.classList.remove('hidden');
    pills[pillFocus].classList.remove('focused');
    zone = 'wall';
    wpFocus = -1;   // start on the wallpaper in use
    buildWallCards(wpBing);
    bingImages(buildWallCards);
    $('wpQr').innerHTML = '';
    $('wpUrl').textContent = 'Đang mở…';
    unsubscribe(shareBridge);
    shareBridge = luna(SERVICE + 'share', { subscribe: true }, function (res) {
      if (res.returnValue === false) { $('wpUrl').textContent = 'Không mở được trang gửi ảnh'; return; }
      if (res.url) showQr(res.url);
      if (res.uploaded) fetchUpload();
    });
  }

  /** Closes the panel; the service takes the phone page down with the subscription. */
  function closeWallPanel() {
    wallPanel.classList.add('hidden');
    unsubscribe(shareBridge);
    shareBridge = null;
    zone = 'none';
  }

  function showQr(url) {
    var qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('wpQr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    $('wpUrl').textContent = url.replace(/\/$/, '');
  }

  /** The picture a phone just sent, from the service, into localStorage. */
  function fetchUpload() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', SHARE_LATEST + '?' + Date.now());
    xhr.responseType = 'blob';
    xhr.onload = function () {
      if (xhr.status !== 200) { toast('Không nhận được ảnh'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        if (!store(WP_PHOTO_KEY, reader.result)) { toast('Ảnh quá lớn'); return; }
        chooseWallpaper({ mode: 'photo' });
        wpFocus = -1;
        buildWallCards(wpBing);
        toast('Đã đổi hình nền');
      };
      reader.readAsDataURL(xhr.response);
    };
    xhr.onerror = function () { toast('Không nhận được ảnh'); };
    xhr.send();
  }

  function buildWallCards(images) {
    wpBing = images;
    wpGrid.innerHTML = '';
    wpCards = [];
    addWallCard({ mode: 'none' }, 'Mặc định', null, '');
    addWallCard({ mode: 'daily' }, 'Bing mỗi ngày', images.length ? images[0].thumb : null,
      'Ảnh Bing của hôm nay, tự đổi mỗi ngày');
    var photo = load(WP_PHOTO_KEY);
    if (photo) addWallCard({ mode: 'photo' }, 'Ảnh từ điện thoại', photo, '');
    images.forEach(function (im) {
      var d = String(im.date);
      addWallCard({ mode: 'bing', url: im.url }, 'Bing ' + d.slice(6, 8) + '/' + d.slice(4, 6), im.thumb, im.title);
    });
    markSelected();
    if (zone !== 'wall') return;
    var cur = currentWallpaper(), sel = 0;
    wpCards.forEach(function (c, i) { if (sameWallpaper(c.wp, cur)) sel = i; });
    var i = wpFocus < 0 ? sel : wpFocus;
    wpFocus = -1;
    focusWallCard(i);
  }

  function addWallCard(wp, label, thumb, caption) {
    var el = document.createElement('div');
    el.className = 'wpCard';
    var t = document.createElement('div');
    t.className = 'wpThumb' + (thumb ? '' : ' plain');
    if (thumb) t.style.backgroundImage = 'url("' + thumb + '")';
    el.appendChild(t);
    var name = document.createElement('div');
    name.className = 'wpName';
    name.textContent = label;
    el.appendChild(name);
    el.wp = wp;
    el.caption = caption;
    var idx = wpCards.length;
    el.addEventListener('mouseover', function () { focusWallCard(idx); });
    el.addEventListener('click', function () { chooseWallpaper(wp); });
    wpCards.push(el);
    wpGrid.appendChild(el);
  }

  function sameWallpaper(a, b) { return a.mode === b.mode && (a.mode !== 'bing' || a.url === b.url); }

  function markSelected() {
    var cur = currentWallpaper();
    wpCards.forEach(function (c) { c.classList.toggle('selected', sameWallpaper(c.wp, cur)); });
  }

  function focusWallCard(i) {
    if (!wpCards.length) return;
    if (wpCards[wpFocus]) wpCards[wpFocus].classList.remove('focused');
    wpFocus = Math.max(0, Math.min(i, wpCards.length - 1));
    var c = wpCards[wpFocus];
    c.classList.add('focused');
    $('wpCaption').textContent = c.caption;
    // Scroll just enough to keep the focused row in view.
    var boxH = $('wpGridBox').clientHeight, top = c.offsetTop, bottom = top + c.offsetHeight + 16;
    if (bottom - wpOffset > boxH) wpOffset = bottom - boxH;
    if (top - 16 < wpOffset) wpOffset = Math.max(0, top - 16);
    wpGrid.style.transform = 'translateY(' + (-wpOffset) + 'px)';
  }

  // ---- tile menu: hold OK on a tile -------------------------------------------------------

  // App ids hidden or uninstalled from the menu, kept on the TV. Uninstalled ones are dropped
  // from the tiles until the next sync-apps.py, which no longer lists them (or lists them again
  // when they were reinstalled).
  var HIDDEN_KEY = 'tvhome.hidden', REMOVED_KEY = 'tvhome.removed';
  var menuRows = [], menuFocus = 0;

  function idList(key) {
    var l = load(key, true);
    return Array.isArray(l) ? l : [];
  }

  function removedIds() {
    var synced = (window.TV_APPS && TV_APPS.synced) || 0;
    var removed = load(REMOVED_KEY, true) || {};
    return Object.keys(removed).filter(function (id) { return removed[id] > synced; });
  }

  function titleOf(id) {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].title;
    return id;
  }

  /** LG's own apps and Homebrew Channel (the root everything here runs on) stay installed. */
  function canRemove(id) {
    return !/^com\.(webos|palm|lge)\./.test(id) && id !== 'org.webosbrew.hbchannel';
  }

  function openTileMenu() {
    var it = items[focused];
    if (!it) return;
    var rows = [
      { label: 'Di chuyển', run: startEdit },
      { label: 'Ẩn', run: function () { hideApp(it.app); } }
    ];
    if (canRemove(it.app.id)) rows.push({ label: 'Gỡ cài đặt', run: function () { confirmRemove(it); } });
    var nHidden = idList(HIDDEN_KEY).length;
    if (nHidden) rows.push({ label: 'Hiện lại app đã ẩn (' + nHidden + ')', run: showHiddenMenu });
    showMenu(it.app.title, rows, 0);
  }

  /** A small menu beside the focused tile; OK runs a row, Back closes. */
  function showMenu(title, rows, focusIndex) {
    tileMenu.innerHTML = '';
    var t = document.createElement('div');
    t.className = 'menuTitle';
    t.textContent = title;
    tileMenu.appendChild(t);
    menuRows = rows.map(function (r, i) {
      var row = document.createElement('div');
      row.className = 'inputRow';
      row.textContent = r.label;
      row.addEventListener('mouseover', function () { focusMenu(i); });
      row.addEventListener('click', function () { runMenu(i); });
      tileMenu.appendChild(row);
      return row;
    });
    menuRows.forEach(function (row, i) { row.run = rows[i].run; });

    // Below the tile, or above it near the bottom of the screen.
    var r = items[focused].card.getBoundingClientRect();
    tileMenu.style.left = Math.min(r.left, 1920 - 112 - 420) + 'px';
    tileMenu.style.minWidth = '420px';
    tileMenu.classList.remove('hidden');
    var h = tileMenu.offsetHeight;
    tileMenu.style.top = (r.bottom + 24 + h < 1060 ? r.bottom + 24 : Math.max(40, r.top - 24 - h)) + 'px';
    zone = 'menu';
    menuFocus = 0;
    focusMenu(focusIndex || 0);
  }

  function focusMenu(i) {
    if (menuRows[menuFocus]) menuRows[menuFocus].classList.remove('focused');
    menuFocus = Math.max(0, Math.min(i, menuRows.length - 1));
    menuRows[menuFocus].classList.add('focused');
  }

  function closeMenu() {
    tileMenu.classList.add('hidden');
    zone = 'grid';
  }

  function runMenu(i) {
    var run = menuRows[i] && menuRows[i].run;
    closeMenu();
    if (run) run(); else focusTile(focused);
  }

  /** Rebuilds the tiles after one was hidden, shown or uninstalled, keeping the focus nearby. */
  function rebuildTiles() {
    var at = focused;
    build();
    animateIn();
    focusTile(Math.min(at, items.length - 1));
  }

  function hideApp(app) {
    var l = idList(HIDDEN_KEY);
    if (l.indexOf(app.id) < 0) l.push(app.id);
    store(HIDDEN_KEY, l);
    rebuildTiles();
    toast('Đã ẩn ' + app.title + ' · giữ OK trên một app để hiện lại');
  }

  function showHiddenMenu() {
    var rows = idList(HIDDEN_KEY).map(function (id) {
      return { label: titleOf(id), run: function () {
        store(HIDDEN_KEY, idList(HIDDEN_KEY).filter(function (x) { return x !== id; }));
        rebuildTiles();
        toast('Đã hiện lại ' + titleOf(id));
      } };
    });
    showMenu('Hiện lại app đã ẩn', rows, 0);
  }

  function confirmRemove(it) {
    showMenu('Gỡ ' + it.app.title + ' khỏi TV?', [
      { label: 'Gỡ cài đặt', run: function () { removeApp(it.app); } },
      { label: 'Huỷ', run: function () { focusTile(focused); } }
    ], 1);   // Huỷ first: uninstalling can't be undone from here
  }

  function removeApp(app) {
    toast('Đang gỡ ' + app.title + '…');
    focusTile(focused);
    luna(SERVICE + 'removeApp', { id: app.id }, function (res) {
      if (res.returnValue) {
        var removed = load(REMOVED_KEY, true) || {};
        removed[app.id] = Date.now();
        store(REMOVED_KEY, removed);
        rebuildTiles();
        toast('Đã gỡ ' + app.title);
      } else {
        toast(res.errorText || 'Không gỡ được ' + app.title);
      }
    });
  }

  // ---- rearranging ---------------------------------------------------------------------------

  /** Hold OK on a tile: it wiggles, the arrows move it, OK places it, Back puts everything back. */
  function startEdit() {
    var it = items[focused];
    if (!it) return;
    editing = { item: it, snapshot: items.slice() };
    it.el.classList.add('moving');
    document.body.classList.add('editing');
    toast('Mũi tên để di chuyển  ·  OK để đặt  ·  Back để huỷ');
  }

  function moveTo(to) {
    if (to < 0 || to >= items.length || to === focused) return;
    items.splice(to, 0, items.splice(focused, 1)[0]);
    focused = to;
    layout();
    focusTile(to);
  }

  function finishEdit(keep) {
    var it = editing.item;
    if (!keep) {
      items = editing.snapshot;
      layout();
    }
    editing = null;
    it.el.classList.remove('moving');
    document.body.classList.remove('editing');
    if (keep) saveOrder();
    focused = items.indexOf(it);
    focusTile(focused);
  }

  // ---- keys ----------------------------------------------------------------------------------

  var LONG_PRESS_MS = 600;
  var okDown = false, okTimer = null;

  // On tiles OK acts on release, so a held OK can start rearranging instead of opening the app.
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.OK) return;
    okDown = false;
    if (!okTimer) return;
    clearTimeout(okTimer);
    okTimer = null;
    var it = items[focused];
    if (zone === 'grid' && it && !editing) launch(it.app.id, it.app.title);
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === KEY.OK && okDown) { e.preventDefault(); return; }   // key repeat while held
    if (k === KEY.OK) okDown = true;
    if (editing) {
      if (k === KEY.LEFT) moveTo(focused - 1);
      else if (k === KEY.RIGHT) moveTo(focused + 1);
      else if (k === KEY.UP) moveTo(focused - COLUMNS);
      else if (k === KEY.DOWN) moveTo(Math.min(focused + COLUMNS, items.length - 1));
      else if (k === KEY.OK) finishEdit(true);
      else if (k === KEY.BACK || k === KEY.ESC) finishEdit(false);
      else return;
    } else if (zone === 'inputs') {
      if (k === KEY.UP) focusInput(inputFocus - 1);
      else if (k === KEY.DOWN) focusInput(inputFocus + 1);
      else if (k === KEY.OK) { var row = inputRows[inputFocus]; hideInputs(); launch(row.appId, row.label); }
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.LEFT || k === KEY.RIGHT) hideInputs();
      else return;
    } else if (zone === 'menu') {
      if (k === KEY.UP) focusMenu(menuFocus - 1);
      else if (k === KEY.DOWN) focusMenu(menuFocus + 1);
      else if (k === KEY.OK) runMenu(menuFocus);
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.LEFT || k === KEY.RIGHT) { closeMenu(); focusTile(focused); }
      else return;
    } else if (zone === 'wall') {
      var wcol = wpFocus % WP_COLUMNS, wlast = wpCards.length - 1;
      if (k === KEY.LEFT) { if (wcol > 0) focusWallCard(wpFocus - 1); }
      else if (k === KEY.RIGHT) { if (wcol < WP_COLUMNS - 1 && wpFocus < wlast) focusWallCard(wpFocus + 1); }
      else if (k === KEY.UP) { if (wpFocus >= WP_COLUMNS) focusWallCard(wpFocus - WP_COLUMNS); }
      else if (k === KEY.DOWN) {
        if (Math.floor(wpFocus / WP_COLUMNS) < Math.floor(wlast / WP_COLUMNS)) focusWallCard(Math.min(wpFocus + WP_COLUMNS, wlast));
      } else if (k === KEY.OK) { if (wpCards[wpFocus]) chooseWallpaper(wpCards[wpFocus].wp); }
      else if (k === KEY.BACK || k === KEY.ESC) { closeWallPanel(); focusPill(2); }
      else return;
    } else if (zone === 'top') {
      if (k === KEY.LEFT) focusPill(pillFocus - 1);
      else if (k === KEY.RIGHT) focusPill(pillFocus + 1);
      else if (k === KEY.DOWN) focusTile(rowOf(focused) === 0 ? focused : 0);
      else if (k === KEY.OK) activatePill(pillFocus);
      else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    } else {
      var col = focused % COLUMNS, last = items.length - 1;
      if (k === KEY.LEFT) { if (col > 0) focusTile(focused - 1); }
      else if (k === KEY.RIGHT) { if (col < COLUMNS - 1 && focused < last) focusTile(focused + 1); }
      else if (k === KEY.UP) {
        if (rowOf(focused) === 0) focusPill(pillAbove(focused));
        else focusTile(focused - COLUMNS);
      } else if (k === KEY.DOWN) {
        if (rowOf(focused) < rowOf(last)) focusTile(Math.min(focused + COLUMNS, last));
      } else if (k === KEY.OK) {
        okTimer = setTimeout(function () { okTimer = null; openTileMenu(); }, LONG_PRESS_MS);
      } else if (k === KEY.INFO || k === KEY.RED) {
        openTileMenu();   // the same menu in one press, for remotes with these keys
      } else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    }
    e.preventDefault();
  });

  pills.forEach(function (p, i) {
    p.addEventListener('mouseover', function () { if (zone !== 'inputs' && zone !== 'wall') focusPill(i); });
    p.addEventListener('click', function () { activatePill(i); });
  });

  // ---- lifecycle -----------------------------------------------------------------------------

  /** Back from another app (or opened again from the shortcut): replay the entrance, keep the tile. */
  function resume() {
    if (editing) finishEdit(false);
    updateClock();
    if (zone === 'inputs') panel.classList.add('hidden');
    if (zone === 'wall') closeWallPanel();
    if (zone === 'menu') closeMenu();
    applyWallpaper();   // a new day brings a new Bing picture
    pills.forEach(function (p) { p.classList.remove('focused'); });
    zone = 'none';
    animateIn();
    focusTile(focused);
  }

  document.addEventListener('webOSRelaunch', resume);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resume(); });

  build();
  applyWallpaper();
  updateClock();
  setInterval(updateClock, 10000);
  watchNetwork();
  animateIn();
  zone = 'none';
  focusTile(0);
})();
