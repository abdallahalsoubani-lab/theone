# Mobile device QA checklist

Per Prompt 11 §4.7.3. Run before each release on at least the four
devices below. Document findings in the release notes.

## Device matrix

| Device              | OS / Browser            | Why                                                                |
| ------------------- | ----------------------- | ------------------------------------------------------------------ |
| iPhone SE (1st gen) | iOS Safari (latest)     | Smallest still-shipping iPhone; tightest layout constraint.        |
| iPhone 14           | iOS Safari (latest)     | Midrange notch behaviour; safe-area inset.                         |
| Samsung Galaxy A52  | Android Chrome (latest) | Most-common patient device profile in Amman.                       |
| iPad (any)          | iPadOS Safari (latest)  | The Secretary's typical workstation when away from the front desk. |

## Critical paths × device

For every device walk these flows; capture issues per device:

- Login (password + OTP)
- Secretary calendar — drag an appointment, open the side panel,
  open every modal
- Patient file — every tab
- Patient home program — tap an exercise, complete it, check the
  compliance strip updates
- Adult intake — every step

## Bottom-sheet behaviour

On every mobile device confirm: opening any of the five modal
surfaces (Cancel, Recurring, ChangeTherapist, Side panel,
CreateAppointment) slides up from the bottom with a visible swipe
handle. ESC, the close button, and tapping the overlay all
dismiss it.

## Reporting

For each device, save a short note + screenshots:

```
Device: iPhone SE (1st gen)
Date: 2026-06-15
Issues:
  - calendar: scroll snaps too aggressively on swipe (issue #125)
  - cancel modal: keyboard pushes the textarea off-screen (issue #126)
```
