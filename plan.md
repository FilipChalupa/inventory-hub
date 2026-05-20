# Inventory Hub — plán projektu

## 1. Vize

Inventory Hub je **multi-tenant SaaS pro trackování assetů**. Každá organizace
spravuje vlastní inventář fyzických (nebo i nefyzických) assetů, kde každý asset
má unikátní identifikátor a kompletní historii.

## 2. Kdo to pouzivá

- **Admin organizace** — zakládá assety, kategorie, uživatele, role.
- **Operátor / skladník** — eviduje pohyby, přiřazení, vrácení, opravy.
- **Běžný uživatel** — vidí co má přiřazené, hlásí závady, vrací assety.
- **Auditor (read-only)** — kontrola stavu, exporty, reporty.

## 3. Klíčové use-cases (MVP)

1. Zaevidovat nový asset → vygenerovat unikátní ID + QR kód k vytištění.
2. Naskenovat QR → zobrazit detail assetu (kde je, kdo ho má, historie).
3. Přiřadit asset uživateli / lokaci (check-out).
4. Vrátit asset (check-in).
5. Hledat / filtrovat assety (typ, stav, lokace, vlastník, tagy).
6. Audit log — kdo, kdy, co změnil.
7. Multi-tenant izolace — žádná organizace nevidí cizí data.

## 4. Mimo MVP (later)

- Mobilní appka (nejdřív stačí responsive web + kamera pro QR).
- Bulk import / export (CSV).
- Notifikace (e-mail, webhook).
- Náklady, odpisy, účetní napojení.
- Plánovaná údržba / servisní intervaly.
- RFID / Bluetooth tagy.
- API pro integrace.
- Billing & subscription tiers.

## 5. Unikátní identifikátor assetu

Návrh dvouúrovňový:

- **Interní ID** — ULID nebo nanoid, neměnné, použité v URL a QR kódu.
- **Human-readable kód** — např. `ACME-LAP-000123` (prefix tenant + typ +
  sekvence), zobrazený uživateli a tisknutý vedle QR.

QR kód obsahuje URL `https://app.example.com/a/<interní ID>` — naskenování
funguje v jakékoli kameře/čtečce bez vlastní appky.

> **Otevřená otázka:** podporovat externí identifikátory (sériové číslo
> výrobce, čárový kód EAN) jako vyhledatelné aliasy?

## 6. Datový model (high-level)

```
Tenant (organizace)
  └── User (role: admin / operator / member / auditor)
  └── Location (hierarchie: budova → patro → místnost)
  └── AssetType (kategorie + custom fields schema)
  └── Asset
        ├── internal_id (ULID)
        ├── code (human-readable)
        ├── type_id, location_id, assigned_to (user)
        ├── status (in_stock / assigned / in_repair / retired / lost)
        ├── custom_fields (JSONB podle AssetType)
        └── AssetEvent[] (audit log: created, moved, assigned, returned, ...)
```

## 7. Architektura

**Frontend** (Vite + React + TypeScript):
- React Router, TanStack Query, forma přes React Hook Form + Zod.
- UI: Tailwind + shadcn/ui (rychlý start, dobrá DX).
- QR scanning přes kameru: `html5-qrcode` nebo `@zxing/browser`.

**Backend** — k rozhodnutí:
- **Varianta A:** Hono / Fastify + Prisma + PostgreSQL, deploy na Fly.io /
  Railway. Klasický REST/tRPC.
- **Varianta B:** Supabase (Postgres + Auth + Storage + RLS) — multi-tenant
  izolace přes Row Level Security, frontend mluví přímo s DB. Méně backend
  kódu, rychlejší MVP.

> **Doporučení:** **Varianta B (Supabase)** pro MVP. Multi-tenant RLS je tam
> mature, Auth je hotový, šetří týdny práce. Pokud později narazíme na limity,
> migrace na vlastní Hono backend je přímočará (Postgres zůstane).

**Auth & multi-tenancy:**
- Supabase Auth (e-mail/password + OAuth).
- Každý User má `tenant_id`; všechny tabulky mají `tenant_id` a RLS policy
  `tenant_id = auth.jwt() ->> 'tenant_id'`.

**Storage:** Supabase Storage pro fotky assetů a přílohy.

## 8. Tech stack souhrn

| Vrstva       | Technologie                                |
|--------------|--------------------------------------------|
| Frontend     | Vite + React + TypeScript                  |
| Styling      | Tailwind + shadcn/ui                       |
| State/Data   | TanStack Query                             |
| Validace     | Zod                                        |
| Backend/DB   | Supabase (Postgres + Auth + Storage + RLS) |
| QR           | html5-qrcode nebo @zxing/browser           |
| Hosting FE   | Vercel / Cloudflare Pages                  |
| CI           | GitHub Actions                             |
| Testy        | Vitest + Playwright (E2E)                  |

## 9. Milestones

### M0 — Setup (≈ 2 dny)
- Repo, Vite + TS, Tailwind, shadcn, ESLint, Prettier, Vitest.
- Supabase projekt, schema první migrace, RLS policies kostra.

### M1 — Auth & tenancy (≈ 3 dny)
- Sign-up / login / invite do tenantu.
- Onboarding flow: založení organizace.
- Layout, navigace, role guards.

### M2 — Asset CRUD (≈ 1 týden)
- AssetType editor.
- Vytvořit / editovat / smazat asset.
- Seznam s filtry, fulltext.
- Generování QR + tisková stránka (PDF / print CSS).

### M3 — Pohyby & sken (≈ 1 týden)
- Check-out / check-in flow.
- Mobile-friendly QR scanner.
- Detail assetu + historie událostí.

### M4 — Lokace & uživatelé (≈ 3 dny)
- Strom lokací.
- Správa uživatelů, rolí, pozvánek.

### M5 — Audit & polish (≈ 3 dny)
- Read-only auditor role.
- Export do CSV.
- Empty states, error handling, prázdné stavy.
- Onboarding tour.

**Cílem MVP** je dostat se na konec M5 — funkční produkt na pilotní zákazníky.

## 10. Otevřené otázky

1. **Pricing model** — per user, per asset, flat tier? (ovlivní DB schema a
   gating).
2. **Cílový trh** — IT vybavení ve firmách / dílny / půjčovny / školy? (každý
   chce jinou kombinaci featur).
3. **Vlastní doménu pro tenanty** (acme.inventoryhub.app) hned, nebo až
   později?
4. **Custom fields** v MVP, nebo až po prvních zákaznících?
5. **Offline support** — důležitý pro provoz ve skladech bez signálu?
6. **Lokalizace** — jen CZ/EN, nebo víc jazyků?
7. **Compliance** — GDPR určitě, ale potřebujeme i SOC2 / ISO?

## 11. Rizika

- **Scope creep** — asset tracking je téma kde každý zákazník chce své
  speciální pole/workflow. Mitigace: jasné MVP, custom fields jako úniková
  cesta.
- **Supabase lock-in** — pokud později budeme potřebovat věci co RLS
  neutáhne (komplexní permissions, background jobs), čeká nás přesun na
  vlastní backend. Postgres ale zůstává, takže to není katastrofa.
- **QR ve špatných podmínkách** (špinavé štítky, šero) — nabídnout fallback:
  ruční zadání kódu.
- **Multi-tenant data leak** — RLS musí být pokryté testy, jinak je to
  bezpečnostní průšvih.
