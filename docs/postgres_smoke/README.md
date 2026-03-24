# PostgreSQL Smoke Test

Ovaj paket je Phase 0 support za BI-backend PostgreSQL tranziciju. Fokus je samo na connectivity, autentikaciji, prvoj migraciji i reverzibilnom smoke artefaktu. Nema jos storage apstrakcija ni sirokog schema dizajna.

## Scope

- `.env.example` za DB config template
- `pg` pool helper u `src/core_shell/db/client`
- query i migration helperi u `src/core_shell/db/helpers`
- smoke migracija u `src/core_shell/migrations/smoke`
- smoke skripta u `scripts/postgres_smoke_test.js`
- minimal logging i failure handling

Napomena: repo je trenutno `commonjs`. Smoke paket prati postojeci runtime kako ne bi uvodio siru runtime migraciju prije validacije DB foundation faze.

## Prerequisites

1. PostgreSQL instanca mora biti dostupna na `192.168.100.158:5432`.
2. Baza `bi_baza` mora postojati.
3. Korisnik `marin` mora imati pravo spajanja na `bi_baza`.
4. Lozinku postaviti kroz environment varijablu `BI_DB_PASSWORD` ili lokalni `.env`.
5. `pg` dependency mora biti instaliran.

## Environment Setup

1. Kopirati `.env.example` u `.env`.
2. Upisati stvarnu vrijednost za `BI_DB_PASSWORD`.
3. Po potrebi prilagoditi `BI_DB_SSL` ako instanca zahtijeva SSL.

Alternativno, stvarne credentiale mozes drzati izvan repoa i pokrenuti smoke s vanjskim env fileom preko `BI_DB_ENV_FILE`.

Primjer `.env`:

```dotenv
BI_DB_HOST=192.168.100.158
BI_DB_PORT=5432
BI_DB_NAME=bi_baza
BI_DB_USER=marin
BI_DB_PASSWORD=your_real_password
BI_DB_SSL=false
BI_DB_SCHEMA_SMOKE=bi_smoke
```

## Execution

Pokreni standardni smoke test:

```powershell
npm run db:smoke
```

Ako koristis vanjski secret file:

```powershell
$env:BI_DB_ENV_FILE="C:\Users\Marin\.secrets\bi-backend-postgres.env"
npm run db:smoke
```

To verificira:

1. network connectivity prema PostgreSQL hostu
2. autentikaciju i spajanje na `bi_baza`
3. `SELECT 1`
4. `CREATE SCHEMA IF NOT EXISTS bi_smoke`
5. `CREATE TABLE IF NOT EXISTS bi_smoke.connection_smoke`
6. insert i readback iz smoke tablice
7. cleanup smoke reda

Ako zelis eksplicitno verificirati rollback smoke sheme:

```powershell
npm run db:smoke:cleanup
```

To nakon inserta i readbacka pokrece down migraciju:

```sql
DROP TABLE IF EXISTS bi_smoke.connection_smoke;
DROP SCHEMA IF EXISTS bi_smoke;
```

## Expected Output

Uspjesan run logira:

- pocetak smoke testa s host/baza meta podacima
- uspjesnu autentikaciju
- uspjesan `SELECT 1`
- uspjesan migration `up`
- uspjesan insert/readback
- cleanup status

Fail run vraca `exit code 1` i ispisuje PostgreSQL error message/code.

## pgAdmin Setup Notes

Saved connection kreirati ovako:

- `Name`: `BI Backend Smoke`
- `Host name/address`: `192.168.100.158`
- `Port`: `5432`
- `Maintenance database`: `bi_baza`
- `Username`: `marin`
- `Password`: unijeti rucno i po zelji `Save Password`

Manual verification u pgAdminu:

```sql
SELECT 1;
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name = 'bi_smoke';

SELECT *
FROM bi_smoke.connection_smoke
ORDER BY created_at DESC;
```

Ako je smoke pokrenut s `db:smoke`, tablica i schema ostaju, ali insertani red se brise. Ako je pokrenut s `db:smoke:cleanup`, schema i tablica se uklanjaju down migracijom.

## Files Touched By Layer

- `src/core_shell/config/*`
- `src/core_shell/db/*`
- `src/core_shell/logging/*`
- `src/core_shell/migrations/smoke/*`
- `scripts/postgres_smoke_test.js`
- `.env.example`

## Boundary Impact

- uveden je izolirani Core Shell DB smoke boundary
- business moduli nisu dirani
- API layer nije diran
- filesystem ostaje samo za config i migration datoteke

## Rollback Note

Kod rollbacka ove faze dovoljno je:

1. ukloniti nove smoke support datoteke
2. pokrenuti `npm run db:smoke:cleanup` ako smoke schema postoji
3. ukloniti `pg` dependency ako se DB foundation odgada
