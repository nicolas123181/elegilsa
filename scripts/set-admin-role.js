#!/usr/bin/env node
/*
  scripts/set-admin-role.js

  Uso:
    SUPABASE_URL="https://<tu-proyecto>.supabase.co" \
    SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
    node scripts/set-admin-role.js admin@ejemplo.com

  El script usa la Admin API de Auth para buscar el usuario por email
  y aplicar `app_metadata.role` con el valor dado (por defecto: "admin").
  Requiere la SERVICE_ROLE_KEY del proyecto (no la anon key).
*/

import process from 'process';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  console.error('Exporta esas variables y vuelve a ejecutar.');
  process.exit(1);
}

const email = process.argv[2];
const role = process.argv[3] || 'admin';

if (!email) {
  console.error('Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/set-admin-role.js admin@ejemplo.com [role]');
  process.exit(1);
}

const adminBase = SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/admin';

async function findUserByEmail(email) {
  const url = `${adminBase}/users?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Listado de usuarios falló (${res.status}): ${body}`);
  }
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) return data[0];
  if (data?.users && Array.isArray(data.users) && data.users.length > 0) return data.users[0];
  return null;
}

async function updateUserMetadata(userId, role) {
  const url = `${adminBase}/users/${encodeURIComponent(userId)}`;
  const payload = { app_metadata: { role } };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
  if (!res.ok) {
    throw new Error(`Actualización falló (${res.status}): ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  return parsed;
}

(async () => {
  try {
    console.log(`Buscando usuario por email ${email}...`);
    const user = await findUserByEmail(email);
    if (!user) {
      console.error('Usuario no encontrado.');
      process.exit(2);
    }
    console.log(`Usuario encontrado: id=${user.id}, email=${user.email}`);
    const updated = await updateUserMetadata(user.id, role);
    console.log('Usuario actualizado:', JSON.stringify(updated, null, 2));
    console.log('Hecho. El usuario debe cerrar sesión y volver a iniciar sesión para que el JWT refleje el cambio.');
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
})();
