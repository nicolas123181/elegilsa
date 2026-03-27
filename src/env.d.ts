/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly STRIPE_SECRET_KEY?: string;
	readonly PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
