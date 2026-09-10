import { z } from "zod";
import { AdminAuthorizationError, requireAdminUser } from "@/lib/admin-auth";
import { jsonNoStore } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const metricsSchema = z.object({
  funnel: z.array(z.object({
    event_name: z.string(),
    events: z.number().int().nonnegative(),
    unique_sessions: z.number().int().nonnegative(),
  })),
  matching: z.object({
    total_matches: z.number().int().nonnegative(),
    total_people: z.number().int().nonnegative(),
    status_counts: z.array(z.object({
      status: z.string(),
      matches: z.number().int().nonnegative(),
    })),
    health: z.object({
      departed_matches: z.number().int().nonnegative(),
      resolved_matches: z.number().int().nonnegative(),
      offered_entries: z.number().int().nonnegative(),
      accepted_offer_entries: z.number().int().nonnegative(),
      median_match_wait_seconds: z.number().int().nonnegative().nullable(),
    }),
  }),
});

type MetricsRange = Readonly<{
  start: string;
  end: string;
}>;

function kstDayStart(day: string): Date | null {
  const parsed = dateSchema.safeParse(day);
  if (!parsed.success) return null;

  const date = new Date(`${parsed.data}T00:00:00.000+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultRange(): MetricsRange {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function parseRange(request: Request): MetricsRange | null {
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!from && !to) return defaultRange();
  if (!from || !to) return null;

  const start = kstDayStart(from);
  const endDay = kstDayStart(to);
  if (!start || !endDay || endDay < start) return null;

  const end = new Date(endDay.getTime() + 24 * 60 * 60 * 1000);
  if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60 * 1000) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function GET(request: Request) {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return jsonNoStore({ error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } }, 401);
    }
    throw error;
  }

  const range = parseRange(request);
  if (!range) {
    return jsonNoStore(
      { error: { code: "INVALID_RANGE", message: "최대 31일 범위의 날짜를 입력해주세요." } },
      400,
    );
  }

  const admin = await createAdminClient();
  const { data, error } = await admin.rpc("product_event_metrics", {
    p_start: range.start,
    p_end: range.end,
  });

  const metrics = metricsSchema.safeParse(data);
  if (error || !metrics.success) {
    return jsonNoStore(
      { error: { code: "METRICS_UNAVAILABLE", message: "계측 테이블 또는 집계 함수를 사용할 수 없습니다." } },
      503,
    );
  }

  return jsonNoStore({ range, ...metrics.data });
}
