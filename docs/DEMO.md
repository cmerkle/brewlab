# Online demo

`DEMO=1` turns the Brewlab image into a public demo that people can try without installing anything.

- **Every visitor gets a private copy of the demo data.** That copy is all fictional: the demo
  recipes, bags and gear, plus five months of made-up brewing so Insights has something to show.
  It lives in memory and nobody else sees it. A browser cookie (`brewlab_demo`) points to it.
  A copy is dropped after `DEMO_IDLE_MIN` minutes idle; the next visit starts fresh.
- **The demo never writes to `/data`.** It never opens a real database, and never touches backups,
  uploads or an AI key. Setting `DEMO=1` on a real install leaves that install's data alone, but it
  serves the demo instead, so don't.
- **AI is always off in the demo**, even if `LLM_*` variables are set, so visitors can't spend your
  key. Discover works the no-AI way: you add candidates and Brewlab ranks them.
- **Turned away with a 403** ("Not available in the online demo"): anything that would write
  outside the visitor's copy or call another site:
  - bag photos and OCR, and link import or AI lookup (`/api/import/*`)
  - the AI provider key (`/api/ai`)
  - backups (`/api/backups`) and restore (`/api/setup/restore`)
  - the update check (`/api/about/check`)
  - `/metrics` and `/uploads`
- **In the app,** a dismissable banner says it's a demo. The settings and import options above
  are left out, and *Export all data* still downloads the visitor's own copy.
- **Limits:**
  - At most `DEMO_MAX_SANDBOXES` copies at a time (default 300; about 0.35 MB each). When it's
    full, the least recently used copy goes.
  - At most `DEMO_NEW_PER_IP` new copies per address per hour (default 30).
  - The proxy in front is trusted for the client address (`TRUST_PROXY_HOPS`, default 1).
- The starting data is rebuilt once a day, so the history always ends today.

Because there's no real data in it, the demo is the one Brewlab that's fine to put on the public
internet without authentication. The no-login warning in the README still applies to every real install.

## Run it on Fly.io

The config is [`deploy/fly/fly.toml`](../deploy/fly/fly.toml). It runs the published image
(`ghcr.io/cmerkle/brewlab:latest`) on **one always-on machine** with 512 MB. That's one
shared-cpu-1x VM, a few dollars a month (see Fly's pricing). It has to be a single machine that
doesn't stop: the copies are in that machine's memory, so a second machine or an idle stop would reset visitors.

1. Install `flyctl` and sign in: `fly auth login`.
2. Create the app without deploying. Pick a free name; it becomes `<name>.fly.dev`:
   ```bash
   fly launch --no-deploy --copy-config -c deploy/fly/fly.toml --name <name>
   ```
   (or `fly apps create <name>` and set `app = "<name>"` in the toml.)
3. Deploy on one machine:
   ```bash
   fly deploy -c deploy/fly/fly.toml --ha=false
   ```
4. Check it: `curl https://<name>.fly.dev/api/health` → `{"ok":true,"demo":true,…}`.

To update after a release, run `fly deploy -c deploy/fly/fly.toml --ha=false` again. It pulls the
new `latest` image; visitors' copies start fresh after a deploy. `fly logs` shows the template being
built at startup.

## Run it anywhere else

The image is the same, so set `DEMO=1` and put it behind HTTPS:

```bash
docker run -d --name brewlab-demo -e DEMO=1 -p 7642:7642 ghcr.io/cmerkle/brewlab:latest
```

Run exactly one container, with no volume (it isn't used).
