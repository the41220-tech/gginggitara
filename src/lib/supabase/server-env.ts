import "server-only";

import { getPublicSupabaseEnvironment } from "./public-env";

export type ServerSupabaseEnvironment = Readonly<{
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}>;

export function getServerSupabaseEnvironment(): ServerSupabaseEnvironment {
  const { url, anonKey } = getPublicSupabaseEnvironment();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return { url, anonKey, serviceRoleKey };
}
