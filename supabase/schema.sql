-- ==========================================================================
-- Thoda Desi — complete database schema
--
-- Run this whole file ONCE in the Supabase SQL editor (safe to re-run: every
-- statement is idempotent). It creates products, variants with per-size
-- stock, orders, order items, customers, payments, shop configuration,
-- row-level security, the admin role machinery, and the two stock RPCs the
-- Netlify functions call.
--
-- Security model in one paragraph: the browser holds only the public anon
-- key. Row-level security lets anyone read active products/variants and the
-- shop config (that IS the catalogue), lets an admin read orders, and denies
-- everything else. All writes go through Netlify functions holding the
-- service_role key, which bypasses RLS — so the policies below only ever
-- need to describe what a BROWSER may do.
-- ==========================================================================


-- ==========================================================================
-- 1. Shop configuration (shipping rules etc. — edit values, not code)
-- ==========================================================================

create table if not exists public.shop_config (
  id                            boolean primary key default true check (id), -- single row
  free_shipping_threshold_paise integer not null default 299900,
  shipping_flat_paise           integer not null default 9900,
  cod_enabled                   boolean not null default true,
  updated_at                    timestamptz not null default now()
);

insert into public.shop_config (id) values (true)
on conflict (id) do nothing;

alter table public.shop_config enable row level security;

drop policy if exists "config: public read" on public.shop_config;
create policy "config: public read"
  on public.shop_config for select
  to anon, authenticated
  using (true);


-- ==========================================================================
-- 2. Products and variants (stock lives on the variant = product + size)
-- ==========================================================================

create table if not exists public.products (
  id                    uuid primary key default gen_random_uuid(),
  sku                   text not null unique,
  slug                  text not null unique,
  number                text not null default '',
  category              text not null default '',
  name                  text not null,
  colour                text not null default '',
  description           text not null default '',
  price_paise           integer not null check (price_paise > 0),
  compare_at_price_paise integer check (compare_at_price_paise > price_paise),
  image                 text not null default '',
  alt                   text not null default '',
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  size        text not null,
  sku         text not null unique,   -- e.g. TD-KUR-001-M
  price_paise integer check (price_paise > 0), -- null = inherit product price
  stock_qty   integer not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  unique (product_id, size)
);

create index if not exists variants_product_idx on public.product_variants (product_id);

alter table public.products        enable row level security;
alter table public.product_variants enable row level security;

-- The catalogue is public by definition. Only active rows are visible;
-- stock_qty is deliberately readable so the site can show "out of stock".
drop policy if exists "products: public read active" on public.products;
create policy "products: public read active"
  on public.products for select
  to anon, authenticated
  using (active);

drop policy if exists "variants: public read active" on public.product_variants;
create policy "variants: public read active"
  on public.product_variants for select
  to anon, authenticated
  using (active);


-- ==========================================================================
-- 3. Customers (service-role only; upserted by the order functions)
-- ==========================================================================

create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null unique check (phone ~ '^[6-9][0-9]{9}$'),
  full_name    text not null default '',
  email        text,
  last_address jsonb,
  orders_count integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- RLS with no policies: unreadable and unwritable from any browser.
alter table public.customers enable row level security;


-- ==========================================================================
-- 4. Orders (customer-friendly numbers: TD10001, TD10002, ...)
-- ==========================================================================

create sequence if not exists public.td_order_number_seq start 10001;

create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null unique
                        default 'TD' || nextval('public.td_order_number_seq'),

  -- Two separate lifecycles, exactly as they behave in reality.
  status              text not null default 'pending'
    check (status in ('pending','confirmed','packed','shipped',
                      'delivered','cancelled','returned')),
  payment_status      text not null default 'pending'
    check (payment_status in ('pending','paid','cod','failed','refunded')),
  payment_method      text not null default 'prepaid'
    check (payment_method in ('prepaid','cod')),

  customer_id         uuid references public.customers (id) on delete set null,
  customer            jsonb not null,  -- snapshot: name, phone, email, address...

  currency            text not null default 'INR',
  subtotal_paise      integer not null check (subtotal_paise >= 0),
  shipping_paise      integer not null check (shipping_paise >= 0),
  discount_paise      integer not null default 0 check (discount_paise >= 0),
  total_paise         integer not null check (total_paise > 0),

  razorpay_order_id   text unique,
  razorpay_payment_id text,
  rzp_payment_detail  text,            -- upi / card / netbanking, from Razorpay

  stock_decremented   boolean not null default false,
  stock_short         boolean not null default false, -- paid but stock raced below zero

  courier             text,
  tracking_number     text,
  admin_note          text,
  failure_reason      text,

  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists orders_created_idx    on public.orders (created_at desc);
create index if not exists orders_status_idx     on public.orders (status, created_at desc);
create index if not exists orders_pay_status_idx on public.orders (payment_status, created_at desc);

create table if not exists public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  product_id       uuid references public.products (id) on delete set null,
  variant_id       uuid references public.product_variants (id) on delete set null,
  -- Snapshot at purchase time: future edits to the product change nothing here.
  sku              text not null,
  name             text not null,
  size             text not null,
  qty              integer not null check (qty > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  line_total_paise integer not null check (line_total_paise >= 0)
);

create index if not exists order_items_order_idx on public.order_items (order_id);

alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
-- Policies for these two are added after is_admin() exists (section 6).


-- ==========================================================================
-- 5. Payments (every gateway event we acted on, for reconciliation)
-- ==========================================================================

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid references public.orders (id) on delete set null,
  razorpay_order_id   text,
  razorpay_payment_id text unique,
  amount_paise        integer,
  method              text,
  status              text,           -- captured / failed / refunded
  source              text,           -- verify-payment / webhook
  raw                 jsonb,
  created_at          timestamptz not null default now()
);

alter table public.payments enable row level security;  -- service-role only


-- ==========================================================================
-- 6. Admin role machinery
-- ==========================================================================
--
-- Roles live in their own deny-all table, never on a profile the user can
-- edit. Only the service_role key (server-side) can read or write it.

create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'staff')),
  granted_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- security definer so it can read user_roles despite deny-all RLS.
-- search_path pinned so the function cannot be pointed at a fake table.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('admin', 'staff')
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Admin (and only admin) may READ orders from the browser. All writes go
-- through the Netlify functions — no insert/update/delete policy for anyone.
drop policy if exists "orders: admin reads all" on public.orders;
create policy "orders: admin reads all"
  on public.orders for select to authenticated
  using (public.is_admin());

drop policy if exists "order_items: admin reads all" on public.order_items;
create policy "order_items: admin reads all"
  on public.order_items for select to authenticated
  using (public.is_admin());


-- ==========================================================================
-- 7. Stock RPCs — atomicity lives here, in the database
-- ==========================================================================
--
-- Both take items as jsonb: [{"variantId": "...", "qty": 2}, ...]
--
-- decrement_stock(strict => true)  : all-or-nothing. If any line lacks
--   stock the whole call raises and NOTHING is decremented. Used for COD
--   orders (before confirming) and pre-payment checks.
--
-- decrement_stock(strict => false) : always decrements (can floor at 0 and
--   report shortfall). Used when a prepaid payment is already CAPTURED —
--   money has been taken, so the order must stand; a race that oversold is
--   flagged for the owner instead of failing the customer.

create or replace function public.decrement_stock(items jsonb, strict boolean)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  item       jsonb;
  v_id       uuid;
  v_qty      integer;
  updated    integer;
  short_list jsonb := '[]'::jsonb;
begin
  -- Lock the variants in a stable order to avoid deadlocks between
  -- concurrent orders touching the same sizes.
  for item in
    select value from jsonb_array_elements(items)
    order by value ->> 'variantId'
  loop
    v_id  := (item ->> 'variantId')::uuid;
    v_qty := (item ->> 'qty')::integer;

    if v_qty is null or v_qty < 1 then
      raise exception 'bad quantity for %', v_id;
    end if;

    update public.product_variants
       set stock_qty = stock_qty - v_qty, updated_at = now()
     where id = v_id and stock_qty >= v_qty;

    get diagnostics updated = row_count;

    if updated = 0 then
      if strict then
        raise exception 'OUT_OF_STOCK:%', v_id;  -- rolls back the whole call
      end if;

      -- Non-strict: take whatever is left, floor at zero, report the gap.
      update public.product_variants
         set stock_qty = greatest(stock_qty - v_qty, 0), updated_at = now()
       where id = v_id;

      short_list := short_list || jsonb_build_object('variantId', v_id);
    end if;
  end loop;

  return jsonb_build_object('short', short_list);
end;
$$;

revoke execute on function public.decrement_stock(jsonb, boolean) from public, anon, authenticated;

-- Puts an order's units back (cancelled COD order, refund, etc.).
create or replace function public.restock_items(items jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
begin
  for item in
    select value from jsonb_array_elements(items)
    order by value ->> 'variantId'
  loop
    update public.product_variants
       set stock_qty = stock_qty + (item ->> 'qty')::integer, updated_at = now()
     where id = (item ->> 'variantId')::uuid;
  end loop;
end;
$$;

revoke execute on function public.restock_items(jsonb) from public, anon, authenticated;


-- ==========================================================================
-- 8. Seed — the current drop, migrated from the static site
-- ==========================================================================

insert into public.products
  (sku, slug, number, category, name, colour, description, price_paise, image, alt)
values
  ('TD-KUR-001', 'gulabo-after-dark', '01', 'SHORT KURTI', 'Gulabo After Dark',
   'Rose milk',
   'A cropped kurti mood with dramatic cuffs, soft cotton and just enough main-character energy.',
   249000, 'images/hero-kurti.jpg', 'Gulabo After Dark ethnic fashion look'),
  ('TD-SAL-002', 'mehfil-but-make-it-chill', '02', 'FARSI SALWAR', 'Mehfil, But Make It Chill',
   'Pista dust',
   'An easy, fluid suit story inspired by the volume of a Farsi salwar—made for movement, not posing.',
   429000, 'images/farsi-salwar.jpg', 'Mehfil, But Make It Chill ethnic fashion look')
on conflict (sku) do nothing;

-- One variant per size. Starting stock is 10 each — set real numbers in the
-- admin dashboard (or here) before going live.
insert into public.product_variants (product_id, size, sku, stock_qty)
select p.id, s.size, p.sku || '-' || s.size, 10
from public.products p
cross join (values ('XS'),('S'),('M'),('L'),('XL')) as s(size)
on conflict (sku) do nothing;


-- ==========================================================================
-- 9. Making yourself the admin (run AFTER creating the user)
-- ==========================================================================
--
-- 1. Supabase dashboard → Authentication → Users → Add user
--    (email + password, tick "auto confirm").
-- 2. Then run, with your email:
--
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'you@example.com'
--   on conflict (user_id) do update set role = 'admin';
--
-- To list who has access:
--
--   select u.email, r.role from public.user_roles r
--   join auth.users u on u.id = r.user_id;
