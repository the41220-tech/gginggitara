import { z } from "zod";
import { jsonNoStore } from "@/lib/http";
import { maskAccountHolder } from "@/lib/mask";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidUUID } from "@/lib/validation";
import { recordServerProductEvent } from "@/lib/server-analytics";
import { requireParticipantSession } from "@/lib/participant-session";
import { allocateExactPartyAmounts, type SettlementParty } from "@/lib/settlement-allocation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SettlementRequestSchema = z.strictObject({
  bankName: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} ()&.-]+$/u),
  accountNumber: z.string().trim().min(7).max(36).regex(/^[0-9-]+$/)
    .refine((value) => value.replaceAll("-", "").length >= 7),
  accountHolder: z.string().trim().min(1).max(30).regex(/^[\p{L}\p{N} .'-]+$/u),
  actualFare: z.number().int().min(1000).max(200000),
  replace: z.literal(true).optional(),
});

type SettlementRequest = z.infer<typeof SettlementRequestSchema>;

type FareSummary = {
  readonly totalMin: number;
  readonly totalMax: number;
  readonly totalPeople: number;
  readonly perPersonMin: number;
  readonly perPersonMax: number;
  readonly viewerPartySize: number;
};

type StoredSettlement = {
  readonly payer_session_id: string;
  readonly payer_nickname: string;
  readonly bank_name: string;
  readonly account_number: string;
  readonly account_holder_masked: string;
  readonly actual_total_fare: number | null;
};

type AuthorizedSettlementContext = {
  readonly supabase: Awaited<ReturnType<typeof createAdminClient>>;
  readonly payerNickname: string;
  readonly sessionId: string;
  readonly viewerPartyId: string;
  readonly fare: FareSummary;
  readonly departedParties: readonly SettlementParty[];
};

function invalidRequest(message: string) {
  return jsonNoStore({ error: message }, 400);
}

function internalError() {
  return jsonNoStore({ error: "정산 정보를 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, 500);
}

function fareSummary(match: {
  readonly total_party_size: unknown;
  readonly est_fare_min: unknown;
  readonly est_fare_max: unknown;
}): Omit<FareSummary, "viewerPartySize"> | null {
  const totalPeople = match.total_party_size;
  const totalMin = match.est_fare_min;
  const totalMax = match.est_fare_max;
  if (
    typeof totalPeople !== "number" || !Number.isInteger(totalPeople) || totalPeople < 2 || totalPeople > 4
    || typeof totalMin !== "number" || !Number.isInteger(totalMin) || totalMin <= 0
    || typeof totalMax !== "number" || !Number.isInteger(totalMax) || totalMax < totalMin
  ) return null;

  return {
    totalMin,
    totalMax,
    totalPeople,
    perPersonMin: Math.ceil(totalMin / totalPeople),
    perPersonMax: Math.ceil(totalMax / totalPeople),
  };
}

function settlementResponse(settlement: StoredSettlement, authorized: AuthorizedSettlementContext, idempotent: boolean) {
  const partyAmounts = settlement.actual_total_fare === null
    ? null
    : allocateExactPartyAmounts(settlement.actual_total_fare, authorized.fare.totalPeople, authorized.departedParties);
  const viewerPartyIndex = authorized.departedParties.findIndex((party) => party.id === authorized.viewerPartyId);
  const viewerPartyAmount = partyAmounts === null || viewerPartyIndex < 0 ? null : partyAmounts[viewerPartyIndex] ?? null;
  const isViewerPayer = settlement.payer_session_id === authorized.sessionId;
  return jsonNoStore({
    success: true,
    idempotent,
    hasAccount: true,
    payerNickname: settlement.payer_nickname,
    bankName: settlement.bank_name,
    accountNumber: settlement.account_number,
    accountHolderMasked: settlement.account_holder_masked,
    isViewerPayer,
    canEdit: isViewerPayer,
    fare: {
      ...authorized.fare,
      actualTotal: settlement.actual_total_fare,
      viewerPartyAmount,
    },
  });
}

async function loadAuthorizedDepartedMatch(matchId: string, sessionId: string) {
  const supabase = await createAdminClient();
  const [membershipResult, matchResult, partiesResult] = await Promise.all([
    supabase
      .from("queue_entries")
      .select("id,nickname,party_size")
      .eq("match_id", matchId)
      .eq("session_id", sessionId)
      .eq("status", "departed")
      .maybeSingle(),
    supabase.from("matches").select("status,total_party_size,est_fare_min,est_fare_max").eq("id", matchId).maybeSingle(),
    supabase
      .from("queue_entries")
      .select("id,party_size")
      .eq("match_id", matchId)
      .eq("status", "departed")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (membershipResult.error || matchResult.error || partiesResult.error) return { kind: "database_error" } as const;
  if (membershipResult.data === null) return { kind: "forbidden" } as const;
  if (matchResult.data === null) return { kind: "not_found" } as const;
  if (matchResult.data.status !== "departed") return { kind: "not_departed" } as const;

  const fare = fareSummary(matchResult.data);
  if (fare === null) return { kind: "fare_unavailable" } as const;
  const departedParties = partiesResult.data.map((party) => ({ id: party.id, partySize: party.party_size }));
  const allocations = allocateExactPartyAmounts(0, fare.totalPeople, departedParties);
  if (allocations === null) return { kind: "fare_unavailable" } as const;
  return {
    kind: "authorized" as const,
    supabase,
    payerNickname: membershipResult.data.nickname,
    sessionId,
    viewerPartyId: membershipResult.data.id,
    fare: { ...fare, viewerPartySize: membershipResult.data.party_size },
    departedParties,
  };
}

function authorizationResponse(kind: "forbidden" | "not_found" | "not_departed" | "fare_unavailable" | "database_error") {
  switch (kind) {
    case "forbidden": return jsonNoStore({ error: "이 매칭의 멤버가 아닙니다." }, 403);
    case "not_found": return jsonNoStore({ error: "매칭을 찾을 수 없습니다." }, 404);
    case "not_departed": return jsonNoStore({ error: "출발 완료 후 정산 정보를 등록할 수 있습니다." }, 409);
    case "fare_unavailable": return jsonNoStore({ error: "요금 정보를 확인하지 못했습니다." }, 503);
    case "database_error": return internalError();
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  if (!isValidUUID(matchId)) return invalidRequest("올바른 매칭 ID가 아닙니다.");
  const sessionId = await requireParticipantSession();
  if (!sessionId) return jsonNoStore({ error: "참여 세션이 필요합니다." }, 401);

  try {
    const authorized = await loadAuthorizedDepartedMatch(matchId, sessionId);
    if (authorized.kind !== "authorized") return authorizationResponse(authorized.kind);
    const { data: settlement, error } = await authorized.supabase
      .from("settlements")
      .select("payer_session_id,payer_nickname,bank_name,account_number,account_holder_masked,actual_total_fare")
      .eq("match_id", matchId)
      .maybeSingle();
    if (error) return internalError();
    if (settlement === null) return jsonNoStore({ hasAccount: false, fare: authorized.fare });
    return settlementResponse(settlement, authorized, true);
  } catch (error) {
    if (error instanceof Error) return internalError();
    return internalError();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  if (!isValidUUID(matchId)) return invalidRequest("올바른 매칭 ID가 아닙니다.");
  const sessionId = await requireParticipantSession();
  if (!sessionId) return jsonNoStore({ error: "참여 세션이 필요합니다." }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return invalidRequest("요청 형식을 확인해주세요.");
    return internalError();
  }

  const parsed = SettlementRequestSchema.safeParse(body);
  if (!parsed.success) return invalidRequest("정산 정보를 확인해주세요.");
  try {
    return await saveSettlement(matchId, sessionId, parsed.data);
  } catch (error) {
    if (error instanceof Error) return internalError();
    return internalError();
  }
}

async function saveSettlement(matchId: string, sessionId: string, request: SettlementRequest) {
  const authorized = await loadAuthorizedDepartedMatch(matchId, sessionId);
  if (authorized.kind !== "authorized") return authorizationResponse(authorized.kind);
  const { data: existing, error: existingError } = await authorized.supabase
    .from("settlements")
    .select("payer_session_id,payer_nickname,bank_name,account_number,account_holder_masked,actual_total_fare")
    .eq("match_id", matchId)
    .maybeSingle();
  if (existingError) return internalError();

  const maskedAccountHolder = maskAccountHolder(request.accountHolder);
  if (existing !== null) {
    if (existing.payer_session_id !== sessionId) {
      return jsonNoStore({ error: "이미 다른 팀원이 계좌를 전달했습니다." }, 409);
    }
    const unchanged = existing.bank_name === request.bankName
      && existing.account_number === request.accountNumber
      && existing.account_holder_masked === maskedAccountHolder
      && existing.actual_total_fare === request.actualFare;
    if (unchanged) return settlementResponse(existing, authorized, true);
    if (request.replace !== true) {
      return jsonNoStore({ error: "계좌 변경은 replace: true로 다시 요청해주세요." }, 409);
    }
    const { data: updated, error: updateError } = await authorized.supabase
      .from("settlements")
      .update({ bank_name: request.bankName, account_number: request.accountNumber, account_holder_masked: maskedAccountHolder, actual_total_fare: request.actualFare })
      .eq("match_id", matchId)
      .eq("payer_session_id", sessionId)
      .select("payer_session_id,payer_nickname,bank_name,account_number,account_holder_masked,actual_total_fare")
      .single();
    if (updateError || updated === null) return internalError();
    return settlementResponse(updated, authorized, false);
  }

  const { data: created, error: insertError } = await authorized.supabase
    .from("settlements")
    .insert({
      match_id: matchId,
      payer_session_id: sessionId,
      payer_nickname: authorized.payerNickname,
      bank_name: request.bankName,
      account_number: request.accountNumber,
      account_holder_masked: maskedAccountHolder,
      actual_total_fare: request.actualFare,
    })
    .select("payer_session_id,payer_nickname,bank_name,account_number,account_holder_masked,actual_total_fare")
    .single();
  if (insertError || created === null) {
    if (insertError?.code !== "23505") return internalError();
    const { data: racedSettlement, error: racedError } = await authorized.supabase
      .from("settlements")
      .select("payer_session_id,payer_nickname,bank_name,account_number,account_holder_masked,actual_total_fare")
      .eq("match_id", matchId)
      .maybeSingle();
    if (racedError || racedSettlement === null) return internalError();
    if (
      racedSettlement.payer_session_id === sessionId
      && racedSettlement.bank_name === request.bankName
      && racedSettlement.account_number === request.accountNumber
      && racedSettlement.account_holder_masked === maskedAccountHolder
      && racedSettlement.actual_total_fare === request.actualFare
    ) return settlementResponse(racedSettlement, authorized, true);
    return jsonNoStore({ error: "이미 다른 팀원이 계좌를 전달했습니다." }, 409);
  }
  await recordServerProductEvent({
    eventName: "settlement_created",
    sessionId,
    properties: { party_size: authorized.fare.viewerPartySize },
  });
  return settlementResponse(created, authorized, false);
}
