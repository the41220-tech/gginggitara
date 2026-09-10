import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnvironment } from "./public-env";

export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnvironment();

  return createBrowserClient(url, anonKey);
}
