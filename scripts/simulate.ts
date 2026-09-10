import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"] as const;
const WRITE_CONFIRMATION_ENV = "SIMULATE_CONFIRM_LOCAL_WRITE";
const WRITE_CONFIRMATION_VALUE = "LOCAL_DATABASE_WRITE";
const commandSchema = z.enum(["add", "clear"]);
const addArgumentsSchema = z.object({
  pickupSpotId: z.string().uuid(),
  dropZoneId: z.string().uuid(),
  count: z.coerce.number().int().min(1).max(30),
});

type Command = z.infer<typeof commandSchema>;
type AddArguments = z.infer<typeof addArgumentsSchema>;

class UnsafeSimulationTargetError extends Error {
  readonly name = "UnsafeSimulationTargetError";

  constructor(message: string) {
    super(message);
  }
}

function usage(): void {
  console.log(`Usage:
  npx tsx scripts/simulate.ts add <pickup-uuid> <drop-zone-uuid> [count] --confirm-local-write
  npx tsx scripts/simulate.ts clear --confirm-local-write

Safety:
  This script writes directly to Supabase and only permits loopback URLs.
  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Confirm a local
  write with --confirm-local-write or ${WRITE_CONFIRMATION_ENV}=${WRITE_CONFIRMATION_VALUE}.
  Public, staging, and production URLs are always rejected.`);
}

function requireEnvironmentVariable(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new UnsafeSimulationTargetError(`Missing required environment variable: ${name}`);
  return value;
}

function requireLoopbackSupabaseUrl(rawUrl: string): string {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new UnsafeSimulationTargetError("SUPABASE_URL must be an absolute loopback HTTP(S) URL.");
  }
  const host = target.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.some((candidate) => candidate === host);
  if (!['http:', 'https:'].includes(target.protocol) || !isLoopback) {
    throw new UnsafeSimulationTargetError("Refusing non-loopback SUPABASE_URL. This script never writes to a public target.");
  }
  return target.toString();
}

function isWriteConfirmed(): boolean {
  return process.argv.includes("--confirm-local-write") || process.env[WRITE_CONFIRMATION_ENV] === WRITE_CONFIRMATION_VALUE;
}

function parseCommand(): Command | null {
  const parsed = commandSchema.safeParse(process.argv[2]);
  return parsed.success ? parsed.data : null;
}

function parseAddArguments(): AddArguments {
  const parsed = addArgumentsSchema.safeParse({
    pickupSpotId: process.argv[3],
    dropZoneId: process.argv[4],
    count: process.argv[5] ?? "2",
  });
  if (!parsed.success) {
    throw new UnsafeSimulationTargetError("add requires valid pickup/drop UUIDs and a count from 1 to 30.");
  }
  return parsed.data;
}

function createLocalSupabaseClient() {
  return createClient(
    requireLoopbackSupabaseUrl(requireEnvironmentVariable("SUPABASE_URL")),
    requireEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

async function addLocalEntries(command: AddArguments): Promise<void> {
  const supabase = createLocalSupabaseClient();
  const inserted = await Promise.all(
    Array.from({ length: command.count }, () => {
      const now = new Date();
      return supabase.from("queue_entries").insert({
        session_id: randomUUID(),
        nickname: "local-simulation",
        party_size: 1,
        pickup_spot_id: command.pickupSpotId,
        drop_zone_id: command.dropZoneId,
        departure_mode: "fast",
        status: "waiting",
        priority_at: now.toISOString(),
        queue_deadline_at: new Date(now.getTime() + 3 * 60 * 1_000).toISOString(),
      });
    }),
  );
  const failures = inserted.flatMap((result) => result.error ? [result.error.message] : []);
  if (failures.length > 0) throw new Error(`Local simulation add failed: ${failures.join("; ")}`);
  console.log(`Added ${command.count} local queue entr${command.count === 1 ? "y" : "ies"}.`);
}

async function clearLocalData(): Promise<void> {
  const supabase = createLocalSupabaseClient();
  const sentinelId = "00000000-0000-0000-0000-000000000000";
  const queueDeletion = await supabase.from("queue_entries").delete().neq("id", sentinelId);
  if (queueDeletion.error) throw new Error(`Local queue cleanup failed: ${queueDeletion.error.message}`);
  const matchDeletion = await supabase.from("matches").delete().neq("id", sentinelId);
  if (matchDeletion.error) throw new Error(`Local match cleanup failed: ${matchDeletion.error.message}`);
  console.log("Cleared local queue and match data.");
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }
  const command = parseCommand();
  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }
  if (!isWriteConfirmed()) {
    throw new UnsafeSimulationTargetError(
      `Refusing to write. Add --confirm-local-write or set ${WRITE_CONFIRMATION_ENV}=${WRITE_CONFIRMATION_VALUE}.`,
    );
  }
  if (command === "clear") {
    await clearLocalData();
    return;
  }
  await addLocalEntries(parseAddArguments());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local simulation failed.");
  process.exitCode = 1;
});
