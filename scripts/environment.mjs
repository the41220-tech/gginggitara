function requireEnvironmentVariable(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requireHttpsUrl(name) {
  const value = requireEnvironmentVariable(name);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials, query, or fragment.`);
  }
  return url.toString().replace(/\/$/, "");
}

function requireDeclaredHost(name, url) {
  const expectedHost = requireEnvironmentVariable(name).toLowerCase();
  const actualHost = new URL(url).hostname.toLowerCase();
  if (expectedHost !== actualHost) {
    throw new Error(`${name} does not match the configured URL host.`);
  }
}

export function loadSupabaseServiceEnvironment() {
  return {
    supabaseUrl: requireEnvironmentVariable("SUPABASE_URL"),
    serviceRoleKey: requireEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function loadCleanupEnvironment() {
  const supabaseUrl = requireHttpsUrl("SUPABASE_URL");
  requireDeclaredHost("CLEANUP_SUPABASE_HOST", supabaseUrl);
  return { supabaseUrl, serviceRoleKey: requireEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY") };
}

export function loadLocalWriteEnvironment(confirmLocalWrite) {
  if (!confirmLocalWrite) {
    throw new Error("Refusing local writes without --confirm-local-write.");
  }
  if (process.env.TEST_TARGET_ENV?.trim().toLowerCase() !== "local") {
    throw new Error('Refusing local writes unless TEST_TARGET_ENV is exactly "local".');
  }

  const supabaseUrl = requireEnvironmentVariable("SUPABASE_URL");
  const baseUrl = requireEnvironmentVariable("TEST_BASE_URL");
  for (const [name, value] of [["SUPABASE_URL", supabaseUrl], ["TEST_BASE_URL", baseUrl]]) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be an absolute loopback HTTP(S) URL.`);
    }
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase())) {
      throw new Error(`${name} must target a loopback host.`);
    }
  }

  return { target: "local", supabaseUrl, baseUrl, serviceRoleKey: requireEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY") };
}

export function loadStagingWriteEnvironment(confirmStagingWrite) {
  if (!confirmStagingWrite) {
    throw new Error("Refusing staging writes without --confirm-staging-write.");
  }
  if (process.env.TEST_TARGET_ENV?.trim().toLowerCase() !== "staging") {
    throw new Error('Refusing writes unless TEST_TARGET_ENV is exactly "staging".');
  }
  const supabaseUrl = requireHttpsUrl("SUPABASE_URL");
  const baseUrl = requireHttpsUrl("TEST_BASE_URL");
  requireDeclaredHost("TEST_STAGING_SUPABASE_HOST", supabaseUrl);
  requireDeclaredHost("TEST_STAGING_APP_HOST", baseUrl);
  return { target: "staging", supabaseUrl, baseUrl, serviceRoleKey: requireEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY") };
}
