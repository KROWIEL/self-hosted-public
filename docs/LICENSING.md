# Licensing & monetization

This panel is **open-core**: a generous free core drives adoption, and paid tiers
unlock add-on modules through a signed, offline-verifiable license key.

> **Buyers:** activate a paid plan under **Billing → License key** (admin only), or
> set the `LICENSE_KEY` env var. No key ⇒ the free core.
>
> **Note:** the seller-side license *issuer* (the private signing key + key
> generator) is **not** part of this public repository. This repo only contains
> the offline *verifier* (a public key) — that is by design and safe to publish.

## Activation modes

The panel supports two modes, chosen by the operator via `.env`:

- **Offline / key-only** (default, no `LICENSE_ACTIVATION_URL`): the key is
  verified locally (signature + expiry). Works air-gapped.
- **Online activation** (`LICENSE_ACTIVATION_URL` set): the panel sends a
  periodic heartbeat to an activation server. Paid modules stay unlocked only
  while a recent heartbeat succeeded; without contact they lock after the grace
  window (`LICENSE_ACTIVATION_MAX_AGE_MS`). This enables revocation and seat
  limits. The activation server is seller-side and not distributed here.

## Tiers

| Tier | Price (suggested) | What it unlocks |
|------|-------------------|-----------------|
| **Free** | $0 forever | Full core: deploy from git, templates, HTTPS, managed DBs, logs & live metrics, projects, RBAC, 2FA, unlimited nodes |
| **Home-Lab** | ~$3 / mo | Everything in Free **+ Reverse-tunnels module** (expose NAT / home-lab nodes) |
| **Pro** | ~$15 / mo | Everything + **all 9 modules** below |

### Gated modules

Each module is an independently licensable add-on. A tier grants a set of them;
a license may also grant extra modules à la carte (via the `modules` field in
the key payload).

| Module id | From tier | Description |
|-----------|-----------|-------------|
| `reverse-tunnels` | Home-Lab | Expose services on NAT / home-lab nodes to the internet through a lightweight public relay. |
| `preview-envs` | Pro | Deploy any branch as a disposable, isolated environment (a cloned child service) with its own optional subdomain; auto-torn down by TTL. |
| `offsite-backups` | Pro | Mirror managed-database backups to any S3-compatible bucket, with encrypted credentials and a background upload worker. |
| `alerts` | Pro | Webhook alerts for node-offline, deploy-failed, backup-failed and resource-threshold events, via configurable channels & rules. |
| `metrics-history` | Pro | Periodically sample and store per-node CPU / RAM / disk usage, with history charts. |
| `sso` | Pro | OpenID Connect single sign-on with JWKS verification, domain allow-list and just-in-time user provisioning. |
| `audit-export` | Pro | Organization-wide audit log with server-side filters and CSV / JSON export. |
| `api-cli` | Pro | Personal API tokens (PATs) for programmatic access to the API / CLI, integrated into the JWT auth guard. |
| `white-label` | Pro | Customize the app name, logo, accent color and attribution across the UI and login page. |

Tier → modules mapping lives in `packages/shared/src/licensing.ts`
(`TIER_MODULES`); `Home-Lab = [reverse-tunnels]`, `Pro = all modules`. Adding a
new gated module is a one-line change there plus a `@RequiresModule('...')` on
the backend and (optionally) a nav/page guard.

## Architecture

```
Seller side                         Customer's installation
-----------                         -----------------------
tools/license-issuer  --sign-->     LICENSE KEY  --paste-->  Billing page
  (private key)                                                  │
                                                                 ▼
                                             control-plane verifies (public key)
                                                    → Entitlements (tier, modules)
                                                                 │
                              ┌──────────────────────────────────┼───────────────┐
                              ▼                                    ▼               ▼
                     ModuleGuard (@RequiresModule)      AuthMe.entitlements   GET /license
                     gates paid endpoints               drives UI unlock      Billing page
```

- **Key format:** `base64url(payloadJson).base64url(ed25519Signature)`.
- **Verification:** offline, with an embedded Ed25519 public key
  (`apps/control-plane/src/common/licensing/license.ts`), overridable via
  `LICENSE_PUBLIC_KEY`. No phone-home — works air-gapped.
- **Storage:** the active key lives in the `licenses` table (set via the UI) or
  the `LICENSE_KEY` env var. No valid key ⇒ Free.
- **Enforcement:** backend gates with `ModuleGuard`; a locked call returns a
  coded `license.moduleLocked` error. The frontend hides/soft-gates locked
  features (lock badge in the sidebar, upgrade screen on the page).

## Backend pieces

| File | Role |
|------|------|
| `common/licensing/license.ts` | Verify key, derive entitlements |
| `common/licensing/entitlements.service.ts` | Resolve/cache active key, set/clear |
| `common/licensing/module.guard.ts` + `require-module.decorator.ts` | `@RequiresModule('x')` gating |
| `common/licensing/licensing.controller.ts` | `GET /license`, `PUT /license`, `DELETE /license` |
| `modules/auth/auth.service.ts` (`me`) | Adds `entitlements` to `/auth/me` |

To gate a new feature:

```ts
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('offsite-backups')
@Controller('backups')
export class BackupsController { /* ... */ }
```

## Frontend pieces

- `components/entitlements.tsx` — `EntitlementsProvider` + `useEntitlements()`.
- `components/upgrade-notice.tsx` — reusable locked-feature screen.
- `app/billing/page.tsx` — current plan, key activation (admin), pricing + buy links.
- Sidebar shows a lock on gated items that aren't unlocked.

## Activating a paid plan (buyers)

1. Purchase a plan; you receive a license key by email.
2. In the panel, go to **Billing → License key** (admin) and paste it — or set
   `LICENSE_KEY` in your `.env`.
3. Point checkout links via `NEXT_PUBLIC_BUY_HOMELAB_URL` / `NEXT_PUBLIC_BUY_PRO_URL`
   if you self-host a store.

The signing/issuing side (private key, key generator, store webhook) lives in the
seller's private tooling and is intentionally not distributed here.
