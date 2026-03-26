import type { ProductImage } from './types';

const DEFAULT_PLACEHOLDER = '/catalogo/placeholder.svg';

function readPublicEnv(name: string): string | undefined {
  const value = import.meta.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export const PRODUCT_IMAGES_BUCKET = readPublicEnv('PUBLIC_SUPABASE_PRODUCT_IMAGES_BUCKET') ?? 'product-images';

const CONFIGURED_PUBLIC_BASE_URL = readPublicEnv('PUBLIC_SUPABASE_PRODUCT_IMAGES_BASE_URL');
const SUPABASE_PUBLIC_URL = readPublicEnv('PUBLIC_SUPABASE_URL');

export function getProductImagesPublicBaseUrl(): string {
  if (CONFIGURED_PUBLIC_BASE_URL) {
    return CONFIGURED_PUBLIC_BASE_URL.replace(/\/+$/, '');
  }

  if (SUPABASE_PUBLIC_URL) {
    return `${SUPABASE_PUBLIC_URL.replace(/\/+$/, '')}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}`;
  }

  return '';
}

export function toStorageReference(rawUrl: string | null | undefined): string {
  const value = String(rawUrl || '').trim();
  if (!value) return '';

  const baseUrl = getProductImagesPublicBaseUrl();
  if (baseUrl && value.startsWith(`${baseUrl}/`)) {
    return `${PRODUCT_IMAGES_BUCKET}/${value.slice(baseUrl.length + 1)}`;
  }

  if (value.includes(`/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`)) {
    return `${PRODUCT_IMAGES_BUCKET}/${value.split(`/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`)[1] || ''}`.replace(/\/+$/, '');
  }

  if (value.startsWith(`${PRODUCT_IMAGES_BUCKET}/`)) {
    return value;
  }

  return value;
}

export function resolveImageUrl(rawUrl: string | null | undefined, placeholder = DEFAULT_PLACEHOLDER): string {
  const value = String(rawUrl || '').trim();
  if (!value) return placeholder;

  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:image/') ||
    value.startsWith('blob:')
  ) {
    return value;
  }

  if (value.startsWith('//')) {
    return `https:${value}`;
  }

  if (value.startsWith('/catalogo/') || value.startsWith('/')) {
    return value;
  }

  const storageReference = toStorageReference(value);
  if (storageReference.startsWith(`${PRODUCT_IMAGES_BUCKET}/`)) {
    const baseUrl = getProductImagesPublicBaseUrl();
    if (!baseUrl) return `/${storageReference}`;
    return `${baseUrl}/${storageReference.slice(PRODUCT_IMAGES_BUCKET.length + 1)}`;
  }

  if (storageReference.startsWith('storage/v1/object/public/')) {
    if (!SUPABASE_PUBLIC_URL) return `/${storageReference}`;
    return `${SUPABASE_PUBLIC_URL.replace(/\/+$/, '')}/${storageReference}`;
  }

  return value.startsWith('/') ? value : `/${value}`;
}

export function normalizeProductImages(images: ProductImage[] | null | undefined): ProductImage[] {
  return [...(images ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((image) => ({
      ...image,
      url: resolveImageUrl(image.url),
    }));
}
