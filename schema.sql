-- Skema database Aplikasi Perangkat Ajar (Neon Postgres)
-- CATATAN: Tabel-tabel ini juga dibuat OTOMATIS oleh /api saat pertama kali dipanggil,
-- jadi file ini hanya referensi. Menjalankannya manual juga tidak masalah (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
    username    TEXT PRIMARY KEY,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'guru',
    name        TEXT,
    assignments JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scopes (
    scope      TEXT NOT NULL,                 -- 'shared' | 'me'
    username   TEXT NOT NULL DEFAULT '',      -- '' untuk scope shared
    rev        INTEGER NOT NULL DEFAULT 0,
    payload    JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, username)
);

-- Akun bawaan (otomatis dibuat API bila tabel kosong):
--   admin / admin123  (role admin)
--   guru  / guru123   (role guru)
-- SEGERA ganti password lewat menu Data Master setelah login pertama.
