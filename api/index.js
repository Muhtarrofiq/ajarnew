// ============================================================
//  Backend Aplikasi Perangkat Ajar — Vercel Serverless Function
//  Database : Neon Postgres (serverless)
//  Env wajib: DATABASE_URL  (connection string dari Neon)
//  Env opsional: SETUP_SECRET (untuk endpoint migrasi massal)
//
//  Endpoint (semua lewat /api?action=...):
//    POST ?action=login    { user, pass, role }
//    GET  ?action=load&scope=me|shared        (header X-App-User / X-App-Pass)
//    GET  ?action=revs                        (header X-App-User / X-App-Pass)
//    POST ?action=save     { scope, base_rev, payload }
//                          kredensial via header ATAU body { user, pass } (beacon)
//    POST ?action=migrate  { secret, users: [...] }  (sekali pakai utk impor akun)
// ============================================================

const { neon } = require('@neondatabase/serverless');

let _sql = null;
let _initPromise = null;

function db() {
    if (_sql) return _sql;
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('ENV DATABASE_URL belum di-set di Vercel.');
    _sql = neon(url);
    return _sql;
}

// --- Migrasi skema otomatis saat cold start (aman dipanggil berulang) ---
async function ensureInit() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        const sql = db();
        await sql`
            CREATE TABLE IF NOT EXISTS users (
                username    TEXT PRIMARY KEY,
                password    TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'guru',
                name        TEXT,
                assignments JSONB NOT NULL DEFAULT '[]'::jsonb,
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )`;
        await sql`
            CREATE TABLE IF NOT EXISTS scopes (
                scope      TEXT NOT NULL,                 -- 'shared' | 'me'
                username   TEXT NOT NULL DEFAULT '',      -- '' untuk scope shared
                rev        INTEGER NOT NULL DEFAULT 0,
                payload    JSONB,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (scope, username)
            )`;
        // Benih akun default (sama seperti akun bawaan aplikasi) bila tabel masih kosong.
        // Akun asli dari Data Master akan menimpa otomatis saat admin pertama kali sinkron.
        const c = await sql`SELECT count(*)::int AS n FROM users`;
        if (c[0] && c[0].n === 0) {
            await sql`
                INSERT INTO users (username, password, role, name) VALUES
                    ('admin', 'admin123', 'admin', 'Administrator'),
                    ('guru',  'guru123',  'guru',  'Guru Mapel')
                ON CONFLICT (username) DO NOTHING`;
        }
    })();
    return _initPromise;
}

// ---------- util ----------
function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-App-User,X-App-Pass');
}

function send(res, code, obj) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
}

async function readBody(req) {
    let b = req.body;
    if (b == null) {
        const chunks = [];
        for await (const ch of req) chunks.push(ch);
        b = Buffer.concat(chunks).toString('utf8');
    }
    if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
    return b || {};
}

async function authUser(u, p) {
    if (!u || !p) return null;
    const rows = await db()`
        SELECT username, role, name, assignments
        FROM users WHERE username = ${u} AND password = ${p} LIMIT 1`;
    return rows[0] || null;
}

function parseJsonb(v) {
    if (v == null) return null;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } }
    return v;
}

// Sinkronkan daftar akun dari payload.master.users -> tabel users.
// Inilah pengganti "api/migrasi.php": cukup admin sinkron 1× dan seluruh
// akun guru dari Data Master otomatis terdaftar di database.
async function upsertUsers(users) {
    if (!Array.isArray(users)) return 0;
    const sql = db();
    let n = 0;
    for (const u of users) {
        if (!u || !u.username || !u.password) continue;
        const role = (u.role === 'admin') ? 'admin' : 'guru';
        const name = u.name || u.username;
        const assignments = JSON.stringify(Array.isArray(u.assignments) ? u.assignments : []);
        await sql`
            INSERT INTO users (username, password, role, name, assignments, updated_at)
            VALUES (${u.username}, ${u.password}, ${role}, ${name}, ${assignments}::jsonb, now())
            ON CONFLICT (username) DO UPDATE SET
                password    = EXCLUDED.password,
                role        = EXCLUDED.role,
                name        = EXCLUDED.name,
                assignments = EXCLUDED.assignments,
                updated_at  = now()`;
        n++;
    }
    return n;
}

// ---------- handler utama ----------
module.exports = async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

    try {
        await ensureInit();
        const action = (req.query && req.query.action) ||
            new URL(req.url, 'http://localhost').searchParams.get('action') || '';
        const sql = db();
        const h = req.headers || {};

        // ---- PING (uji koneksi) ----
        if (action === 'ping') return send(res, 200, { ok: true, ts: Date.now() });

        // ---- LOGIN ----
        if (action === 'login') {
            if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' });
            const body = await readBody(req);
            const me = await authUser(body.user, body.pass);
            if (!me) return send(res, 401, { ok: false, error: 'Username atau password salah.' });
            if (body.role && me.role !== body.role) {
                return send(res, 401, { ok: false, error: 'role-mismatch' });
            }
            return send(res, 200, {
                ok: true,
                user: {
                    username: me.username,
                    role: me.role,
                    name: me.name || me.username,
                    assignments: parseJsonb(me.assignments) || []
                }
            });
        }

        // ---- MIGRATE (opsional, butuh SETUP_SECRET) ----
        if (action === 'migrate') {
            if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' });
            const body = await readBody(req);
            if (!process.env.SETUP_SECRET || body.secret !== process.env.SETUP_SECRET) {
                return send(res, 403, { ok: false, error: 'secret salah / tidak diset' });
            }
            const n = await upsertUsers(body.users);
            return send(res, 200, { ok: true, count: n });
        }

        // ---- LOAD ----
        if (action === 'load') {
            if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method' });
            const me = await authUser(h['x-app-user'], h['x-app-pass']);
            if (!me) return send(res, 401, { ok: false, error: 'auth' });
            const scope = (req.query && req.query.scope) || '';
            if (scope !== 'me' && scope !== 'shared') return send(res, 400, { ok: false, error: 'scope' });
            const owner = scope === 'shared' ? '' : me.username;
            const rows = await sql`
                SELECT rev, payload FROM scopes WHERE scope = ${scope} AND username = ${owner} LIMIT 1`;
            const row = rows[0];
            return send(res, 200, {
                rev: row ? row.rev : 0,
                payload: row ? parseJsonb(row.payload) : null
            });
        }

        // ---- REVS (polling indikator perubahan) ----
        if (action === 'revs') {
            if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method' });
            const me = await authUser(h['x-app-user'], h['x-app-pass']);
            if (!me) return send(res, 401, { ok: false, error: 'auth' });
            const rows = await sql`
                SELECT scope, rev FROM scopes
                WHERE (scope = 'shared' AND username = '') OR (scope = 'me' AND username = ${me.username})`;
            let shared = null, mine = null;
            for (const r of rows) {
                if (r.scope === 'shared') shared = { rev: r.rev };
                else mine = { rev: r.rev };
            }
            return send(res, 200, { revs: { shared, me: mine } });
        }

        // ---- SAVE (optimistic concurrency: base_rev harus sama dgn rev server) ----
        if (action === 'save') {
            if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' });
            const body = await readBody(req);
            // Kredensial: header (fetch biasa) ATAU body (navigator.sendBeacon)
            const u = h['x-app-user'] || body.user;
            const p = h['x-app-pass'] || body.pass;
            const me = await authUser(u, p);
            if (!me) return send(res, 401, { ok: false, error: 'auth' });

            const scope = body.scope;
            if (scope !== 'me' && scope !== 'shared') return send(res, 400, { ok: false, error: 'scope' });
            if (scope === 'shared' && me.role !== 'admin') {
                // Guru mencoba menulis data bersama -> diabaikan (frontend memang mengabaikan 403)
                return send(res, 403, { ok: false, error: 'forbidden' });
            }

            const owner = scope === 'shared' ? '' : me.username;
            const baseRev = Number.isInteger(body.base_rev) ? body.base_rev : 0;
            const payloadStr = JSON.stringify(body.payload === undefined ? null : body.payload);

            // Satu statement atomik: insert (rev=1) bila belum ada & base_rev=0;
            // update rev+1 bila rev saat ini == base_rev; selain itu 0 baris -> konflik.
            const rows = await sql`
                INSERT INTO scopes (scope, username, rev, payload, updated_at)
                VALUES (${scope}, ${owner}, 1, ${payloadStr}::jsonb, now())
                ON CONFLICT (scope, username) DO UPDATE SET
                    rev = scopes.rev + 1,
                    payload = EXCLUDED.payload,
                    updated_at = now()
                WHERE scopes.rev = ${baseRev}
                RETURNING rev`;

            // Verifikasi ganda: rev baru HARUS base_rev + 1 (insert baru: 0+1=1; update: lama+1).
            // Kalau tidak -> baris tidak benar-benar berubah = ada penulis lain -> konflik.
            if (rows.length === 1 && rows[0].rev === baseRev + 1) {
                // Admin menyimpan data bersama -> sekalian daftarkan/perbarui akun guru
                if (scope === 'shared' && body.payload && body.payload.master &&
                    Array.isArray(body.payload.master.users)) {
                    try { await upsertUsers(body.payload.master.users); } catch (e) { /* data tetap tersimpan */ }
                }
                return send(res, 200, { ok: true, rev: rows[0].rev });
            }

            // Konflik: server lebih baru -> kirim versi server (frontend menerapkannya lokal)
            const cur = await sql`
                SELECT rev, payload FROM scopes WHERE scope = ${scope} AND username = ${owner} LIMIT 1`;
            const row = cur[0];
            return send(res, 409, {
                ok: false, error: 'conflict',
                rev: row ? row.rev : 0,
                payload: row ? parseJsonb(row.payload) : null
            });
        }

        return send(res, 404, { ok: false, error: 'action tidak dikenal: ' + action });
    } catch (e) {
        return send(res, 500, { ok: false, error: String((e && e.message) || e) });
    }
};
