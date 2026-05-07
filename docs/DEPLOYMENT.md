# Deployment — UpCloud (staging + production)

Runbook for at provisionere infrastruktur og deploye Grundtone Studio til UpCloud. MVP kører på én
VM med Docker Compose + Caddy, bruger UpCloud Managed PostgreSQL og UpCloud Object Storage som
eksterne services.

---

## 1. Kom i gang med UpCloud

### 1.1 Oprettelse

- Opret konto på [upcloud.com](https://upcloud.com) (EU billing, GDPR-venligt)
- Vælg datacenter (anbefalet: **Helsinki** eller **Frankfurt** — begge EU)
- Tilføj SSH-nøgle til kontoen via UpCloud panel → Account → SSH keys

### 1.2 Første ressourcer

| Ressource             | Størrelse (MVP)                | Formål                        |
| --------------------- | ------------------------------ | ----------------------------- |
| Cloud Server          | 1 vCPU / 2 GB RAM / 40 GB disk | App-værten (Docker Compose)   |
| Managed PostgreSQL 17 | `DEV-1x1` (HA off for MVP)     | Primær database               |
| Object Storage        | 50 GB / 1 region               | Config-blobs (tokens, heroes) |

Opret via **UpCloud Control Panel** (web UI, default). `upctl` CLI-kommandoer nedenfor er valgfri
genveje for folk der foretrækker terminal.

---

## 2. Provisionering

### 2.1 Cloud Server

Via Control Panel: Servers → Create → Ubuntu 24.04 LTS, plan 1xCPU-2GB, zone
Helsinki/Frankfurt/London, tilknyt SSH-nøgle.

Alternativt via `upctl` (valgfrit — kræver `brew install upcloudltd/tap/upcloud-cli`):

```bash
upctl server create \
  --hostname studio-staging \
  --plan 1xCPU-2GB \
  --os "Ubuntu Server 24.04 LTS" \
  --zone de-fra1 \
  --ssh-keys allan@...
```

Efter oprettelse:

```bash
ssh root@<server-ip>
# Opret non-root user
adduser studio
usermod -aG sudo studio
rsync --archive --chown=studio:studio ~/.ssh /home/studio
# Fra nu af: ssh studio@<server-ip>
```

### 2.2 Managed PostgreSQL

- Opret via Control Panel → Databases → Create
- Navn: `studio-staging-db`
- Version: PostgreSQL 17
- Plan: DEV-1x1 (opgrader til HA-plan inden produktion)
- Region: samme som VM
- Noter connection string i format `postgresql://<user>:<pass>@<host>:<port>/<db>?sslmode=require`
- Tilføj VM'ens public IP til IP allowlist på databasen

### 2.3 Object Storage

- Opret bucket `studio-staging-configs` i samme region
- Generer Access Key + Secret Key under bucket settings
- Sæt bucket ACL til **public read** hvis CDN skal hente direkte uden signed URLs (alternativt
  bruges signed URLs — afklares i Fase 1)

### 2.4 DNS

Peger et subdomæne (fx `studio-staging.klanghaus.com`) til serverens public IP via A-record hos
jeres DNS-provider. Caddy klarer TLS automatisk via Let's Encrypt.

---

## 3. Server-setup

SSH som `studio`-bruger, derefter:

```bash
# Docker + Compose plugin
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker studio
newgrp docker

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 4. Første deploy

### 4.1 Hent deploy-artefakter

```bash
mkdir -p ~/grundtone-studio && cd ~/grundtone-studio

# Hent kun de filer vi behøver på serveren (Compose + Caddyfile)
curl -O https://raw.githubusercontent.com/KlangHaus/grundtone-studio/develop/docker-compose.production.yml
curl -O https://raw.githubusercontent.com/KlangHaus/grundtone-studio/develop/Caddyfile
mv docker-compose.production.yml docker-compose.yml
```

### 4.2 Env-fil

Opret `~/grundtone-studio/.env.production` med:

```
DATABASE_URL=postgresql://<upcloud-db-user>:<pass>@<upcloud-db-host>:5432/<db>?sslmode=require
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://studio-staging.klanghaus.com
S3_ENDPOINT=https://<objectstorage-host>
S3_REGION=de-fra1
S3_BUCKET=studio-staging-configs
S3_ACCESS_KEY_ID=<upcloud-os-key>
S3_SECRET_ACCESS_KEY=<upcloud-os-secret>
NUXT_PUBLIC_APP_URL=https://studio-staging.klanghaus.com
NUXT_PUBLIC_CDN_BASE=https://cdn-staging.grundtone.io
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=<postmark-server-token>
SMTP_PASSWORD=<postmark-server-token>
EMAIL_FROM=Grundtone Studio <no-reply@grundtone.io>
IMAGE_TAG=latest
DOMAIN=studio-staging.klanghaus.com
```

Kun `studio`-user skal kunne læse:

```bash
chmod 600 .env.production
```

### 4.3 Login til GHCR

Billeder pushes af GitHub Actions til `ghcr.io/klanghaus/grundtone-studio`. På serveren:

```bash
echo "<github-pat-with-read:packages>" | docker login ghcr.io -u <github-username> --password-stdin
```

### 4.4 Start

```bash
docker compose pull
docker compose up -d
docker compose logs -f app
```

Caddy henter TLS-cert automatisk efter første request. Testsignup:

```bash
curl -sL https://studio-staging.klanghaus.com/
```

---

## 5. Opdateringer

GitHub Actions bygger og pusher nyt image på hver commit til `develop` eller `main`. Deploy:

```bash
ssh studio@<server-ip>
cd ~/grundtone-studio
docker compose pull
docker compose up -d
```

Migrations kører automatisk via entrypoint ved app-start.

Til rollback: sæt `IMAGE_TAG=sha-<commit>` i `.env.production` og `docker compose up -d`.

---

## 6. Backup og disaster recovery

### 6.1 Postgres

- UpCloud Managed PostgreSQL tager **daglige snapshots** som standard
- Manuel backup: `pg_dump` via psql-connection eller UpCloud snapshot-kommando
- Test restore mindst én gang før produktion

### 6.2 Object Storage

- Versionering enabled på bucket (Control Panel)
- Gamle versioner beholdes i 30 dage før slet

### 6.3 VM

- Snapshot før hver deploy i produktion (kan automatiseres i build-workflow via upctl)

---

## 7. Åbne skridt inden produktion

- [ ] Opgrader Managed PostgreSQL til HA-plan
- [ ] Konfigurér UpCloud monitoring + alerts
- [ ] Opret `studio-production-*` ressourcer parallelt med staging
- [ ] Sentry EU-region eller GlitchTip self-hosted til error tracking
- [ ] Setup Bunny.net CDN foran Object Storage (afklares i Fase 1)
- [ ] Vælg email-provider officielt (Postmark EU / Scaleway / SES)
