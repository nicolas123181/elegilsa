-- Esquema de devoluciones con trazabilidad de reembolso Stripe.
-- Ejecutar en Supabase SQL Editor sobre el proyecto conectado.

create table if not exists public.returns (
  order_id text primary key references public.orders(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'returned', 'rejected')),
  updated_at timestamptz not null default now(),
  refund_id text unique,
  refund_amount_cents integer not null default 0 check (refund_amount_cents >= 0),
  refunded_at timestamptz,
  refund_error text,
  refund_payload jsonb
);

create index if not exists idx_returns_status on public.returns(status);
create index if not exists idx_returns_updated_at on public.returns(updated_at desc);

alter table public.invoices
  add column if not exists kind text not null default 'standard'
    check (kind in ('standard', 'rectifying')),
  add column if not exists refund_cents integer not null default 0
    check (refund_cents >= 0),
  add column if not exists shipping_non_refunded_cents integer not null default 0
    check (shipping_non_refunded_cents >= 0),
  add column if not exists original_invoice_id text references public.invoices(id) on delete set null;

create index if not exists idx_invoices_kind on public.invoices(kind);
create index if not exists idx_invoices_order_kind on public.invoices(order_id, kind);
