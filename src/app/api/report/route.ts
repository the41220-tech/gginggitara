import { z } from "zod";
import { jsonNoStore } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidUUID } from "@/lib/validation";
import { requireParticipantSession } from "@/lib/participant-session";

const ReportRequestSchema = z.strictObject({
  match_id: z.string().refine(isValidUUID),
  type: z.enum(["noshow", "wrong_count", "bad_behavior", "other"]),
  description: z.string().trim().min(1).max(500)
    .refine((value) => !/[\u0000-\u001F\u007F]/.test(value))
    .nullable()
    .optional(),
});

type ReportRequest = z.infer<typeof ReportRequestSchema>;

function internalError() {
  return jsonNoStore({ error: "신고를 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 500);
}

export async function POST(request: Request) {
  const sessionId = await requireParticipantSession();
  if (!sessionId) return jsonNoStore({ error: "참여 세션이 필요합니다." }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonNoStore({ error: "요청 형식을 확인해주세요." }, 400);
    }
    return internalError();
  }

  const parsed = ReportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonNoStore({ error: "신고 정보를 확인해주세요." }, 400);
  }

  try {
    return await saveReport(parsed.data, sessionId);
  } catch (error) {
    if (error instanceof Error) return internalError();
    return internalError();
  }
}

async function saveReport(request: ReportRequest, sessionId: string) {
  const supabase = await createAdminClient();
  const { data: membership, error: membershipError } = await supabase
    .from("queue_entries")
    .select("id")
    .eq("match_id", request.match_id)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (membershipError) return internalError();
  if (membership === null) {
    return jsonNoStore({ error: "이 매칭의 멤버만 신고할 수 있습니다." }, 403);
  }

  const { data: existing, error: existingError } = await supabase
    .from("reports")
    .select("id")
    .eq("reporter_session_id", sessionId)
    .eq("match_id", request.match_id)
    .maybeSingle();
  if (existingError) return internalError();
  if (existing !== null) return jsonNoStore({ success: true, idempotent: true });

  const { error: insertError } = await supabase
    .from("reports")
    .insert({
      reporter_session_id: sessionId,
      match_id: request.match_id,
      type: request.type,
      description: request.description ?? null,
    });
  if (insertError?.code === "23505") {
    return jsonNoStore({ success: true, idempotent: true });
  }
  if (insertError) return internalError();
  return jsonNoStore({ success: true, idempotent: false }, 201);
}
