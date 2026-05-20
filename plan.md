# Inventory Hub — plán projektu

## 1. Vize

Inventory Hub je **self-hostable systém pro trackování assetů**. Nasazuje se
jednou per firma (1 Docker instance = 1 organizace) a spravuje její inventář
fyzických assetů. Každý asset má unikátní lidsky čitelný identifikátor,
kompletní historii pohybů, poškození a výpůjček.

## 2. Kdo to pouzivá

- **Admin organizace** — zakládá assety, kategorie, uživatele, role.
- **Operátor / skladník** — eviduje pohyby, přiřazení, vrácení, opravy.
- **Běžný uživatel** — vidí co má přiřazené, hlásí závady, vrací assety.
- **Auditor (read-only)** — kontrola stavu, exporty, reporty.

## 3. Klíčové use-cases (MVP)

1. Zaevidovat nový asset → vygenerovat unikátní ID + QR kód k vytištění.
2. Naskenovat QR → zobrazit detail assetu (kde je, kdo ho má, historie).
3. Přiřadit asset uživateli / lokaci (interní check-out).
4. **Výpůjčka** — půjčit jeden nebo více assetů osobě (interní i externí),
   evidovat účel a očekávaný návrat. Vracet lze postupně po položkách,
   ne jen vše naráz.
5. **Tracking poškození** — k assetu lze kdykoli přidat záznam o poškození
   (kdy, popis, závažnost, fotky). Asset s totálním poškozením přechází do
   stavu `damaged` a mizí z běžných seznamů.
6. **Archivace** — asset lze označit jako `sold` / `retired` / `lost` /
   `damaged`. Archivované assety jsou skryté v day-to-day pohledech, ale
   zůstávají v databázi kvůli historii a dohledávání.
7. Hledat / filtrovat assety (typ, stav, lokace, vlastník, tagy).
8. Audit log — kdo, kdy, co změnil.

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

Jediný **lidsky čitelný kód** — primární klíč pro uživatele i pro URL. Lepí
se na štítky, dá se přečíst a opsat ručně, když QR nejde naskenovat.

Formát: `<KAT>-<SEQ>` (např. `LAP-000123`), volitelně s **org prefixem**
(`<ORG>-<KAT>-<SEQ>`, např. `ACME-LAP-000123`) — admin si v nastavení
instance může prefix zapnout, default je bez něj.

- `ORG` — 2–6 znaků, volitelný, nastaví se při inicializaci instance.
- `KAT` — 2–4 znaky, prefix kategorie (`LAP`, `MON`, `TOOL`…).
- `SEQ` — zero-padded sekvence v rámci kategorie, ≥ 5 míst.

Pravidla:
- Pouze `A–Z`, `0–9` a `-`.
- Case-insensitive při vyhledávání.
- Kód je primární identifikátor v URL: `/a/LAP-000123`.
- QR kód kóduje URL. Na štítku je pod QR i čitelný kód pro ruční zadání.

> **Otevřená otázka:** podporovat externí identifikátory (sériové číslo
> výrobce, čárový kód EAN) jako vyhledatelné aliasy?

## 6. Datový model (high-level)

Instance = jedna organizace, takže `tenant_id` v žádné tabulce není.
Konfigurace organizace (název, prefix, povolené domény) je jeden singleton
záznam v tabulce `OrgSettings`.

```
OrgSettings (singleton)
  ├── name
  ├── code_prefix (volitelný "ACME")
  └── allowed_domains[]  // exact match, pro Google auto-join

User (role: admin / operator / member / auditor)

Location (hierarchie: budova → patro → místnost)

AssetType (kategorie, prefix kódu, custom fields schema)

Asset
  ├── code (PK, např. "LAP-000123")
  ├── type_id, location_id
  ├── assigned_to (User, nullable — interní přiřazení)
  ├── status: in_stock | assigned | on_loan | in_repair
  │         | damaged | sold | lost | retired
  ├── archived_at (nullable — kdy přešel do terminal stavu)
  ├── custom_fields (JSON podle AssetType)
  └── ...

AssetEvent (audit log: created, moved, assigned, returned, status_changed …)
  ├── asset_id, actor_user_id, occurred_at
  ├── type, payload (JSON)

DamageReport
  ├── asset_id
  ├── occurred_at (kdy se to stalo, ne kdy zapsáno)
  ├── reported_at, reported_by
  ├── description
  ├── severity: minor | major | total
  ├── photos[] (cesty v /data/uploads)
  └── resolved_at (nullable — kdy opraveno / vyřazeno)

Loan (výpůjčka)
  ├── borrower_name (vždy vyplněno)
  ├── borrower_user_id (nullable — pokud interní uživatel)
  ├── borrower_contact (e-mail/telefon, optional pro externí)
  ├── purpose (text, optional)
  ├── loaned_at, expected_return_at
  ├── created_by
  └── LoanItem[]

LoanItem
  ├── loan_id, asset_id
  ├── returned_at (nullable — postupné vracení)
  ├── return_condition: ok | damaged
  └── return_notes
```

Status výpůjčky je derivovaný z `LoanItem.returned_at`:
- žádná položka vrácená → `open`
- některé vrácené → `partially_returned`
- všechny vrácené → `fully_returned`
- past `expected_return_at` a ne `fully_returned` → flag `overdue` přes UI

Pokud se položka vrátí `damaged`, automaticky se vytvoří `DamageReport`
(odkaz na vrácení v payloadu) a asset přechází do `in_repair` nebo `damaged`
podle závažnosti.

## 7. Architektura

**Frontend** (Vite + React + TypeScript):
- React Router, TanStack Query, formuláře přes React Hook Form + Zod.
- UI: Tailwind + shadcn/ui (rychlý start, dobrá DX).
- QR scanning přes kameru: `html5-qrcode` nebo `@zxing/browser`.
- Stavěno jako SPA, build je statický → servíruje ho backend přímo.

**Backend** (Node + TypeScript):
- **Hono** jako HTTP framework — lehký, dobrá DX, snadno běží v Dockeru.
- **Drizzle ORM** — first-class SQLite podpora, migrace v SQL, typesafe queries.
- **SQLite** v WAL módu, jediný `.db` soubor v perzistentním volume.
- API přes tRPC nebo REST + Zod — sdílené typy s frontendem.

**Auth:**
- Custom session/cookie auth + raw Google OAuth (PKCE) — bez externí knihovny
  (better-auth byl zvažovaný, ale jednoduchý vlastní kód = méně závislostí).
- Google OAuth jako primární provider (e-mail/password není v plánu).
- Single-tenant model: žádná `tenant_id` izolace v queries, jen autorizace
  podle role.
- **Domain auto-join**: admin instance v nastavení přidá povolené e-mailové
  domény (`acme.com`). Kdokoli s Google e-mailem na povolené doméně se po
  prvním přihlášení automaticky stane uživatelem (default role: `member`),
  bez pozvánky.
- Implementace v Google callback handleru (`findOrCreateUserForGoogle`):
  zkontrolovat doménu v `OrgSettings.allowed_domains`, vytvořit User záznam.
- Per-doménu lze nastavit default role; Google emaily jsou verified by default
  a neověřené odmítneme.
- **Match je strict exact** — `acme.com` neodpovídá `eng.acme.com`. Subdomény
  musí být přidány samostatně.
- Pozvánky e-mailem zůstávají jako fallback pro externisty mimo povolené
  domény. V dev je dispatch e-mailů přes `ConsoleEmailSender` (vypíše do
  stdoutu); produkce dostane SMTP implementaci.
- Dev-login (POST `/auth/dev-login`) pro lokální testování bez Google
  credentials — v produkci je vypnutý (`NODE_ENV=production`).

**Storage:** lokální filesystem v dedikovaném volume (`/data/uploads`).
S3-compatible (MinIO, R2) lze přidat později přes env config.

**Deployment:**
- Single Docker image (multi-stage build: build FE → build BE → runtime).
- `docker-compose.yml` s service `app` + persistent volume pro `/data`
  (obsahuje `app.db`, `uploads/`).
- Žádná externí závislost — SQLite žije ve volumu, vše běží v jednom
  kontejneru. Ideální pro self-hosting.
- Reverse proxy (Traefik/Caddy) pro TLS si řeší serveraď podle prostředí.

**Zálohy:**
- SQLite je jeden soubor → triviální zálohovat z hostitele
  (`sqlite3 app.db ".backup backup.db"`, nebo `cp` při zastavené appce,
  nebo Litestream pro continuous replikaci do S3).
- **V appce žádné backup UI** — zálohy řeší správce serveru externě.
- `docs/SELF_HOSTING.md` bude obsahovat recepty:
  - varianta A: cron + `sqlite3 .backup` + rsync do off-site,
  - varianta B: Litestream jako sidecar (`docker-compose` snippet),
  - obnova ze zálohy (restore + restart).

## 8. Tech stack souhrn

| Vrstva       | Technologie                                  |
|--------------|----------------------------------------------|
| Frontend     | Vite + React + TypeScript                    |
| Styling      | Tailwind + shadcn/ui                         |
| State/Data   | TanStack Query                               |
| Validace     | Zod (sdílená mezi FE a BE)                   |
| Backend      | Node + Hono + TypeScript                     |
| ORM          | Drizzle                                      |
| Databáze     | SQLite (WAL mode)                            |
| Auth         | Custom session + Google OAuth (PKCE)         |
| QR           | html5-qrcode nebo @zxing/browser             |
| Storage      | lokální FS (volume), volitelně S3-compatible |
| Deployment   | Docker (single image) + docker-compose       |
| Zálohy       | Litestream → S3-compatible                   |
| CI           | GitHub Actions (build & push image)          |
| Testy        | Vitest + Playwright (E2E)                    |

## 9. Milestones

### M0 — Setup (≈ 3 dny)
- Monorepo (npm workspaces): `apps/web` (Vite + React), `apps/server`
  (Hono), `packages/shared` (Zod schemata, typy).
- Tailwind, shadcn, ESLint, Prettier, Vitest.
- Drizzle + SQLite, první migrace, seed script.
- Dockerfile (multi-stage) + `docker-compose.yml`, lokální dev s
  `docker compose up` i bez Dockeru (`npm run dev`).

### M1 — Auth & onboarding (≈ 4 dny)
- better-auth + Google OAuth.
- Onboarding flow při prvním spuštění instance: založení `OrgSettings`
  (název, volitelný prefix), první přihlášený = admin.
- Pozvánky e-mailem + akceptace pozvánky.
- **Domain auto-join**: UI v nastavení (přidat/odebrat doménu, default
  role, exact-match validace) + sign-in hook, který doménu vyhodnotí
  a vytvoří uživatele.
- Layout, navigace, role guards (middleware na serveru i route guardy ve FE).

### M2 — Asset CRUD (≈ 1 týden)
- AssetType editor (název, prefix kódu, custom fields schema).
- Vytvořit / editovat / smazat asset, generování kódu `<KAT>-<SEQ>`
  (volitelný `<ORG>` prefix podle `OrgSettings`).
- Seznam s filtry, fulltext (SQLite FTS5), default skrývá archivované.
- Generování QR + tisková stránka štítků (PDF / print CSS), na štítku QR
  i lidsky čitelný kód.

### M3 — Pohyby, sken & poškození (≈ 1 týden)
- Mobile-friendly QR scanner.
- Detail assetu + historie událostí (AssetEvent).
- Interní check-out / check-in (přiřazení uživateli, lokaci).
- **Damage reports**: přidat poškození (datum, popis, severity, fotky),
  list poškození na detailu assetu, severity `total` → status `damaged`.
- Změna stavu assetu (archivace: `sold` / `lost` / `retired` / `damaged`),
  list "archivované" jako separátní pohled.

### M4 — Výpůjčky (≈ 1 týden)
- Vytvořit výpůjčku: vybrat 1+ assetů, borrower (interní user nebo externí
  jméno+kontakt), účel, expected_return_at.
- Detail výpůjčky se seznamem položek a stavem každé.
- **Postupné vracení**: každá položka má vlastní "Vrátit" akci (datum,
  stav: ok/damaged, poznámka). Damage při vrácení → automaticky
  DamageReport.
- Přehled aktivních výpůjček, overdue highlight.
- Filtr "co má kdo půjčené".

### M5 — Lokace, uživatelé & polish (≈ 5 dní)
- Strom lokací.
- Správa uživatelů, rolí, pozvánek.
- Read-only auditor role.
- Export do CSV (assety, výpůjčky, poškození).
- Empty states, error handling.
- `docs/SELF_HOSTING.md` (deployment + zálohy + obnova).
- README + `docker-compose.yml` k rozjetí jedním příkazem.

**Cílem MVP** je dostat se na konec M5 — self-hostable produkt nasaditelný
jako Docker image.

## 10. Otevřené otázky

1. **Externí výpůjčky a uživatelé** — když půjčuju externí osobě, chceme
   držet kontakty jako separátní entitu (Contact / Borrower), nebo stačí
   free-text pole na výpůjčce? (Free-text je rychlejší pro MVP, ale ztratí
   historii "co všechno měl Jan Novák půjčené".)
2. **Notifikace o overdue výpůjčkách** — chceme automatický e-mail
   borrowerovi a/nebo adminovi, když výpůjčka přejde expected_return_at?
3. **Damage workflow** — má proces opravy svůj stav (`in_repair` jako
   přechodný)? Kdo damage report uzavírá (admin? kdokoli?)?
4. **Archivace** — má mít archivovaný asset volnou položku k stažení
   (např. doklad o prodeji jako příloha)?
5. **Custom fields** v MVP, nebo až po prvních uživatelích?
6. **Offline support** — důležitý pro provoz ve skladech bez signálu?
7. **Lokalizace** — jen CZ/EN, nebo víc jazyků?
8. **Compliance** — GDPR určitě, ale potřebujeme i další?

## 11. Rizika

- **Scope creep** — asset tracking je téma kde každý zákazník chce své
  speciální pole/workflow. Mitigace: jasné MVP, custom fields jako úniková
  cesta.
- **QR ve špatných podmínkách** (špinavé štítky, šero) — fallback ruční
  zadání kódu (proto je kód lidsky čitelný).
- **Ztráta `.db` souboru** = ztráta všeho. Mitigace: jasná self-hosting
  dokumentace se zálohami od dne 1, varování v admin UI pokud poslední
  známý backup chybí (volitelně — instance může poznat jen to, co jí
  serveraď napíše do env).
- **Postupné vracení a edge cases** — uživatelé mohou vrátit položku
  omylem, výpůjčka může být "ztracená v limbu". Mitigace: každé vrácení
  je AssetEvent, lze ho revertnout; overdue se hlásí.
- **Růst databáze přes přílohy** (fotky poškození) — uploads žijí mimo
  SQLite v `/data/uploads`, ale ratelimit / max size per file by měl být
  defaultně rozumný (např. 5 MB/foto).

## 12. Stav implementace

Sekce odpovídá aktuálnímu stavu repa — udržuj ji čerstvou, ať při dalším
otevření projektu hned víme, kde jsme.

### Hotovo

**Backend (Hono + Drizzle + SQLite):**
- Schema + migrace (org_settings, users, sessions, invitations, locations,
  asset_types, assets, asset_events, damage_reports, loans, loan_items).
- Org settings (název, code prefix, allowed_domains) — singleton.
- Custom session auth (cookie `inv_session`) + Google OAuth (PKCE)
  + dev-login (NODE_ENV != production) + role guard middleware.
- Domain auto-join (strict exact-match) + first-user-becomes-admin bootstrap.
- Pozvánky e-mailem (token + 7denní expirace) + public accept endpoint.
  Sender abstrakce `EmailSender` — default `ConsoleEmailSender`.
- Assets CRUD: list/filter/fulltext, get, create (auto-kód z typu i ručně),
  PATCH s validací custom fields proti type schématu, archive/unarchive,
  assign/unassign uživateli, photos add/remove, events log.
- Asset types CRUD + custom fields schema (text/number/date/boolean/select).
- Locations CRUD (s parentem; cyklus chráněn).
- Damage reports: create s fotkami, list, resolve. Total severity →
  asset auto-archive jako `damaged`.
- Loans: create (validace dostupnosti), list (s derived status),
  detail (join s assety), postupné vracení per položka, `damaged` při
  vrácení → auto damage report + asset do `in_repair`.
- Uploads: multipart POST s MIME whitelist (JPEG/PNG/WebP/GIF) a velikostí
  limitem; GET pro stahování (path-traversal-safe, auth-protected).
- CSV export (assets, loans, damages) — UTF-8 BOM, otevíratelné v Excelu.
- QR endpoint (PNG) + bulk labels endpoint.
- Users management (admin list + role/disable; self-protection).

**Frontend (Vite + React + TanStack Query + Tailwind):**
- Layout s navigací, auth gate, login page (Google + dev-login),
  accept-invite page.
- Assets list (filtry, status, archivované, hledání), nový asset (vč.
  custom fields), detail (QR vedle, akce, fotky, poškození, historie,
  přiřazení uživateli, edit form, archivace).
- Asset types page s editorem custom field schématu.
- Locations page s hierarchickým stromem + breadcrumb path.
- Loans list s overdue flagem, nová výpůjčka (multi-select assetů),
  detail s postupným vracením.
- Štítky — bulk tisk QR + lidsky čitelný kód, print CSS.
- Users — admin spravuje role a deaktivace.
- Settings — org, allowed domains, pozvánky, CSV exporty.

**Tooling & deployment:**
- npm workspaces (root → apps/server, apps/web, packages/shared).
- TypeScript strict, ESLint, Prettier, Vitest (14 unit testů: domain,
  csv, custom-fields validátor).
- Dockerfile (multi-stage) + `docker-compose.yml` s `/data` volumem.
- `docs/SELF_HOSTING.md` (Caddy reverse proxy, cron+sqlite3 .backup,
  Litestream sidecar, recovery flow).
- `README.md` s onboardingem (lokální dev, Google OAuth setup, Docker).

### Co chybí

**Testy (priorita — `chceme testy`):**
- **E2E (Playwright)**: pokrýt klíčové flow proti běžícímu serveru s SQLite
  v temp adresáři. Minimální set:
  - login (dev-login) + logout
  - vytvoření asset typu s custom fields → vytvoření assetu → editace
  - QR endpoint vrací PNG, štítky se renderují
  - výpůjčka 2 assetů → postupné vrácení (jeden OK, druhý damaged) →
    damage report se objeví, asset přechází do in_repair
  - archivace assetu (sold) → mizí z default listu, vidí se s flagem
  - admin pozve uživatele → otevření accept-invite linku → vytvoření
    sessions + první přihlášení
  - domain auto-join (mock Google OAuth callback) → user se vytvoří
    s default rolí, neexistujicí doména → 403
  - admin spravuje role + deaktivuje uživatele → deaktivovaný uživatel
    je odhlášený
- **Integrační (Vitest + supertest/`app.request`)**: API endpointy proti
  in-memory SQLite, ověřit autorizační guardy a edge cases (postupné
  vracení, double-return, custom fields required, file upload limity).
- **Unit testy** (rozšířit): location tree (cycles + orphans), asset code
  generator (kolize, padding), Google OAuth PKCE helpery.
- **Smoke test v CI** — GitHub Actions: typecheck + unit + E2E proti
  ephemeral kontejneru.

**Funkční mezery:**
- SMTP sender (interface připravená, jen implementace + env).
- Notifikace pro overdue výpůjčky (e-mail borrowerovi + denní digest pro
  admina; cron uvnitř aplikace nebo externí kron).
- Explicit `in_repair` workflow tlačítko (teď nastane jen automaticky
  po damaged vrácení; admin nemůže ručně poslat asset do opravy/zpět).
- Damage attachment limit per report (DB nemá hard cap; přidat validaci).
- Bulk import assetů (CSV upload + preview + commit).
- Strom lokací: drag-and-drop reordering / přesun pod jiný parent.
- Lokace v seznamu assetů jako sloupec (teď jen v detailu).
- Vyhledávání podle externích identifikátorů (sériové číslo) přes
  custom_fields — index nad JSONem nebo separátní `asset_external_ids`
  tabulka.
- Onboarding tour / empty states při prvním rozjetí instance.

**Bezpečnost & provoz:**
- Rate-limiting (login, OAuth callback, uploads) — teď neomezené.
- CSRF ochrana pro stavové requesty (cookies jsou SameSite=Lax, ale
  explicit token by neuškodil).
- Audit log v UI (teď je v DB, ale není kde se na něj kouknout napříč
  assety).
- Healthcheck endpoint pro Docker (`/health` máme, ale není zapojený
  v Dockerfile `HEALTHCHECK`).
- Auto-migrace při startu (zatím manuální `npm run db:migrate`).

**Polish / DX:**
- Mobilní QR sken (kamera) — endpoint funguje, web UI ale jen statický
  obrázek; potřeba `html5-qrcode` na detailu.
- Lokalizace (zatím jen CZ, ale stringy nejsou centralizované —
  i18next nebo aspoň `messages.ts`).
- Dark mode (nice-to-have).
- Filtrace výpůjček (status, borrower, datum).
- E2E testovací data fixture / `db:seed --e2e` profil.

