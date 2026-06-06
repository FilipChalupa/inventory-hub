# Inventory Hub — plán projektu

Vize, produktové rozhodnutí a rizika. Stav implementace už neudržuju —
zdroj pravdy je kód, README, `git log` a `docs/SELF_HOSTING.md`.

## 1. Vize

Inventory Hub je **self-hostable systém pro trackování assetů**. Nasazuje se
jednou per firma (1 Docker instance = 1 organizace) a spravuje její inventář
fyzických assetů. Každý asset má unikátní lidsky čitelný identifikátor,
kompletní historii pohybů, poškození a výpůjček.

## 2. Kdo to používá

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
- Notifikace nad rámec e-mailu (webhook, Slack).
- Náklady, odpisy, účetní napojení.
- Plánovaná údržba / servisní intervaly.
- RFID / Bluetooth tagy.
- API pro integrace.
- Billing & subscription tiers.
- **Role u mutací výpůjček (nice to have)** — teď může výpůjčky zakládat,
  editovat, mazat i z nich odebírat položky kterýkoli přihlášený uživatel
  (`requireAuth()` v `app.ts`). Zvážit omezení mazání/úprav jen na admina.

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

Externí identifikátory (sériové číslo výrobce, EAN, manufacturer SKU) jsou
podporované přes dedikovanou tabulku `asset_external_ids` — najdou se z
hlavního vyhledávání i ze skeneru.

## 6. Tech stack souhrn

| Vrstva       | Technologie                                  |
|--------------|----------------------------------------------|
| Frontend     | Vite + React + TypeScript                    |
| Styling      | Tailwind (+ dark mode `class`)               |
| State/Data   | TanStack Query                               |
| Validace     | Zod (sdílená mezi FE a BE)                   |
| Backend      | Node + Hono + TypeScript                     |
| ORM          | Drizzle (auto-migrate na startu)             |
| Databáze     | SQLite (WAL mode)                            |
| Auth         | Custom session + Google OAuth (PKCE)         |
| QR           | `html5-qrcode`                               |
| Storage      | lokální FS (volume), volitelně S3-compatible |
| Deployment   | Docker (single image, SPA + API z jednoho portu) + docker-compose |
| Zálohy       | Litestream → S3-compatible                   |
| CI           | GitHub Actions (typecheck + unit + E2E)      |
| Testy        | Vitest + Playwright (E2E)                    |
| Offline      | Service worker (read-only cache)             |

## 7. Rozhodnuté otázky (historie)

1. **Externí výpůjčky a uživatelé** — vyřešeno jako entita `contacts`.
   Výpůjčka má `borrowerContactId` (volitelný) i původní `borrowerName`
   (snapshot pro historii, pokud kontakt zmizí).
2. **Notifikace o overdue výpůjčkách** — implementováno (`runOverdueCheck`,
   e-mail borrowerovi + admin digest, idempotent přes
   `loans.overdue_notified_at`).
3. **Damage workflow** — `in_repair` je explicit přechodný stav,
   admin/operator může spustit repair-start / repair-finish ručně,
   nebo se nastaví automaticky při `damaged` vrácení z výpůjčky.
   Damage report uzavírá kdokoli s admin/operator rolí (`/resolve`).
4. **Archivace — přílohy** — asset má samostatnou „Dokumenty" sekci (PDF
   i obrázky); zvýrazněná když je archivovaný.
5. **Custom fields v MVP** — ano, přes `customFieldsSchema` na asset typu.
6. **Offline support** — základní read-only přes service worker. Writes
   pass-through s offline banner; queue offline mutací odložen.
7. **Lokalizace** — zatím jen CZ, infrastruktura (`messages.ts`) připravená;
   EN doplníme až ji někdo bude potřebovat.
8. **Compliance** — TODO koment ve `lib/sessions.ts`. GDPR v scope, další
   regimes (HIPAA, SOC 2, ISO 27001…) explicitně mimo MVP.

## 8. Rizika

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
- **Růst databáze přes přílohy** (fotky poškození, dokumenty) — uploads
  žijí mimo SQLite v `/data/uploads`, ale ratelimit / max size per file
  by měl být defaultně rozumný (např. 5 MB/foto).
- **Auto-migrace + restart loop** — pokud migrace selže, server skončí s
  exit 1 a docker-compose restartuje. Mitigace: zálohovat před každým
  nasazením nové verze, sledovat `docker logs` po deploy.
