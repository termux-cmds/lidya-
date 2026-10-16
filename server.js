// Lidya Send Off - server ya Railway (Node + MongoDB). Hakuna framework; inahitaji "mongodb" tu.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

try { // soma .env ukiwa local (Railway hutumia Variables zake)
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}

const { MONGODB_URI, ADMIN_USER, ADMIN_PASS, JWT_SECRET, DB_NAME = 'lidya' } = process.env;
const PORT = process.env.PORT || 3000;

// ---------- MongoDB ----------
let conn;
function db() {
  if (!conn) {
    conn = (async () => {
      const c = await new MongoClient(MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 }).connect(), d = c.db(DB_NAME);
      await Promise.all([
        d.collection('rsvps').createIndex({ phone: 1 }, { unique: true }),
        d.collection('contribs').createIndex({ key: 1 }, { unique: true }),
        d.collection('visits').createIndex({ vid: 1 }, { unique: true })
      ]);
      return d;
    })();
    conn.catch(() => { conn = null; });
  }
  return conn;
}

// ---------- Helpers ----------
const J = (s, b, h = {}) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }, body: JSON.stringify(b) });
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const normPhone = p => String(p || '').replace(/[\s-]/g, '').replace(/^\+?255/, '0');
const okPhone = p => /^0[67]\d{8}$/.test(p);
const sha = s => crypto.createHash('sha1').update(s).digest('hex'), h256 = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(h256(a), h256(b));
const hm = p => crypto.createHmac('sha256', JWT_SECRET).update(p).digest('hex'), sign = p => p + '.' + hm(p);
const verify = t => { const [p, s] = String(t || '').split('.'); if (!p || !s) return false; const e = hm(p); return s.length === e.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e)) && +p > Date.now(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- API ----------
async function api(method, route, headers, rawBody) {
  if (!MONGODB_URI || !ADMIN_USER || !ADMIN_PASS || !JWT_SECRET) return J(500, { error: 'Seva haijawekwa vizuri (environment variables).' });
  let b = {}; try { b = rawBody ? JSON.parse(rawBody) : {}; } catch (x) { return J(400, { error: 'Ombi si sahihi.' }); }
  const m = method, isAdmin = route.startsWith('/admin') && route !== '/admin/login';
  try {
    if (isAdmin && !verify((headers.authorization || '').replace('Bearer ', ''))) return J(401, { error: 'Huna ruhusa. Tafadhali ingia tena.' });
    const d = await db(), now = new Date();

    if (m === 'POST' && route === '/visit') { const v = clean(b.vid, 64); if (v.length >= 8) await d.collection('visits').updateOne({ vid: v }, { $inc: { hits: 1 }, $setOnInsert: { createdAt: now } }, { upsert: true }); return J(200, { ok: true }); }

    if (m === 'POST' && route === '/rsvp') {
      const name = clean(b.name, 80), phone = normPhone(b.phone), attending = b.attending === true;
      if (name.length < 3) return J(400, { error: 'Tafadhali weka jina kamili.' }); if (!okPhone(phone)) return J(400, { error: 'Namba ya simu si sahihi.' });
      const guests = attending ? Math.min(4, Math.max(1, parseInt(b.guests) || 1)) : 0;
      const old = await d.collection('rsvps').findOneAndUpdate({ phone }, { $set: { name, attending, guests, message: clean(b.message, 300), updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
      return J(200, { ok: true, updated: !!old });
    }

    if (m === 'POST' && route === '/contribute') {
      const name = clean(b.name, 80), phone = normPhone(b.phone), sms = clean(b.sms, 600), amount = Math.round(+b.amount);
      if (name.length < 3 || !okPhone(phone)) return J(400, { error: 'Taarifa za mchangiaji si sahihi. Ingia tena.' });
      if (sms.length < 15) return J(400, { error: 'Bandika ujumbe kamili wa muamala.' });
      if (!(amount >= 1000 && amount <= 1e7)) return J(400, { error: 'Weka kiasi sahihi.' });
      const t = sms.toUpperCase().match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,12}\b/), key = t ? t[0] : sha(sms.toLowerCase().replace(/\s+/g, ' '));
      try { await d.collection('contribs').insertOne({ name, phone, amount, sms, key, status: 'pending', createdAt: now }); } catch (x) { if (x.code === 11000) return J(409, { error: 'Muamala huu umeshatumwa tayari.' }); throw x; }
      return J(200, { ok: true });
    }

    if (m === 'POST' && route === '/admin/login') {
      if (same(b.username, ADMIN_USER) && same(b.password, ADMIN_PASS)) return J(200, { token: sign(String(Date.now() + 432e5)) });
      await sleep(800); return J(401, { error: 'Jina au nenosiri si sahihi.' });
    }

    if (m === 'GET' && route === '/admin/data') {
      const [c, s, v] = await Promise.all([d.collection('contribs').find().sort({ createdAt: -1 }).toArray(), d.collection('rsvps').find().sort({ updatedAt: -1 }).toArray(), d.collection('visits').aggregate([{ $group: { _id: null, unique: { $sum: 1 }, views: { $sum: '$hits' } } }]).toArray()]);
      const sum = t => c.filter(x => x.status === t).reduce((a, x) => a + x.amount, 0), yes = s.filter(x => x.attending);
      return J(200, { stats: { views: v[0] ? v[0].views : 0, unique: v[0] ? v[0].unique : 0, accepted: yes.length, guests: yes.reduce((a, x) => a + x.guests, 0), declined: s.length - yes.length, confirmed: sum('approved'), pending: sum('pending'), pendingCount: c.filter(x => x.status === 'pending').length }, contributions: c, rsvps: s, at: Date.now() });
    }

    const pm = route.match(/^\/admin\/contributions\/([0-9a-f]{24})$/);
    if (m === 'PATCH' && pm) {
      if (!['approved', 'rejected', 'pending'].includes(b.status)) return J(400, { error: 'Ombi si sahihi.' });
      await d.collection('contribs').updateOne({ _id: new ObjectId(pm[1]) }, { $set: { status: b.status } }); return J(200, { ok: true });
    }

    const xm = route.match(/^\/admin\/export\/(contributions|guests)$/);
    if (m === 'GET' && xm) {
      const c = xm[1] === 'contributions', rows = await d.collection(c ? 'contribs' : 'rsvps').find().sort({ createdAt: -1 }).toArray(),
        cols = c ? ['name', 'phone', 'amount', 'status', 'sms', 'createdAt'] : ['name', 'phone', 'attending', 'guests', 'message', 'createdAt'];
      const esc = v => { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
      return { statusCode: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=${xm[1]}.csv`, 'Cache-Control': 'no-store' }, body: '\ufeff' + [cols.join(',')].concat(rows.map(x => cols.map(k => esc(x[k])).join(','))).join('\n') };
    }

    return J(404, { error: 'Haipatikani.' });
  } catch (err) { console.error(err); return J(500, { error: 'Hitilafu ya seva. Jaribu tena.' }); }
}

// ---------- Static (files mbili tu, ili server.js/.env zisionekane) ----------
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/admin': 'admin.html', '/admin.html': 'admin.html' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

const server = http.createServer((req, res) => {
  const send = r => { res.writeHead(r.statusCode, { ...SEC, ...r.headers }); res.end(req.method === 'HEAD' ? undefined : r.body); };
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(J(400, { error: 'Ombi si sahihi.' })); }
  pathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (pathname === '/health') return send({ statusCode: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, body: 'ok' });

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    let size = 0; const chunks = []; let dead = false;
    req.on('data', c => { size += c.length; if (size > 20000) { dead = true; send(J(413, { error: 'Ombi ni kubwa mno.' })); req.destroy(); } else chunks.push(c); });
    req.on('end', async () => { if (dead) return; send(await api(req.method, pathname.slice(4), req.headers, Buffer.concat(chunks).toString('utf8'))); });
    req.on('error', () => {});
    return;
  }

  const file = PAGES[pathname];
  if (file && (req.method === 'GET' || req.method === 'HEAD')) {
    return fs.readFile(path.join(__dirname, file), (err, buf) => err
      ? send(J(404, { error: 'Haipatikani.' }))
      : send({ statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, body: buf }));
  }
  send(J(404, { error: 'Haipatikani.' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Seva inasikiliza port ' + PORT);
  if (!MONGODB_URI || !ADMIN_USER || !ADMIN_PASS || !JWT_SECRET) console.warn('ONYO: Weka MONGODB_URI, ADMIN_USER, ADMIN_PASS, JWT_SECRET kwenye Variables.');
  else db().then(() => console.log('MongoDB imeunganishwa.')).catch(e => console.error('MongoDB imeshindwa:', e.message));
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
