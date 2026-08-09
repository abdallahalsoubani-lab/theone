# Media upload — why "add exercise with an image/video" fails, and how to find out

Written for the PT-B5 QA report: _adding an exercise works, adding one with an
image or a video fails._ The code path is verified working on `main` (see
"Was it the code?" below), so on a deployed VM this is almost always one of
four environment problems. Work the list top-down — it is ordered by how often
each one is the culprit.

**First, get the exact message the user saw.** It identifies the failing stage
on its own, which saves most of the work:

| What the user sees (AR / EN)                                              | Stage that failed                                          | Go to                                                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `الملف يتجاوز حد …` / "File exceeds the … limit"                          | Rejected before or during the PUT                          | §1 (nginx) — the browser pre-check uses the app's own limit, so if the app allowed it and the user still sees this, a proxy rejected it |
| `خدمة تخزين الملفات غير متاحة` / "File storage is currently unavailable"  | The PUT reached the app, the app could not reach MinIO/S3  | §2, §3                                                                                                                                  |
| `انقطع الاتصال أثناء الرفع` / "Connection dropped during upload"          | Network or proxy timeout mid-transfer                      | §1 (timeouts)                                                                                                                           |
| `انتهت صلاحية جلسة الرفع` / "The upload session expired"                  | The 15-minute capability token expired mid-upload          | §4                                                                                                                                      |
| `فشل الرفع` / "Upload failed"                                             | PUT failed for another reason                              | check the app + nginx logs together                                                                                                     |
| `تم رفض الصورة/الفيديو المرفقة` / "The attached image/video was rejected" | **The upload SUCCEEDED**; the save rejected the media URL  | §5 — this means the deployed build is old                                                                                               |
| `<field>: …` / a field-named message                                      | The upload is irrelevant; a normal field failed validation | not a storage problem                                                                                                                   |

The first six all mean the browser's `PUT /api/v1/storage/...` failed. The
seventh means the file is already in storage and the _exercise save_ refused
it.

---

## 1. nginx body-size limit — the most likely cause

The app allows **10 MB images and 100 MB videos**
(`lib/storage/policies.ts`). If the reverse proxy caps the body lower, the
browser's own pre-check passes, the upload starts, and nginx kills it with a
413 — which the UI reports as "file too large" even though the app would have
accepted it.

```bash
grep -rn client_max_body_size /etc/nginx/
```

It must be at least the video ceiling plus headroom:

```nginx
client_max_body_size 105m;
# A 100 MB upload on clinic wifi takes minutes — do not let the proxy time out.
proxy_read_timeout 300s;
proxy_send_timeout 300s;
proxy_request_buffering off;
```

Then `nginx -t && systemctl reload nginx`.

> `docs/deploy/batch-deploy-31-39.md` already carries this change as an
> unapplied step. Confirm it was actually applied — a deploy checklist item
> that was written but never run is exactly this failure.

## 2. Is MinIO running and reachable from the app container?

```bash
docker compose ps                       # minio must be Up
curl -sf http://localhost:9000/minio/health/live && echo OK
```

From inside the app container (service name, not localhost):

```bash
docker compose exec app sh -lc 'wget -qO- $S3_ENDPOINT/minio/health/live && echo OK'
```

If this fails the app returns **503** and the user sees "storage unavailable".

## 3. Storage env vars and the bucket

The app reads these through `lib/env.ts`, and **every one has a silent
localhost/dev fallback** (`lib/storage/client.ts`) — so a missing variable in
production does not crash at boot, it fails at the first upload with a 502.
Check all five are actually set in the running container:

```bash
docker compose exec app sh -lc 'echo "$S3_ENDPOINT | $S3_BUCKET | $S3_REGION | ${S3_ACCESS_KEY_ID:+set} | ${S3_SECRET_ACCESS_KEY:+set}"'
```

- `S3_ENDPOINT` must be reachable **from the app container** (a compose
  service name such as `http://minio:9000`, not `http://localhost:9000`).
- `S3_BUCKET` must exist. Create it if missing:
  `docker compose exec minio mc mb local/theone-uploads`
- Wrong credentials or a missing bucket surface as **502**, same
  "storage unavailable" message as a down service.

## 4. `AUTH_SECRET`

Upload capability tokens are signed with it
(`lib/storage/uploadToken.ts`), and the signer **throws** when it is absent.
If it is missing, login is broken too — so if staff can log in, this is not
your problem. Tokens live 15 minutes; a very slow large upload can outlive one,
which now reports "the upload session expired" rather than a generic failure.

## 5. If the message is "the attached image/video was rejected"

Then storage is fine and the **save** refused the URL. On current `main` this
should be impossible for a freshly uploaded file: media URLs are same-origin
proxy paths (`/api/v1/storage/...`) and the schema accepts them
(`lib/exercises/schemas.ts`, regression test
`lib/exercises/__tests__/media-url.test.ts`).

It was NOT always so — an earlier build validated media URLs with
`z.string().url()`, which rejects a relative path. That is precisely the
"works without media, fails with media" symptom.

**So this message means the VM is running a build older than that fix.**
Check what is actually deployed before changing anything:

```bash
git -C /path/to/app rev-parse --short HEAD
docker compose images app
```

---

## Was it the code?

Verified on `main`: the create/update schema accepts a same-origin media path,
the create service persists all six media columns, `video/mp4` (plus
`quicktime` and `webm`) is allowed at 100 MB, images at 10 MB, and none of the
media fields is required. Covered by
`lib/exercises/__tests__/media-url.test.ts` and
`lib/exercises/__tests__/media-persist.test.ts`.

Two genuine code defects found alongside the QA report were fixed in the same
batch, both of which made the failure harder to read rather than causing it:

- the Arabic save-failure message was a single flat sentence with no field
  name, so an Arabic-speaking user could not tell a rejected attachment from a
  short description;
- an expired upload token had no message of its own.

## Bytes never travel through a server action

Worth knowing before hunting for a `bodySizeLimit`: the browser PUTs the file
straight to `/api/v1/storage/<key>` (a Route Handler, no framework body cap)
and only the resulting **URL string** goes to the server action. Next.js's
1 MB server-action limit is therefore irrelevant here — the limits that matter
are nginx's and MinIO's.
