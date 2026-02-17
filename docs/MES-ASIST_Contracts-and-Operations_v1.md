# MES-ASIST Contracts and Operations v1

## 1. Scope
Ovaj dokument definira:
- canonical event contract,
- incident lifecycle i rules DSL koncept,
- watchdog/runtime operacije,
- file-drop/NDJSON ugovor sa SMS gatewayem,
- state i idempotency model.

## 2. Canonical Event Contract (v1)

Canonical model je stabilni ugovor modula; `V_FEEDBACK` mapiranje je promjenjivi sloj.

Obavezna polja:
- `event_id` (string) - jedinstveni ID sirovog zapisa ili deterministički hash.
- `event_ts` (ISO datetime) - vrijeme događaja.
- `source` (string) - npr. `MES`.
- `plant` (string).
- `workstation_id` (string).
- `event_type` (enum) - `ERROR_CODE | ACTION_REQUEST | ACTION_FEEDBACK | SYSTEM_HEALTH`.
- `event_code` (string) - kod greške/zahtjeva.
- `event_text` (string) - opis.
- `severity_hint` (enum) - `INFO | WARN | ACTION | CRITICAL`.

Preporučena (opcionalna) polja:
- `line_id`, `cell_id`, `terminal_id`,
- `order_id`, `operation_id`, `serial_no`, `variant_code`,
- `shift_id`, `operator_id`,
- `qty_affected`, `downtime_sec`,
- `raw_status`, `raw_subcode`.

Meta polja:
- `raw_ref` (object) - pointer na original row,
- `schema_version` (string),
- `ingested_at` (ISO datetime).

## 3. Incident Lifecycle Contract (v1)

Statusi:
- `NEW`
- `TRIAGED`
- `DISPATCHED`
- `ACKNOWLEDGED`
- `IN_PROGRESS`
- `RESOLVED`
- `VERIFIED`
- `CLOSED`
- `CANCELLED`

Minimalna pravila tranzicija:
- `NEW -> TRIAGED` nakon rule klasifikacije.
- `TRIAGED -> DISPATCHED` kad je kreirana barem 1 akcija.
- `DISPATCHED -> ACKNOWLEDGED` na prvi pozitivan feedback (npr. SMS reply/operater ACK).
- `ACKNOWLEDGED|IN_PROGRESS -> RESOLVED` nakon potvrde otklona.
- `RESOLVED -> VERIFIED -> CLOSED` nakon verifikacije procesa.

SLA atributi po incidentu:
- `mtta_target_sec`,
- `mttr_target_sec`,
- `escalation_profile`,
- `priority_score`.

## 4. Rules DSL (Concept v1)

Pravila su u verzioniranim JSON datotekama (`rules/*.json`) i evaluiraju se redom prioriteta.

Rule shape (koncept):
- `rule_id`
- `enabled`
- `match` (plant/line/cell/event_type/event_code/regex_text/shift/order attributes)
- `classify` (`severity`, `priority`, `incident_type`)
- `actions` (lista akcija: `SMS`, `ANDON`, `NOTIFY_ROLE`, `CREATE_TASK`)
- `sla` (`ack_sec`, `resolve_sec`, `escalate_after_sec`)
- `dedup_policy` (`window_sec`, `key_fields`)

Policy datoteke:
- `feedback_rules.v1.json`
- `action_routes.v1.json`
- `sms_templates.v1.json`

## 5. SMS File-Drop / NDJSON Contracts

### 5.1 SMS Outbox JSON Contract
Obavezno:
- `message_id` (uuid),
- `sms_key` (idempotency key),
- `correlation_id` (incident/action key),
- `created_at` (ISO datetime),
- `phone_e164`,
- `text`,
- `priority`.

Preporučeno:
- `context` (`incident_id`, `event_code`, `workstation_id`, `order_id`),
- `callback_expected` (bool, default `true`),
- `template_id`, `template_version`.

Isporuka:
- atomic write: `*.tmp` pa rename u `*.json`.
- folder layout po datumu/liniji (configurabilno).

### 5.2 SMS Inbox NDJSON Contract
Svaka linija je JSON event:
- `ts`
- `event_type` (`QUEUED | SENT | DELIVERED | FAILED | REPLY`)
- `sms_key`
- `correlation_id`
- `gateway_message_id` (optional)
- `reply_text` (required samo za `REPLY`)
- `error_code` (required samo za `FAILED`)

## 6. Runtime / Watchdog Operations

Core intervali (inicijalno):
- `feedback_poll_interval_sec`: 10-30
- `sms_inbox_poll_interval_sec`: 5-10
- `heartbeat_interval_sec`: 10

Watchdog odgovornosti:
- pokreni tick i lock kontrolu (single runner),
- izvrši fetch->map->rules->actions pipeline,
- obradi inbox NDJSON,
- emit heartbeat i metrike.

Heartbeat payload (minimal):
- `service`, `module_version`, `ts`,
- `last_fetch_ok`, `last_fetch_ts`,
- `lag_sec`, `queue_depth`,
- `errors_last_window`.

## 7. State and Idempotency

State artefakti (predloženo):
- `state/watermark.json` (`last_event_ts`, `last_event_id`)
- `state/inbox_offset.json`
- `state/dedup_index.json`
- `state/incidents.ndjson` (audit timeline)

Idempotency pravila:
- `incident_key` deterministički iz ključnih polja događaja.
- `sms_key` deterministički iz incidenta + template verzije.
- isti `sms_key` ne šalji ponovno unutar dedup prozora.
- inbox evente deduplicirati po (`event_type`, `sms_key`, `gateway_message_id|ts`).

## 8. Evolvability Guidelines

- Nikad ne vezati engine logiku direktno za svih 50+ kolona `V_FEEDBACK`.
- Nova kolona ide prvo u mapping layer, tek onda opcionalno u canonical schema.
- Rules promjene isporučivati kao novu verziju pravila, bez hardcoded branchanja.
- Uvijek čuvati audit trag: raw input, odluka pravila, akcija, odgovor.

