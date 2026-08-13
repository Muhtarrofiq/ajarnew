# Deploy Aplikasi Perangkat Ajar — Vercel + Neon (Full Sinkron, Tanpa Error)

Folder ini **siap deploy**: frontend statis + backend serverless (Neon Postgres).
Fitur sinkron antar-perangkat & login database **aktif penuh** — pengganti `api/api.php` lama.

---

## ⚡ DATABASE SUDAH DISIAPKAN (skip langkah bikin Neon!)

Database Neon sudah dibuat & diuji (13/13 tes lolos, skema + akun default terpasang):

```
DATABASE_URL:
postgresql://neondb_owner:npg_UIRGsbOJle06@ep-dawn-waterfall-axe3rljf-pooler.c-4.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require
```

### ⏰ WAJIB dalam 72 jam — Klaim database (batas: 15 Agu 2026 ~21:37 WIB)

Buka link ini dan login/daftar Neon gratis (bisa via Google) agar database jadi milikmu **permanen** (tanpa klaim, DB terhapus otomatis setelah 72 jam):

👉 **https://neon.new/claim/019ff668-2d93-7122-afa0-aadf54cf7283**

### Langkah tersisa (±5 menit):

1. **Klaim DB** lewat link di atas.
2. **Buka https://vercel.com/new** → login → **drag folder `perangkat-ajar`** → Deploy.
3. **Project → Settings → Environment Variables** → tambahkan:
   - Name: `DATABASE_URL` — Value: connection string di atas (centang semua environment) → Save.
4. **Tab Deployments → ⋯ → Redeploy.**
5. Buka `https://proyekmu.vercel.app` → login **admin / admin123** → badge hijau *"Server ✓ Tersinkron"* → data lama otomatis terunggah & seluruh akun guru dari Data Master terdaftar otomatis.
6. Tes API: `https://proyekmu.vercel.app/api?action=ping` → harus `{"ok":true}`.
7. **Ganti password default** (`admin123`/`guru123`) lewat Data Master.

> Opsional: setelah klaim, kamu bisa ganti password DB di dashboard Neon (demi keamanan, karena string koneksi ini sempat tertulis di chat). Kalau diganti, update juga nilai `DATABASE_URL` di Vercel lalu redeploy.

---

## Isi folder

| File/Folder | Fungsi |
|---|---|
| `index.html` | Aplikasi (apiBase sudah diarahkan ke `/api`) |
| `api/index.js` | Backend serverless (login, load, save, revs, migrasi akun) |
| `package.json` | Dependensi `@neondatabase/serverless` (auto-install saat deploy) |
| `vercel.json` | Konfigurasi static hosting |
| `schema.sql` | Referensi skema DB (tabel sudah dibuat di Neon) |

---

## 🚀 (Alternatif) Kalau mau bikin database Neon sendiri dari nol

<details><summary>Klik untuk buka</summary>

1. Buka **https://neon.tech** → Sign up (bisa via Google/GitHub).
2. **Create a project** → nama bebas, **region pilih Singapore (ap-southeast-1)** (paling dekat ke Indonesia).
3. Setelah jadi, klik **Connect** → salin **connection string**.
4. Pakai string itu sebagai `DATABASE_URL` menggantikan yang di atas (tabel dibuat otomatis oleh API).

</details>

---

## 🔐 Segera lakukan setelah deploy

- **Ganti password default** (`admin123`, `guru123`) lewat menu Data Master → Pengguna. Password baru ikut tersinkron ke database.
- Opsional: set env `SETUP_SECRET` di Vercel bila ingin memakai endpoint migrasi massal `?action=migrate` (biasanya tidak perlu — migrasi otomatis sudah ada).

## ❓ Kalau badge merah "Server offline"

1. `DATABASE_URL` belum di-set / salah → cek env var, lalu **Redeploy** (env baru hanya berlaku setelah redeploy).
2. DB belum diklaim dan sudah lewat 72 jam → klaim link sudah kedaluwarsa; bikin DB baru sendiri (bagian alternatif di atas) lalu update `DATABASE_URL`.
3. Lihat **Vercel → Project → Logs** untuk pesan error API.
4. Paket gratis Neon tidur saat idle — request pertama bisa lambat 1-2 detik (region DB ini US), lalu normal.

## 📌 Cara kerja sinkron (ringkas)

- Data dibagi 2 scope: **`shared`** (master/kaldik — hanya admin yang bisa menulis) dan **`me`** (perangkat ajar pribadi tiap guru).
- Tiap simpan memakai nomor revisi (`rev`) → kalau 2 perangkat menulis bersamaan, yang kalah otomatis menerapkan versi server (tidak ada data hilang diam-diam).
- Frontend polling tiap 45 detik + saat pindah tab → perubahan dari perangkat lain muncul sendiri.
- Kalau server sempat tak terjangkau, aplikasi tetap jalan dari `localStorage` dan menyinkronkan lagi saat online.
