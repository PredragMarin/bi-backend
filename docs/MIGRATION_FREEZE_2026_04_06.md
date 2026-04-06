# MIGRATION_FREEZE_2026_04_06

## Purpose

This document records the cutover freeze point for moving `bi-backend` from the local C: workspace to the server-first workspace model.

This is an operations record, not a refactor plan.

## Freeze Identity

- Freeze date: `2026-04-06`
- Freeze timezone: `Europe/Zagreb`
- Freeze workspace: `C:\Users\Marin\bi-backend`
- Git branch at freeze: `restructure/core-shell-v1`
- Git commit at freeze: `9253192b867186d998be9904d6fad5a070d219b9`
- Git remote: `origin = https://github.com/PredragMarin/bi-backend.git`

## Deployment Path Visibility

- `deploy.sh`: not visible from the repo
- `m-deploy.sh`: not visible from the repo
- PM2 config file in repo: not visible from the repo

## Runtime Baseline Visible In Repo

- Main API server entry point:
  - `src/api/server.js`
- Health endpoint:
  - `GET /health`
- Default port:
  - `3000`
- Local start helper currently visible:
  - `scripts/start_epr_server.cmd`

## Current Visible UI Entry Points

- `/ui/epr`
- `/ui/sms`
- `/ui/eojn`
- `/ui/dnopr`
- `/ui/dnopr-actions`
- `/ui/robotics-tecna`
- `/ui/dxf-ops-batch`
- `/ui/mother-dxf`

## Current Visible API/Module Surface

- EPR run:
  - `POST /api/epr/run`
- EPR run-db:
  - `POST /api/epr/run-db`
- Export and publish:
  - `POST /api/export-and-publish`
- SMS approvals:
  - `/api/approvals/v1/*`
- EOJN:
  - `/api/eojn/v1/*`
- DNOPR:
  - `/api/dnopr/v1/*`
- Robotics Tecna:
  - `/api/robotics/v1/tecna/*`
- DXF Ops batch:
  - `/api/dxf-ops/v1/*`
- Mother DXF:
  - `/api/mother-dxf/v1/*`

## Must Work After Migration

Mark each item before cutover as:

- `required`
- `nice_to_have`
- `deferred`

Suggested minimum cutover list:

| Area        | Item                                                  | Priority | Expected Result                           | Checked By |
| ----------- | ----------------------------------------------------- | -------- | ----------------------------------------- | ---------- |
| App process | PM2 process starts app on port 3000                   | required | process online, no crash loop             | Marin      |
| Health      | `GET /health`                                         | required | HTTP 200 with `{ "status": "ok" }`        | Marin      |
| UI          | `/ui/epr`                                             | required | page loads                                | Marin      |
| UI          | `/ui/eojn`                                            | required | page loads                                | Marin      |
| UI          | `/ui/dnopr`                                           | required | page loads                                | Marin      |
| UI          | `/ui/robotics-tecna`                                  | required | page loads                                | Marin      |
| UI          | `/ui/dxf-ops-batch`                                   | required | page loads                                | Marin      |
| UI          | `/ui/mother-dxf`                                      | required | page loads                                | Marin      |
| Config      | server env loads                                      | required | app sees required env vars                | Marin      |
| Secrets     | external secret paths available                       | required | app can read needed external secret files | Marin      |
| Output      | app can access repo-local `out/` path if still needed | required | no write-path failure in normal flow      | Marin      |

Add module-specific functional checks below before migration:

1. Da core shell radi sve svoje zadaće
2. Da svi Moduli rade što su i do sada radili
3. ***
4. ***
5. ***

## Server Placement Record

Fill this in during cutover:

- Server host: `192.168.100.91`
- Domain: `https://bi.marinexpert.hr`
- App folder target: `/home/marin/app`
- Runtime user: `bi_app_user`
- PM2 present: `yes` (per operator note)
- Secrets kept outside repo: `yes`
- External secrets path on server: ****\*\*****\_\_\_\_****\*\*****
- External runtime resources outside repo: ****\*\*****\_\_\_\_****\*\*****

## Rollback Record

Before first cutover deploy, record:

- Previous known-good server app source: ****\*\*****C:\Users\Marin\bi-backend\src\api\server.js****\*\*****
- Previous known-good restart command: ****\*\*****\_\_\_\_****\*\*****
- Previous known-good PM2 process name/id: ****\*\*****\_\_\_\_****\*\*****
- Rollback owner: ****\*\*****\_\_\_\_****\*\*****
- Rollback trigger condition: ****\*\*****\_\_\_\_****\*\*****

## Notes

- This freeze document should be committed before the migration cutover starts.
- If a hotfix is made during migration, record the new commit hash explicitly here or in a follow-up migration note.
  Dodajem po uputi chatgpt
  Date: 2026-04-06
  Branch: restructure/core-shell-v1
  Commit hash at freeze start: 9253192b867186d998be9904d6fad5a070d219b9
  Remote: origin https://github.com/PredragMarin/bi-backend.git
  Local workspace path: vaš C: path
  Target server path: /home/marin/app
  Decision: server becomes the only active workspace after successful migration

I dodajte kratku must work after migration listu, samo ono što danas stvarno postoji i koristite. Za početak:

/health mora vratiti OK
host app mora se podići na portu 3000 iza server setupa
src/api/server.js mora se pokrenuti bez fatalnih missing-env grešaka
/ui/epr mora se otvoriti
/ui/eojn mora se otvoriti
/ui/dnopr mora se otvoriti
/ui/sms mora se otvoriti
/ui/robotics-tecna ili stvarna postojeća robotics ruta mora se otvoriti ako je trenutno mountana
ključni Core Shell boundary dokumenti i module struktura moraju ostati prisutni

Nemojte stavljati buduće DXF ekrane ako još nisu stvarno u repou.
