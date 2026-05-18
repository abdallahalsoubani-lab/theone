# Production deployment — Path B (VPS + Docker Compose)

This is Theone.pt's chosen production path (per the project owner's
decision in Prompt 11's upfront questions). Cost target: **$40–60/mo**
for a Hetzner CX31 or DigitalOcean droplet hosting everything.

## Stack

| Service    | Image / package            | Purpose                                    |
| ---------- | -------------------------- | ------------------------------------------ |
| `web`      | `ghcr.io/<org>/theone-web` | Next.js app + edge middleware              |
| `workers`  | same image, different cmd  | BullMQ workers (`pnpm workers:start`)      |
| `postgres` | `postgres:16-alpine`       | Application database                       |
| `redis`    | `redis:7-alpine`           | Sessions, BullMQ queues, analytics cache   |
| `minio`    | `minio/minio:latest`       | S3-compatible object storage               |
| `caddy`    | `caddy:2`                  | Reverse proxy + auto TLS via Let's Encrypt |

## Step 1 — Provision the VPS

Hetzner CX31 (Frankfurt or Helsinki, both close to Jordan):

1. Create the server with Ubuntu 24.04 LTS.
2. SSH in as `root`, then create a non-root sudo user `deploy`.
3. Harden:
   ```bash
   apt update && apt -y upgrade
   apt -y install ufw fail2ban
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow OpenSSH
   ufw allow 80
   ufw allow 443
   ufw --force enable
   systemctl enable --now fail2ban
   ```
4. Disable root SSH and password auth in `/etc/ssh/sshd_config`:
   `PermitRootLogin no` + `PasswordAuthentication no`.
5. Install Docker + Compose plugin:
   ```bash
   curl -fsSL https://get.docker.com | sh
   usermod -aG docker deploy
   ```

## Step 2 — `docker-compose.yml`

Put `/opt/theone/docker-compose.yml` on the VPS:

```yaml
services:
  web:
    image: ghcr.io/<org>/theone-web:latest
    restart: unless-stopped
    env_file: .env
    depends_on: [postgres, redis, minio]
    ports: ['127.0.0.1:3000:3000']

  workers:
    image: ghcr.io/<org>/theone-web:latest
    command: ['pnpm', 'workers:start']
    restart: unless-stopped
    env_file: .env
    depends_on: [postgres, redis]

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: theone
      POSTGRES_USER: theone
      POSTGRES_PASSWORD: <strong-password>
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes: [redisdata:/data]

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: <minio-root>
      MINIO_ROOT_PASSWORD: <strong-password>
    volumes: [miniodata:/data]

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ['80:80', '443:443']
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddydata:/data

volumes:
  pgdata: {}
  redisdata: {}
  miniodata: {}
  caddydata: {}
```

`Caddyfile`:

```
theone.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## Step 3 — Environment

Copy `.env.production.example` (see repo root) into `/opt/theone/.env`.
Populate every value; rotate the secrets that ship as placeholders.

## Step 4 — Bootstrap the first Admin

After the first `docker compose up -d` and a successful migration:

```bash
docker compose exec web pnpm bootstrap:admin \
  --email "admin@theone.pt" \
  --phone "+962790000000" \
  --name-en "Clinic Owner" \
  --name-ar "مالك العيادة"
```

The temp password is printed once to stdout. Capture it; the user
must change it on first login.

## Step 5 — CI deploy workflow

`.github/workflows/deploy.yml` ships as a template. Populate the
secrets listed at the top of the file in the repository Actions
settings:

- `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`
- `DEPLOY_APP_DIR` (e.g. `/opt/theone`)
- `REGISTRY`, `REGISTRY_USER`, `REGISTRY_TOKEN`
- `SMOKE_URL` (e.g. `https://theone.example.com`)

The workflow guards itself when secrets are absent — pushing to
`main` won't fail; it just skips the deploy until the secrets exist.

## Step 6 — Backups

Daily `pg_dump` to a separate object store via `rclone`. Schedule a
weekly automated restore-to-sandbox check; see
[`docs/ops/disaster-recovery.md`](../ops/disaster-recovery.md).

## Rollback

```bash
ssh deploy@theone.example.com
cd /opt/theone
docker compose pull web                    # if a bad latest already shipped:
docker pull ghcr.io/<org>/theone-web:<previous-sha>
docker tag  ghcr.io/<org>/theone-web:<previous-sha> ghcr.io/<org>/theone-web:latest
docker compose up -d --no-deps web workers
```

The managed-services alternative is documented in
[`docs/deploy/managed.md`](./managed.md) for reference.
