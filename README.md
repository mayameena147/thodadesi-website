# Thoda Desi — storefront

Gen Z ethnic wear. A hand-built static site that is also a real store:
browse → pick a size → bag → checkout → pay online (Razorpay) or cash on
delivery → order lands in Supabase → manage it from `/admin/`.

No frameworks. Plain HTML + CSS + vanilla JS, Netlify Functions for
everything secret, Supabase (Postgres) for data.

## Architecture

```
Browser  (HTML/CSS/JS — never holds a secret)
   │
   ├── GET  /api/catalog            products + per-size stock + shipping rules
   ├── POST /api/create-order       prepaid: re-price server-side, Razorpay order
   ├── POST /api/verify-payment     HMAC check, mark paid, decrement stock
   ├── POST /api/create-cod-order   COD: atomic stock reserve, then order
   ├── POST /api/razorpay-webhook   payment.captured / failed (backup path)
   ├── GET  /api/public-config      Supabase URL + anon key (public by design)
   ├── POST /api/admin-update-order admin-only (role re-checked server-side)
   └── POST /api/admin-inventory    admin-only stock/price/active updates
   │
Netlify Functions  (esbuild-bundled, share js/lib/pricing.js with the browser)
   │
Supabase Postgres  (schema + RLS + stock RPCs: supabase/schema.sql)
Razorpay           (test mode until the whole flow is verified)
```

Money rules, all enforced server-side:

- The browser sends only `{ sku, size, qty }`. Prices are re-read from the
  database; a tampered price in devtools changes nothing.
- Razorpay signatures are verified (HMAC-SHA256) before an order is marked
  paid; the payment is also fetched from Razorpay's API and its amount
  compared.
- Stock: COD reserves atomically (all-or-nothing SQL) **before** the order
  exists; prepaid decrements exactly once at capture (browser confirm and
  webhook race safely). Cancelling / returning restocks once.
- Order numbers are customer-friendly and sequential: `TD10001`, `TD10002`…

## Repository layout

```
index.html, checkout.html, thank-you.html      the shop
admin/index.html                               back office (auth required)
policies/*.html                                shipping / returns / privacy / terms
styles.css                                     one stylesheet, design tokens on :root
js/lib/                                        pricing (shared with server), cart,
                                               catalogue, auth, supabase, helpers
js/components/                                 product grid, bag drawer, badge, menu
js/home.js, js/checkout.js, js/admin.js        page entry points
data/catalog.json                              fallback catalogue (API is the truth)
netlify/functions/                             the API (see above)
supabase/schema.sql                            run once in the SQL editor
tests/                                         node --test (pure logic + flow + authz)
```

## Setting it up from zero

### 1. Supabase

1. Create a project at supabase.com (free tier is fine to start).
2. SQL editor → paste the whole of `supabase/schema.sql` → Run.
   This creates tables, row-level security, stock RPCs and seeds the two
   current products with stock 10 per size.
3. Project Settings → API: note the **URL**, **anon** key and
   **service_role** key.

### 2. Razorpay (test mode)

1. Create an account, stay in **Test mode**.
2. Settings → API Keys → generate. Note `rzp_test_…` key id + secret.
3. Settings → Webhooks → Add: URL `https://<your-site>/api/razorpay-webhook`,
   events `payment.captured` and `payment.failed`, and choose a long random
   webhook secret (this is a third secret, distinct from the API pair).

### 3. Netlify

1. Connect the repo; build settings are already in `netlify.toml`
   (publish `.`, functions `netlify/functions`).
2. Site configuration → Environment variables — set:

   | Variable | What |
   |---|---|
   | `RAZORPAY_KEY_ID` | `rzp_test_…` (public) |
   | `RAZORPAY_KEY_SECRET` | API secret (server only) |
   | `RAZORPAY_WEBHOOK_SECRET` | the webhook string you chose |
   | `SUPABASE_URL` | `https://….supabase.co` |
   | `SUPABASE_ANON_KEY` | public key, RLS-governed |
   | `SUPABASE_SERVICE_ROLE_KEY` | bypasses RLS — server only |

3. Deploy. `/api/catalog` should now return JSON.

### 4. First admin user

1. Supabase → Authentication → Users → **Add user** (email + password,
   tick auto-confirm).
2. SQL editor:

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'you@example.com'
   on conflict (user_id) do update set role = 'admin';
   ```

3. Open `/admin/`, sign in. Orders tab + Inventory tab.

## Local development

```
npm install          # once — installs netlify-cli
cp .env.example .env # fill in the same six variables
npm run dev          # netlify dev: site + functions on localhost
npm test             # 35 logic/flow/authorization tests, no network needed
```

## Day-to-day

- **Orders**: `/admin/` → Orders. Search by name/phone/number, filter by
  status, update status (pending → confirmed → packed → shipped →
  delivered; cancelled/returned put stock back automatically), add courier
  + AWB, tick "COD collected" when the cash arrives.
- **Stock**: `/admin/` → Inventory → edit numbers → Save stock.
- **Prices / hiding a product**: also via the Inventory API (price,
  active), or directly in Supabase → Table editor → `products`. New
  products: insert a `products` row + one `product_variants` row per size
  (and mirror the copy in `data/catalog.json` for the offline fallback).
- **Shipping rules**: Supabase → `shop_config` — free-shipping threshold,
  flat rate, COD on/off. No code changes.

## Testing the whole journey (before going live)

1. Browse, pick sizes, add to bag; refresh — the bag survives.
2. Quantity + / − / remove in the drawer; totals and the free-shipping
   nudge update.
3. Checkout with a bad phone / PIN — the form refuses.
4. COD order → thank-you page with TD number → appears in `/admin/` with
   payment badge COD → stock dropped by the ordered quantity.
5. Prepaid with Razorpay test cards/UPI (`success@razorpay` etc.) →
   thank-you page → admin shows Paid → stock dropped.
6. Fail/cancel a test payment — friendly error, bag intact, no stock
   change; the order row shows `failed` once the webhook lands.
7. Set a size's stock to 0 in admin — the chip strikes through on the
   site; try ordering it anyway via devtools — the API refuses.
8. Open `/admin/` in a private window — sign-in wall; sign in with a
   non-admin user — "No access", and the APIs return 401/404.

## Going live

1. Complete Razorpay KYC; switch the dashboard to Live mode.
2. Generate **live** keys; replace `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
   in Netlify env vars (nowhere else — the code never changes).
3. Recreate the webhook in Live mode (same URL, new secret →
   `RAZORPAY_WEBHOOK_SECRET`).
4. Redeploy, run one real ₹1-style sanity order, refund it, done.

## Costs

Netlify free tier (125k function calls/mo) + Supabase free tier (500 MB)
comfortably cover early volume; at ~100 orders/day expect to move to
Supabase Pro (~US$25/mo) mainly for backups. Razorpay charges per
transaction (~2% + GST); COD costs whatever your courier charges. No other
recurring costs — no npm runtime dependencies at all.

## Known limitations (deliberate, for now)

- No customer accounts / order-history page (guests only, by design).
- No email/SMS/WhatsApp notifications yet — the cleanest next step is a
  Supabase → email hook or a transactional service wired into
  `settlePayment()` and `create-cod-order`; nothing else needs to change.
- No coupons, no GST invoices, no rate limiting beyond cart caps —
  Netlify/Supabase both offer add-ons when volume justifies them.
- Product photography is shared between the two current products; new
  products need their images added under `images/`.
