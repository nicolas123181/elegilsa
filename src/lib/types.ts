export type ProductImage = {
  id: number;
  url: string;
  alt_text: string | null;
  position: number;
};

export type ProductVariant = {
  id: string;
  product_id: string;
  name: string;
  color_name: string | null;
  color_hex: string | null;
  size_label: string | null;
  price_cents: number | null;
  stock: number;
  is_active: boolean;
  position: number;
};

export type Product = {
  id: string;
  category_id: number | null;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  compare_at_cents: number | null;
  featured: boolean;
  is_active: boolean;
  created_at: string;
  product_images: ProductImage[];
  product_variants: ProductVariant[];
};

export type Category = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  product_count?: number;
};

export type Cart = {
  id: string;
  token: string;
  status: 'active' | 'checked_out' | 'abandoned';
  created_at: string;
  updated_at: string;
};

export type CartItemRow = {
  id: string;
  cart_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price_cents: number;
  created_at: string;
  updated_at: string;
};

export type CartItemView = {
  id: string;
  quantity: number;
  unit_price_cents: number;
  product: {
    id: string;
    slug: string;
    name: string;
    price_cents: number;
    image_url: string | null;
  };
  variant: {
    id: string;
    name: string;
    color_name: string | null;
    color_hex: string | null;
    size_label: string | null;
    stock: number | null;
  } | null;
  line_total_cents: number;
};

export type CustomerProfile = {
  email: string;
  full_name: string | null;
  phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  notes: string | null;
};

export type CartView = {
  cart: Cart;
  items: CartItemView[];
  subtotal_cents: number;
  total_items: number;
};
