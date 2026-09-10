import { createAdminClient } from "./supabase/server";

/**
 * Check if a session is currently blocked by the penalty system.
 */
export async function isSessionBlocked(session_id: string): Promise<{ blocked: boolean; blockedUntil?: string; noshowCount?: number }> {
  const supabase = await createAdminClient();

  // 1. Check blocked_sessions table
  const { data: blockedEntry } = await supabase
    .from("blocked_sessions")
    .select("blocked_until")
    .eq("session_id", session_id)
    .gt("blocked_until", new Date().toISOString())
    .single();

  if (blockedEntry) {
    return { blocked: true, blockedUntil: blockedEntry.blocked_until };
  }

  // 2. Check for recent no-shows and cooldowns from queue_entries
  const { data: latestEntry } = await supabase
    .from("queue_entries")
    .select("noshow_count, created_at, status")
    .eq("session_id", session_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const noshowCount = latestEntry?.noshow_count || 0;

  if (latestEntry?.status === 'noshow' && noshowCount >= 2) {
    // 2nd no-show: 5-minute cooldown check
    const cooldownEnd = new Date(latestEntry.created_at);
    cooldownEnd.setMinutes(cooldownEnd.getMinutes() + 5);
    
    if (cooldownEnd > new Date()) {
        return { blocked: true, blockedUntil: cooldownEnd.toISOString(), noshowCount };
    }
  }

  return { blocked: false, noshowCount };
}
