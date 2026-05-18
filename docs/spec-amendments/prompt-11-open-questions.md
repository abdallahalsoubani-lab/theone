# Spec §17 — open-questions closure (PROPOSED)

Per Prompt 11 §4.13. Each row carries a **proposed** disposition
based on what was built across Prompts 1-11. The project owner
signs off (or amends) before this document is merged into the main
spec as the canonical §17.

> All rows below are marked **PROPOSED** until the owner signs off
> with their initials + date.

| #   | Question                                         | Proposed disposition                                                                                                                                                                                     |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Number of therapists at launch?                  | **PROPOSED**: 3-5 at launch (matches calendar UX assumptions). Owner to confirm.                                                                                                                         |
| 2   | Multiple doctors per patient (consulting model)? | **PROPOSED**: v1 ships with single `responsibleDoctor` + plan author. "Consulted" doctors deferred to v2.                                                                                                |
| 3   | Working hours and weekends?                      | **PROPOSED**: Set per the Clinic Settings UI (§4.5). Default seed: Sun-Thu 09:00-18:00, Sat 10:00-14:00, Fri closed. Owner adjusts on first login.                                                       |
| 4   | Hijri or Gregorian default?                      | **PROPOSED**: Per-user pref on the User row. Clinic-wide default in `ClinicSettings.hijriDefault` (default **false** — Gregorian).                                                                       |
| 5   | Billing in scope for v1?                         | **PROPOSED**: **No** — deferred to v2. Tracked in `docs/backlog.md`.                                                                                                                                     |
| 6   | Multi-clinic support?                            | **PROPOSED**: Single-clinic v1. Multi-tenant is a major v2 effort touching every query.                                                                                                                  |
| 7   | Native mobile app?                               | **PROPOSED**: Web-only v1. PWA install is a small v1.1 task using the existing responsive layout.                                                                                                        |
| 8   | Existing data to migrate at launch?              | **PROPOSED**: TBD — if yes, the owner writes a one-off `scripts/import-existing-records.ts` against the documented JSON shape in `lib/exports/patientFile.tsx`. Not a feature.                           |
| 9   | Insurance integration?                           | **PROPOSED**: **Deferred** — no vendor partner selected yet.                                                                                                                                             |
| 10  | Backup geography?                                | **PROPOSED**: Primary DB at Frankfurt (Hetzner CX31). Backups to Wasabi `eu-central-2` (Frankfurt) as a different provider. Both within EU GDPR perimeter; close to Jordan latency.                      |
| 11  | Doctor sees all patients or only own?            | **PROPOSED**: "Own" — responsible doctor + plan author scope, as implemented in `lib/rbac/can.ts` and `lib/patients/access.ts`. Owner confirms this matches clinical workflow.                           |
| 12  | Patient self-booking?                            | **PROPOSED**: **Deferred to v1.1**. The conflict engine + appointment service layer support it without a redesign; the missing pieces are the patient-side UI and a moderation flag on `ClinicSettings`. |

## Sign-off

Owner to replace each **PROPOSED** with a definitive disposition,
add their initials + date, and merge this file into the main
`docs/Theone-pt-Technical-Spec.md` §17.

```
Initials: __________   Date: __________
```
