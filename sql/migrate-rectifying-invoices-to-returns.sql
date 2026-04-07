-- migrate-rectifying-invoices-to-returns.sql
--
-- Migración segura: crea/actualiza filas en `public.returns` a partir de facturas
-- rectificativas (`kind = 'rectifying'`) en `public.invoices`.
-- Instrucciones:
--  1) Ejecuta la sección PREVIEW para revisar qué facturas serán migradas.
--  2) (Opcional) Haz backup de `public.returns` (el script hace una copia si no existe).
--  3) Ejecuta la sección MIGRATE dentro de una transacción.
--  4) Ejecuta VERIFY para comprobar el resultado.
--
-- ADVERTENCIA: Ejecuta esto en el SQL Editor de Supabase con cuidado. No compartir
-- claves ni ejecutar en producción sin revisar los resultados del PREVIEW.

-- ------------------------------
-- PREVIEW: muestra facturas rectificativas con importe de reembolso > 0
-- ------------------------------
select
  i.id           as invoice_id,
  i.order_id,
  i.kind,
  coalesce(i.refund_cents, i.total_cents, 0) as refund_cents,
  i.created_at
from public.invoices i
join public.orders o on o.id = i.order_id
where i.kind = 'rectifying'
  and coalesce(i.refund_cents, i.total_cents, 0) > 0
order by i.created_at desc
limit 200;

-- ------------------------------
-- BACKUP: crea o añade a public.returns_backup
-- ------------------------------
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'returns_backup') then
    execute 'create table public.returns_backup as table public.returns with data';
  else
    execute 'insert into public.returns_backup select * from public.returns';
  end if;
end
$$;

-- ------------------------------
-- MIGRATE: insertar/actualizar returns desde invoices
-- ------------------------------
begin;

insert into public.returns (
  order_id,
  status,
  updated_at,
  refund_id,
  refund_amount_cents,
  refunded_at,
  refund_error,
  refund_payload
)
select
  i.order_id,
  'returned'::text,
  coalesce(i.created_at, now()),
  null::text,
  coalesce(i.refund_cents, i.total_cents, 0)::integer,
  coalesce(i.created_at, now()),
  null::text,
  jsonb_build_object('migrated_from_invoice_id', i.id, 'source', 'invoices', 'invoice_kind', i.kind)
from public.invoices i
join public.orders o on o.id = i.order_id
where i.kind = 'rectifying'
  and coalesce(i.refund_cents, i.total_cents, 0) > 0
on conflict (order_id) do update
set
  status = 'returned',
  updated_at = excluded.updated_at,
  refund_amount_cents = greatest(refund_amount_cents, excluded.refund_amount_cents),
  refunded_at = coalesce(refunded_at, excluded.refunded_at),
  refund_payload = coalesce(refund_payload, '{}'::jsonb) || excluded.refund_payload;

commit;

-- ------------------------------
-- VERIFY: comprueba las filas afectadas
-- ------------------------------
select r.order_id, r.status, r.refund_amount_cents, r.refunded_at, r.updated_at, r.refund_payload
from public.returns r
where r.order_id in (
  select i.order_id from public.invoices i where i.kind = 'rectifying'
)
order by r.updated_at desc
limit 200;

-- FIN
