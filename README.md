# Crystal's Space — backend

This is the backend for Crystal's private content chat (part of the
Married in Cabo wedding business). It's a Cloudflare Worker: Crystal
tells it what changed — a budget number, a vendor detail, wording for
the site, or a note — and it saves that straight to Cloudflare KV the
moment she sends the message.

## Deploy — one click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME)

Click the button above (after you've swapped in your own repo URL — see
`HOW-TO-USE-THIS-REPO.md` at the top level of the download if you're
reading this before uploading). Cloudflare will:

1. Ask you to sign in / connect your Cloudflare account.
2. Create the KV namespace this Worker needs automatically.
3. Prompt you for two values on a setup screen — no code, no dashboard
   hunting:
   - **ANTHROPIC_API_KEY** — your key from console.anthropic.com
   - **SPACE_PIN** — a short PIN only you and Crystal know
4. Deploy the Worker and give you its live URL
   (`https://crystal-space.<your-subdomain>.workers.dev`).

Paste that URL into `BACKEND_URL` near the top of `crystal-space.html`,
then send that page (and the PIN) to Crystal. Done.

## What's in here

| File | Purpose |
|---|---|
| `src/index.js` | The Worker code. |
| `wrangler.jsonc` | Tells Cloudflare the Worker's name and that it needs one KV namespace (`SPACE_KV`), auto-created on deploy. |
| `package.json` | Deploy script + friendly labels for the two secrets the button will ask for. |
| `.dev.vars.example` | Reference for what those two secrets look like. |

## Manual deploy (fallback)

If you'd rather not use GitHub, you can still deploy this by hand —
paste `src/index.js` into a new Worker via the Cloudflare dashboard and
set up the secrets/KV binding yourself. Steps for that are in
`README-crystal-space.md` in the main project.
