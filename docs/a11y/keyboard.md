# Manual keyboard accessibility pass

Per Prompt 11 §4.8.2. Run before each release; document any
regressions inline.

## Procedure

For each critical path in both `/en` and `/ar`:

1. **Tab through every interactive element.**
   - Tab order must follow visual reading order (left-to-right in
     `/en`, right-to-left in `/ar`).
   - Every focusable element must show a visible focus ring.
   - No `outline: none` without a replacement.
2. **Esc closes modals + dropdowns.**
3. **Enter activates buttons + submits forms.**
4. **Focus is trapped inside open modals.**
5. **A skip-to-content link is the first focusable element.**

## Critical paths

- `/login` — both tabs (password + OTP)
- `/secretary/calendar` — day view; open a side panel; open the
  create-appointment modal
- `/secretary/patients` + a patient file
- `/admin/users` — DataTable + filters
- `/admin/leaves` — pending row → approve + reject
- `/admin/settings` — every tab
- `/admin/audit` — filter form + CSV link
- `/therapist/patients/:id` — every tab
- `/patient/dashboard` + `/patient/home-program`

## Reporting

Document findings in `docs/a11y/audit-log.md` (create per release):

```
Release: 2026-06-15
Tester: <name>
Findings:
  - calendar: focus ring invisible on appointment chips (issue #123)
  - patient form: Tab skips the gender select (issue #124)
```

## Screen reader spot checks

At minimum:

- Login form labels announced via VoiceOver / NVDA.
- Calendar event navigation announces event details on focus.
- Form validation errors announced via `aria-live="polite"`.
- Notification bell unread count change announced on update.
