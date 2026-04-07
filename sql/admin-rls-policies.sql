-- Politicas RLS para permitir gestion del catalogo solo a admins.
-- Requiere que los usuarios admin tengan app_metadata.role = 'admin'.

-- Politicas RLS para permitir gestion del catalogo solo a admins.
-- Esta versión valida administradores por cualquiera de las siguientes condiciones:
--  1) El JWT incluye app_metadata.role = 'admin'
--  2) El email del JWT está presente en la tabla public.admin_emails
-- Esto facilita administrar permisos sin tener que editar tokens manualmente.

-- Tabla para gestionar correos de admin (editable desde SQL o desde el Dashboard)
create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz default now()
);

-- Inserta un ejemplo (ajusta o elimina según necesites)
insert into public.admin_emails (email) values ('admin@tudominio.com') on conflict do nothing;

-- Función que decide si el usuario actual es admin.
-- Comprueba el claim app_metadata.role = 'admin' y también la presencia del email en public.admin_emails.
create or replace function public.is_admin_user()
returns boolean
language sql
stable
as $$
  select coalesce(
    (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    )
    or exists (
      select 1 from public.admin_emails ae
      where lower(ae.email) = lower(auth.jwt() ->> 'email')
    ),
    false
  );
$$;

-- Funciones auxiliares para gestionar la lista de administradores desde SQL
create or replace function public.add_admin_email(p_email text)
returns void
language plpgsql
stable
as $$
begin
  if p_email is null then
    return;
  end if;
  insert into public.admin_emails(email) values (lower(p_email)) on conflict do nothing;
end;
$$;

create or replace function public.remove_admin_email(p_email text)
returns void
language plpgsql
stable
as $$
begin
  if p_email is null then
    return;
  end if;
  delete from public.admin_emails where lower(email) = lower(p_email);
end;
$$;

create or replace function public.list_admin_emails()
returns table(email text, created_at timestamptz)
language sql
stable
as $$
  select email, created_at from public.admin_emails order by created_at desc;
$$;

-- Habilitar RLS en las tablas relevantes
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.categories enable row level security;

-- Limpieza segura si ya existian politicas anteriores.
drop policy if exists admin_manage_products on public.products;
drop policy if exists admin_manage_product_variants on public.product_variants;
drop policy if exists admin_manage_product_images on public.product_images;
drop policy if exists admin_manage_categories on public.categories;

-- Políticas que permiten operaciones (SELECT, INSERT, UPDATE, DELETE) solo a administradores
create policy admin_manage_products
on public.products
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy admin_manage_product_variants
on public.product_variants
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy admin_manage_product_images
on public.product_images
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy admin_manage_categories
on public.categories
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Nota: UPDATE requiere SELECT; al usar 'for all' y la clausula USING estamos permitiendo
-- SELECT/UPDATE/DELETE para los roles autenticados que cumplan public.is_admin_user().
-- Tras ejecutar este script, asegúrate de que los admins cierren sesión y vuelvan a iniciar sesión
-- para que sus JWT reflejen cualquier cambio en app_metadata o para que la comprobación por email funcione.

