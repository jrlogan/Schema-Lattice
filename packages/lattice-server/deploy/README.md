# The hosted instance

Live at **https://34.75.250.234.sslip.io** — a GCE `e2-micro` in `$LATTICE_GCP_ZONE`,
project `$LATTICE_GCP_PROJECT` ("Lattice"), instance name `lattice`.

`sslip.io` is wildcard DNS that resolves `{ip}.sslip.io` to that IP, which is
enough for Caddy to obtain a real Let's Encrypt certificate without owning a
domain. `schemalattice.io` is **not registered yet**; when it is, point its A
record here and swap the site block in `Caddyfile`. Nothing in the data
changes — canonical URIs are always `https://schemalattice.io/...` regardless
of which host serves them (DECISIONS.md § Identity and naming).

## Why this shape

The server is one stateful process: SQLite in WAL mode plus a `blobs/`
directory. That rules out Firebase Hosting (static only) and Cloud Run
(ephemeral filesystem — two instances would diverge). What it needs is a small
VM with a persistent disk, and measured against the real workload a very small
one suffices:

| | measured |
|---|---|
| cold start (model + seed + index) | 1.1–1.3 s |
| resident memory | ~255 MB of the box's 969 MB |
| `discover` (embeds the query) | ~18 ms, flat from 1 to 16 cores |
| `resolve` | 0.03 ms |

CPU is not the constraint; memory is, and the headroom is comfortable. A 2 GB
swapfile covers the `node-gyp` build peak, which is the only moment 1 GB is
tight.

**Cost:** the `e2-micro` itself is in the always-free tier (one per billing
account, `us-west1`/`us-central1`/`us-east1`, 30 GB standard disk, 1 GB/mo
North-America egress). The external IPv4 is *not* free — roughly $3/month.

## Scaling from here

Concept URIs contain the content hash, so a resolved record can never change.
`/c/...` and `/s/...` therefore return `Cache-Control: public, max-age=31536000,
immutable`, and `HEAD` answers identically to `GET`. That means:

1. **Now** — one VM handles this without noticing.
2. **Traffic grows** — put a CDN in front. Resolution, the dominant read path,
   caches at the edge permanently and never reaches the origin.
3. **Discover grows** — the only real CPU cost. Run read-only replicas; each
   rebuilds SQLite and the vector index from `blobs/`, which are the source of
   truth. Writes stay on one node (single-publisher is already locked for v0.1).
4. **v0.2** — federation, deliberately deferred.

Migration off this box is `rsync` plus `npm ci`; nothing here is a commitment.

## Layout on the box

```
/srv/schemalattice/app     the repo (scp'd, not cloned — no remote push needed)
/srv/schemalattice/data    dev.db + blobs/  ← the only precious directory
/etc/schemalattice/env     LATTICE_API_KEY, mode 600
/etc/systemd/system/schemalattice.service
/etc/caddy/Caddyfile
```

The app binds `127.0.0.1:7000`; Caddy terminates TLS and proxies to it. Reads
are public, the five write tools require `Authorization: Bearer $LATTICE_API_KEY`,
and `/mcp` is gated as a whole because it exposes those write tools.

## Operating it

```bash
G="gcloud compute ssh lattice --zone=$LATTICE_GCP_ZONE --project=$LATTICE_GCP_PROJECT"

$G --command="sudo systemctl status schemalattice"
$G --command="sudo journalctl -u schemalattice -f"
$G --command="sudo systemctl restart schemalattice"
$G --command="sudo cat /etc/schemalattice/env"        # the write key
```

### Deploying a change

```bash
tar czf /tmp/lattice.tgz --exclude=node_modules --exclude=var --exclude=.git \
  packages/lattice-server specs skills *.md
gcloud compute scp /tmp/lattice.tgz lattice:~/ --zone=$LATTICE_GCP_ZONE
$G --command="sudo tar xzf ~/lattice.tgz -C /srv/schemalattice/app \
  && sudo chown -R schemalattice:schemalattice /srv/schemalattice/app \
  && cd /srv/schemalattice/app/packages/lattice-server \
  && sudo -u schemalattice HOME=/srv/schemalattice npm ci --no-audit --no-fund \
  && sudo systemctl restart schemalattice"
```

Skip the `npm ci` when only source changed.

### Reading feedback

`lattice_feedback` notes land in the events table:

```bash
$G --command="sudo -u schemalattice sqlite3 /srv/schemalattice/data/dev.db   "SELECT ts, json_extract(payload,'\\$.rating'), json_extract(payload,'\\$.message')
    FROM events WHERE kind='feedback' ORDER BY id DESC LIMIT 20;""
```

The demand report (what vocabulary visitors searched for and didn't find)
is public: `POST /api/tools/lattice_demand_report`.

### Backups

`blobs/` is the source of truth; `dev.db` and the vector index are both
rebuildable from it.

```bash
$G --command="sudo -u schemalattice sqlite3 /srv/schemalattice/data/dev.db \
  \".backup '/tmp/lattice.db'\" && sudo tar czf /tmp/lattice-backup.tgz \
  -C /srv/schemalattice/data blobs -C /tmp lattice.db"
gcloud compute scp lattice:/tmp/lattice-backup.tgz . --zone=$LATTICE_GCP_ZONE
```

## Verifying

```bash
B=https://34.75.250.234.sslip.io
curl -s $B/health
curl -s "$B/discover?description=a+person+who+belongs+to+an+organization&limit=3"
curl -sI $B/c/schemalattice/person@6c4ba1376fd9    # 200, immutable cache-control

# A write without the key must be refused.
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/tools/lattice_publish_context \
  -H 'content-type: application/json' -d '{}'      # expect 401
```

## Provisioning from scratch

If this box is ever lost, `provision.sh` equivalent is:

```bash
gcloud compute addresses create lattice-ip --region=us-east1
gcloud compute firewall-rules create lattice-allow-web --network=default \
  --action=ALLOW --rules=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=lattice-web
gcloud compute instances create lattice --zone=$LATTICE_GCP_ZONE --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --address=<reserved-ip> --tags=lattice-web --metadata=enable-oslogin=TRUE
```

Then: 2 GB swapfile, `build-essential python3 sqlite3`, Node 20 via nodesource,
Caddy via its apt repo, a `schemalattice` system user, `npm ci`, `npm run seed`,
and the two config files in this directory.
