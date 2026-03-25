import { createClient } from '@supabase/supabase-js';

function readEnv(name: string): string | undefined {
  const value = import.meta.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

const supabaseUrl = readEnv('SUPABASE_URL') ?? readEnv('PUBLIC_SUPABASE_URL');
const supabaseKey =
  readEnv('SUPABASE_SERVICE_ROLE_KEY') ??
  readEnv('SUPABASE_ANON_KEY') ??
  readEnv('PUBLIC_SUPABASE_ANON_KEY');

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL (or PUBLIC_SUPABASE_URL) environment variable.');
}

if (!supabaseKey) {
  throw new Error(
    'Missing Supabase key. Define SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, or PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
