import "server-only";

import type { User } from "@supabase/supabase-js";
import { resolveAdminEmailAllowlist } from "@/lib/request-auth";
import { createClient } from "@/lib/supabase/server";

export class AdminAuthorizationError extends Error {
  readonly name = "AdminAuthorizationError";
}

export async function requireAdminUser(): Promise<User> {
  const adminEmails = resolveAdminEmailAllowlist(
    process.env.ADMIN_EMAILS,
    process.env.DEV_ADMIN_EMAILS,
    process.env.NODE_ENV,
  );

  if (adminEmails.size === 0) {
    throw new AdminAuthorizationError("No administrator email allowlist configured");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (
    error
    || !user?.email
    || !user.email_confirmed_at
    || !adminEmails.has(user.email.trim().toLowerCase())
  ) {
    throw new AdminAuthorizationError("Administrator authorization required");
  }

  return user;
}
