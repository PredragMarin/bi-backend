# SERVER_WORKSPACE_RULES

## Purpose

This document formalizes the server-first workspace rule for `bi-backend`.

The server becomes the only active workspace.
Local C: is no longer a development source of truth after migration cutover.

## Rule A

Never edit app code directly on the server outside the Git working tree flow.

This means:

- all app code changes happen inside the server repo working tree
- every change is intentionally committed
- deploys are performed from committed repo state
- no ad hoc patching of tracked code outside Git history

## What Counts As App Code

Treat the following as app code:

- `src/*`
- `scripts/*`
- tracked docs that define contracts or operating rules
- `package.json`
- `package-lock.json`
- tracked deployment helpers

## What Stays Outside Repo

Keep these outside the repo folder:

- `.env`
- `.secrets`
- certificates
- runtime-only uploads
- machine-local PM2/process manager metadata
- any company backup or host-specific operational material that should not be versioned

## Daily Working Rule

Normal path:

1. open the server repo in VS Code / Codex
2. make changes only in the repo working tree
3. review `git status`
4. commit intentionally
5. push to GitHub
6. deploy from the repo workflow you selected

Do not:

- edit tracked files with quick shell edits outside the repo workflow
- patch live files and promise to fix Git later
- keep uncommitted server-only differences in tracked files

## Allowed Exceptions

Allowed exception scope is narrow:

- active production incident where service restoration is blocked
- temporary diagnostic logging needed to identify an outage
- operator action needed to restore env, permissions, PM2, proxy, or external secrets

Even in an incident:

- prefer fixing through the repo working tree on the server
- if a tracked file is edited urgently, capture the diff immediately
- commit the same fix back into Git history before ending the incident

## Incident Fix Rule

If an emergency tracked-code fix happens:

1. write down timestamp, file, reason, and operator
2. capture `git diff`
3. convert the emergency change into a real commit immediately after stabilization
4. push that commit to GitHub
5. record the incident and recovery note

The incident is not finished until the running code and Git history match again.

## Anti-Chaos Guardrails

To prevent "I only changed one small thing" drift:

- always check `git status` before and after a deploy
- if `git status` is dirty unexpectedly, stop and inspect
- do not restart from a dirty tree unless you explicitly accept that risk
- treat uncommitted tracked changes on the server as an exception state

## Server Workspace Source Of Truth

After migration cutover:

- source of truth for active code = server repo working tree
- source of truth for history = GitHub repository
- old C: repo = historical reference only, not an active development workspace
  Dodajem na sugestiju chatgpt
  server je jedini aktivni workspace nakon uspješne migracije
  C: se više ne koristi za razvoj nakon green cutovera
  tracked app code se ne uređuje ručno na serveru izvan Git toka
  sve promjene idu kroz repo working tree + commit + push
  secrets, env i operativni server resursi drže se izvan bi-backend
  hitni live fix je dopušten samo u incidentu i mora biti vraćen u Git povijest odmah nakon stabilizacije

2. Dodajte i commitajte ta dva filea

Kad ih pregledate i popunite:

git add docs/MIGRATION_FREEZE_2026_04_06.md docs/SERVER_WORKSPACE_RULES.md
git commit -m "docs: record migration freeze and server workspace rules" 3. Uzmite novi hash nakon commita

Nakon commita:

git rev-parse HEAD

Taj novi hash postaje vaš stvarni freeze commit za migraciju, ne ovaj stari 9253....

4. Pushajte branch

Zatim:

git push origin restructure/core-shell-v1 5. Na GitHubu provjerite da je gore isti novi hash

To je vaš službeni cutover snapshot.

Važna napomena

Trenutni hash 9253192... je samo stanje prije docs commita.
Pravi migration freeze hash treba biti hash nakon što commitate ova dva dokumenta.

Što nakon toga

Kad to napravite, pošaljite mi samo:

rezultat git rev-parse HEAD nakon commita
rezultat git status --short nakon commita i pusha
