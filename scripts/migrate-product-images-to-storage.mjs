import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const cwd = process.cwd();
const envPath = path.join(cwd, '.env');

function parseEnv(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const envContent = await fs.readFile(envPath, 'utf8');
const env = parseEnv(envContent);

const supabaseUrl = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = env.PUBLIC_SUPABASE_PRODUCT_IMAGES_BUCKET || 'product-images';
const explicitBaseUrl = (env.PUBLIC_SUPABASE_PRODUCT_IMAGES_BASE_URL || '').trim();
const baseUrl = explicitBaseUrl || `${String(supabaseUrl || '').replace(/\/+$/, '')}/storage/v1/object/public/${bucket}`;

if (!supabaseUrl) {
  throw new Error('Falta SUPABASE_URL o PUBLIC_SUPABASE_URL en .env.');
}

if (!serviceRoleKey) {
  throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en .env para migrar a Storage.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function normalizeExt(name, type = '') {
  const fromName = String(name || '').split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,6}$/.test(fromName)) return fromName;
  const fromType = String(type || '').split('/').pop()?.toLowerCase();
  if (fromType === 'jpeg') return 'jpg';
  if (fromType && /^[a-z0-9]{2,6}$/.test(fromType)) return fromType;
  return 'jpg';
}

function toStorageReference(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  if (baseUrl && value.startsWith(`${baseUrl}/`)) {
    return `${bucket}/${value.slice(baseUrl.length + 1)}`;
  }

  if (value.includes(`/storage/v1/object/public/${bucket}/`)) {
    const [, storagePath = ''] = value.split(`/storage/v1/object/public/${bucket}/`);
    return storagePath ? `${bucket}/${storagePath}` : '';
  }

  if (value.startsWith(`${bucket}/`)) {
    return value;
  }

  return value;
}

function isStorageHostedImage(rawValue) {
  const value = toStorageReference(rawValue);
  return value.startsWith(`${bucket}/`) || value.includes(`/storage/v1/object/public/${bucket}/`);
}

const shopifyMap = new Map();

async function loadShopifyFallbackMap() {
  if (shopifyMap.size > 0) return shopifyMap;
  const response = await fetch('https://elegilsa.com/products.json?limit=250', {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`No se pudo leer Shopify fallback (${response.status}).`);
  }

  const payload = await response.json();
  for (const product of payload?.products ?? []) {
    const slug = String(product?.handle || '').trim();
    if (!slug) continue;

    const urls = Array.isArray(product?.images)
      ? product.images.map((image) => String(image?.src || '').trim()).filter(Boolean)
      : [];

    if (urls.length > 0) {
      shopifyMap.set(slug, urls);
    }
  }

  return shopifyMap;
}

function resolveCatalogFallbackUrl(rawValue, slug = '') {
  const value = String(rawValue || '').trim();
  if (!value.startsWith('/catalogo/')) return '';

  const normalized = value.replace(/^\/+/, '');
  const parts = normalized.split('/');
  const effectiveSlug = slug || (parts.length >= 3 && parts[0] === 'catalogo' ? String(parts[1] || '').trim() : '');
  if (!effectiveSlug) return '';

  const urls = shopifyMap.get(effectiveSlug) || [];
  if (urls.length === 0) return '';

  const fileName = parts.length >= 3 ? parts[2] : '';
  const indexMatch = fileName.match(/(\d+)/);
  const imageIndex = Math.max(0, Number(indexMatch?.[1] || 1) - 1);
  return urls[imageIndex] || urls[0] || '';
}

async function fetchImageBlob(sourceUrl) {
  const response = await fetch(sourceUrl, { headers: { Accept: 'image/*,*/*;q=0.8' } });
  if (!response.ok) {
    throw new Error(`No se pudo descargar ${sourceUrl} (${response.status}).`);
  }

  const blob = await response.blob();
  if (!String(blob.type || '').startsWith('image/')) {
    throw new Error(`El recurso no es una imagen valida: ${sourceUrl}`);
  }

  return blob;
}

const { data: productRows, error: productError } = await supabase.from('products').select('id,slug');
if (productError) {
  throw new Error(`No se pudieron leer productos: ${productError.message}`);
}

const slugByProductId = new Map((productRows || []).map((row) => [String(row.id), String(row.slug || '').trim()]));

const { data: imageRows, error: imageError } = await supabase
  .from('product_images')
  .select('id,product_id,url')
  .order('id', { ascending: true });

if (imageError) {
  throw new Error(`No se pudieron leer imagenes: ${imageError.message}`);
}

await loadShopifyFallbackMap();

let migrated = 0;
let normalized = 0;
let skipped = 0;
let failed = 0;

for (const row of imageRows || []) {
  const imageId = String(row.id || '').trim();
  const productId = String(row.product_id || '').trim();
  const currentUrl = String(row.url || '').trim();
  if (!imageId || !currentUrl) {
    skipped += 1;
    continue;
  }

  const currentReference = toStorageReference(currentUrl);
  if (currentReference.startsWith(`${bucket}/`)) {
    if (currentReference !== currentUrl) {
      const { error } = await supabase.from('product_images').update({ url: currentReference }).eq('id', imageId);
      if (error) {
        failed += 1;
      } else {
        normalized += 1;
      }
    } else {
      skipped += 1;
    }
    continue;
  }

  try {
    const slug = slugByProductId.get(productId) || '';
    const sourceUrl = currentUrl.startsWith('/catalogo/') ? resolveCatalogFallbackUrl(currentUrl, slug) : currentUrl;
    if (!sourceUrl) {
      failed += 1;
      continue;
    }

    const blob = await fetchImageBlob(sourceUrl);
    const ext = normalizeExt(sourceUrl, blob.type);
    const filePath = `${productId || 'product'}/${Date.now()}-${imageId}.${ext}`;
    const arrayBuffer = await blob.arrayBuffer();

    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, arrayBuffer, {
      cacheControl: '31536000',
      upsert: false,
      contentType: blob.type || 'image/jpeg',
    });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const storageReference = `${bucket}/${filePath}`;
    const { error: updateError } = await supabase.from('product_images').update({ url: storageReference }).eq('id', imageId);
    if (updateError) {
      throw new Error(updateError.message);
    }

    migrated += 1;
  } catch (error) {
    failed += 1;
    console.error(`Fallo migrando image_id=${imageId}:`, error instanceof Error ? error.message : error);
  }
}

console.log(
  JSON.stringify(
    {
      bucket,
      baseUrl,
      migrated,
      normalized,
      skipped,
      failed,
    },
    null,
    2
  )
);
