import { createAdminClient } from "@/lib/supabase/server";

export type MatchingRunResult = {
  readonly offers_created: number;
  readonly server_now: string;
};

export class MatchingEngineError extends Error {
  readonly databaseMessage: string;

  constructor(databaseMessage: string) {
    super("The matching engine transaction failed");
    this.name = "MatchingEngineError";
    this.databaseMessage = databaseMessage;
  }
}

function parseMatchingRunResult(value: unknown): MatchingRunResult {
  if (
    typeof value !== "object"
    || value === null
    || !("offers_created" in value)
    || !("server_now" in value)
    || typeof value.offers_created !== "number"
    || typeof value.server_now !== "string"
  ) {
    throw new MatchingEngineError("run_matching_engine returned an invalid payload");
  }
  return { offers_created: value.offers_created, server_now: value.server_now };
}

export async function triggerAllMatches(): Promise<MatchingRunResult> {
  const supabase = await createAdminClient();
  const { data, error } = await supabase.rpc("run_matching_engine");
  if (error) throw new MatchingEngineError(error.message);
  return parseMatchingRunResult(data);
}

export async function cleanupAndReMatch(): Promise<MatchingRunResult> {
  return triggerAllMatches();
}
