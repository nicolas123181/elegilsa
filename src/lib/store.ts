import type { AstroCookies } from 'astro';
import { supabase } from './supabase';
import { normalizeProductImages, resolveImageUrl } from './images';
import type { Cart, CartItemView, CartView, Category, Product, ProductImage, ProductVariant } from './types';

const CART_COOKIE = 'elegilsa_cart_token';
const SHOPIFY_PRODUCTS_URL = 'https://elegilsa.com/products.json?limit=250';
let shopifyImageMapPromise: Promise<Map<string, ProductImage[]>> | null = null;
let searchProductsPromise: Promise<SearchProduct[]> | null = null;

export type SearchProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category_slug: string | null;
  category_name: string | null;
  price_cents: number;
  image_url: string;
  search_blob: string;
};

function isSupabaseConnectivityError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? '').toLowerCase()
        : '';

  if (!message) return false;

  return (
    message.includes('fetch failed') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('timeout')
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function levenshteinDistance(a: string, b: string, maxDistance = 2): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;

  if (Math.abs(aLen - bLen) > maxDistance) return maxDistance + 1;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const prev = new Array<number>(bLen + 1);
  const curr = new Array<number>(bLen + 1);

  for (let j = 0; j <= bLen; j += 1) prev[j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];

    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= bLen; j += 1) prev[j] = curr[j];
  }

  return prev[bLen];
}

function scoreProductSearchMatch(product: Product, query: string): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const name = normalizeSearchText(product.name);
  const description = normalizeSearchText(product.description ?? '');
  const variantBlob = normalizeSearchText(
    product.product_variants
      .map((variant) => [variant.name, variant.size_label, variant.color_name].filter(Boolean).join(' '))
      .join(' ')
  );
  const haystack = [name, description, variantBlob].filter(Boolean).join(' ');
  const queryTokens = tokenizeSearchText(normalizedQuery);
  const nameTokens = tokenizeSearchText(name);
  const hayTokens = tokenizeSearchText(haystack);

  let score = 0;

  if (name === normalizedQuery) score += 250;
  if (name.startsWith(normalizedQuery)) score += 140;
  if (name.includes(normalizedQuery)) score += 100;
  if (haystack.includes(normalizedQuery)) score += 70;

  let matchedTokens = 0;
  for (const token of queryTokens) {
    if (nameTokens.some((nameToken) => nameToken.startsWith(token))) {
      score += 40;
      matchedTokens += 1;
      continue;
    }

    if (hayTokens.includes(token)) {
      score += 20;
      matchedTokens += 1;
      continue;
    }

    const closeMatch = nameTokens.find((nameToken) => levenshteinDistance(nameToken, token, 1) <= 1);
    if (closeMatch) {
      score += 12;
      matchedTokens += 1;
    }
  }

  if (queryTokens.length > 0 && matchedTokens === queryTokens.length) {
    score += 35;
  }

  return score;
}

export function persistCartToken(cookies: AstroCookies, token: string) {
  cookies.set(CART_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    maxAge: 60 * 60 * 24 * 30,
  });
}

function sortImages(images: ProductImage[] | null | undefined): ProductImage[] {
  return normalizeProductImages(images);
}

function sortVariants(variants: ProductVariant[] | null | undefined): ProductVariant[] {
  return [...(variants ?? [])].sort((a, b) => a.position - b.position);
}

function normalizeProduct(row: any): Product {
  return {
    ...row,
    product_images: sortImages(row.product_images),
    product_variants: sortVariants(row.product_variants),
  };
}

async function getShopifyImageMap(): Promise<Map<string, ProductImage[]>> {
  if (!shopifyImageMapPromise) {
    shopifyImageMapPromise = (async () => {
      const response = await fetch(SHOPIFY_PRODUCTS_URL, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch Shopify catalog: ${response.status}`);
      }

      const payload = (await response.json()) as {
        products?: Array<{
          handle?: string;
          images?: Array<{ src?: string; alt?: string | null }>;
        }>;
      };

      const map = new Map<string, ProductImage[]>();

      for (const product of payload.products ?? []) {
        const handle = typeof product.handle === 'string' ? product.handle.trim() : '';
        if (!handle) continue;

        const images = (product.images ?? [])
          .map((image, index) => {
            const url = typeof image.src === 'string' ? image.src.trim() : '';
            if (!url) return null;

            return {
              id: 10_000_000 + index,
              url,
              alt_text: typeof image.alt === 'string' ? image.alt : null,
              position: index + 1,
            } as ProductImage;
          })
          .filter((image): image is ProductImage => image !== null);

        if (images.length > 0) {
          map.set(handle, images);
        }
      }

      return map;
    })().catch((error) => {
      shopifyImageMapPromise = null;
      throw error;
    });
  }

  return shopifyImageMapPromise;
}

async function withShopifyImageFallback(products: Product[]): Promise<Product[]> {
  try {
    const imageMap = await getShopifyImageMap();
    return products.map((product) => {
      if (Array.isArray(product.product_images) && product.product_images.length > 0) {
        return product;
      }

      const fallbackImages = imageMap.get(product.slug) ?? [];
      if (fallbackImages.length === 0) return product;

      return {
        ...product,
        product_images: fallbackImages,
      };
    });
  } catch {
    return products;
  }
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(
        'id,category_id,slug,name,description,price_cents,compare_at_cents,featured,is_active,created_at,product_images(id,url,alt_text,position),product_variants(*)'
      )
      .eq('is_active', true)
      .order('featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const products = (data ?? []).map(normalizeProduct);
    return withShopifyImageFallback(products);
  } catch (error) {
    if (isSupabaseConnectivityError(error)) return [];
    throw error;
  }
}

export async function getSearchProducts(): Promise<SearchProduct[]> {
  if (!searchProductsPromise) {
    searchProductsPromise = (async () => {
      const [{ data: categories, error: categoriesError }, { data: productRows, error: productsError }] = await Promise.all([
        supabase.from('categories').select('id,slug,name'),
        supabase
          .from('products')
          .select(
            'id,category_id,slug,name,description,price_cents,compare_at_cents,featured,is_active,created_at,product_images(id,url,alt_text,position),product_variants(*)'
          )
          .eq('is_active', true)
          .order('featured', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(250),
      ]);

      if (categoriesError) throw categoriesError;
      if (productsError) throw productsError;

      const categoryById = new Map<number, { slug: string; name: string }>();
      for (const category of categories ?? []) {
        const id = Number((category as any).id);
        const slug = typeof (category as any).slug === 'string' ? (category as any).slug : '';
        const name = typeof (category as any).name === 'string' ? (category as any).name : '';
        if (!Number.isFinite(id) || !slug) continue;
        categoryById.set(id, { slug, name });
      }

      const products = await withShopifyImageFallback((productRows ?? []).map(normalizeProduct));

      return products.map((product) => {
        const category = categoryById.get(Number(product.category_id));
        const imageUrl = resolveImageUrl(product.product_images?.[0]?.url);
        const variantBlob = product.product_variants
          .map((variant) => [variant.name, variant.size_label, variant.color_name].filter(Boolean).join(' '))
          .join(' ');

        return {
          id: product.id,
          slug: product.slug,
          name: product.name,
          description: product.description ?? '',
          category_slug: category?.slug ?? null,
          category_name: category?.name ?? null,
          price_cents: product.price_cents,
          image_url: imageUrl,
          search_blob: [product.name, product.description ?? '', category?.name ?? '', variantBlob]
            .filter(Boolean)
            .join(' '),
        } satisfies SearchProduct;
      });
    })().catch((error) => {
      searchProductsPromise = null;
      throw error;
    });
  }

  return searchProductsPromise;
}

export type ProductListParams = {
  page?: number;
  pageSize?: number;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  inStockOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  categorySlug?: string;
};

export async function getNavigationCategories(): Promise<Category[]> {
  try {
    const { data: categories, error: categoriesError } = await supabase
      .from('categories')
      .select('id,slug,name,description,created_at')
      .order('name', { ascending: true });

    if (categoriesError) throw categoriesError;

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('category_id')
      .eq('is_active', true);

    if (productsError) throw productsError;

    const counts = new Map<number, number>();
    for (const row of products ?? []) {
      const categoryId = Number((row as any).category_id);
      if (!Number.isFinite(categoryId)) continue;
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }

    return (categories ?? [])
      .map((category: any) => ({
        ...category,
        product_count: counts.get(Number(category.id)) ?? 0,
      }))
      .filter((category) => (category.product_count ?? 0) > 0);
  } catch (error) {
    if (isSupabaseConnectivityError(error)) return [];
    throw error;
  }
}

export async function getAllProducts(params: ProductListParams = {}) {
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? 16, 1), 50);

  let products: Product[] = [];
  try {
    const { data, error } = await supabase
      .from('products')
      .select(
        'id,category_id,slug,name,description,price_cents,compare_at_cents,featured,is_active,created_at,product_images(id,url,alt_text,position),product_variants(*)',
        { count: 'exact' }
      )
      .eq('is_active', true);

    if (error) throw error;
    products = (data ?? []).map(normalizeProduct);
  } catch (error) {
    if (!isSupabaseConnectivityError(error)) {
      throw error;
    }
  }

  products = await withShopifyImageFallback(products);

  if (params.inStockOnly) {
    products = products.filter((p) => {
      if (p.product_variants.length === 0) return true;
      return p.product_variants.some((v) => v.is_active && v.stock > 0);
    });
  }

  if (typeof params.minPrice === 'number') {
    products = products.filter((p) => p.price_cents >= params.minPrice!);
  }

  if (typeof params.maxPrice === 'number') {
    products = products.filter((p) => p.price_cents <= params.maxPrice!);
  }

  const hasQuery = Boolean(params.q && params.q.trim().length > 0);
  if (hasQuery) {
    const q = params.q!.trim();
    const scored = products
      .map((product) => ({ product, score: scoreProductSearchMatch(product, q) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || +new Date(b.product.created_at) - +new Date(a.product.created_at));

    products = scored.map((entry) => entry.product);
  }

  if (params.categorySlug && params.categorySlug.trim().length > 0) {
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', params.categorySlug.trim())
      .maybeSingle();

    if (categoryError) throw categoryError;

    if (!category) {
      products = [];
    } else {
      const categoryId = Number((category as any).id);
      products = products.filter((product) => Number(product.category_id) === categoryId);
    }
  }

  switch (params.sort) {
    case 'price_asc':
      products.sort((a, b) => a.price_cents - b.price_cents);
      break;
    case 'price_desc':
      products.sort((a, b) => b.price_cents - a.price_cents);
      break;
    case 'newest':
    default:
      if (!hasQuery) {
        products.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      }
      break;
  }

  const total = products.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const start = (page - 1) * pageSize;
  const paged = products.slice(start, start + pageSize);

  return {
    products: paged,
    total,
    totalPages,
    page,
    pageSize,
  };
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select(
      'id,category_id,slug,name,description,price_cents,compare_at_cents,featured,is_active,created_at,product_images(id,url,alt_text,position),product_variants(*)'
    )
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const [product] = await withShopifyImageFallback([normalizeProduct(data)]);
  return product;
}

export async function getAllProductSlugs(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('slug')
      .eq('is_active', true);

    if (error) throw error;

    return (data ?? [])
      .map((row: any) => (typeof row.slug === 'string' ? row.slug.trim() : ''))
      .filter((slug) => slug.length > 0);
  } catch (error) {
    if (isSupabaseConnectivityError(error)) return [];
    throw error;
  }
}

export async function getOrCreateCart(cookies: AstroCookies): Promise<Cart> {
  const existingToken = cookies.get(CART_COOKIE)?.value ?? null;
  const safeToken = existingToken && isUuid(existingToken) ? existingToken : null;

  const { data, error } = await supabase.rpc('get_or_create_cart', {
    p_cart_token: safeToken,
  });

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Failed to initialize cart.');
  }

  const row = data[0];
  persistCartToken(cookies, row.token);

  return row as Cart;
}

export async function getCartView(cookies: AstroCookies): Promise<CartView> {
  const cart = await getOrCreateCart(cookies);

  const { data: itemRows, error: itemsError } = await supabase.rpc('get_cart_items', {
    p_cart_token: cart.token,
  });

  if (itemsError) throw itemsError;

  const items = itemRows ?? [];

  if (items.length === 0) {
    return {
      cart,
      items: [],
      subtotal_cents: 0,
      total_items: 0,
    };
  }

  const viewItems: CartItemView[] = items
    .map((item: any) => {
      return {
        id: item.item_id,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        product: {
          id: item.product_id,
          slug: item.product_slug,
          name: item.product_name,
          price_cents: item.product_price_cents,
          image_url: item.image_url,
        },
        variant: item.variant_id
          ? {
              id: item.variant_id,
              name: item.variant_name,
              color_name: item.color_name,
              color_hex: item.color_hex,
              size_label: item.size_label,
              stock: typeof item.variant_stock === 'number' ? item.variant_stock : null,
            }
          : null,
        line_total_cents: item.quantity * item.unit_price_cents,
      };
    });

  const subtotal_cents = viewItems.reduce((acc, item) => acc + item.line_total_cents, 0);
  const total_items = viewItems.reduce((acc, item) => acc + item.quantity, 0);

  return {
    cart,
    items: viewItems,
    subtotal_cents,
    total_items,
  };
}

export function getCartTokenFromCookies(cookies: AstroCookies): string | null {
  const token = cookies.get(CART_COOKIE)?.value ?? null;
  return token && isUuid(token) ? token : null;
}
