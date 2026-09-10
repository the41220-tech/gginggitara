import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { z } from "zod";

const COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-kkinggitaja-participant"
  : "kkinggitaja-participant";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
const sessionIdSchema = z.uuid();

export type ParticipantSession = Readonly<{
  id: string;
  token: string;
  isNew: boolean;
}>;

function signingSecret(): string {
  const dedicatedSecret = process.env.PARTICIPANT_SESSION_SECRET?.trim();
  if (dedicatedSecret && dedicatedSecret.length >= 32) return dedicatedSecret;

  if (process.env.NODE_ENV !== "production") {
    const developmentSecret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (developmentSecret && developmentSecret.length >= 32) return developmentSecret;
  }

  throw new ParticipantSessionConfigurationError();
}

function signature(sessionId: string, issuedAt: number): string {
  return createHmac("sha256", signingSecret())
    .update(`participant-session:v1:${sessionId}:${issuedAt}`)
    .digest("base64url");
}

function sign(sessionId: string, issuedAt: number): string {
  return `${sessionId}.${issuedAt}.${signature(sessionId, issuedAt)}`;
}

function verify(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [sessionId, rawIssuedAt, suppliedSignature] = parts;
  const issuedAt = Number(rawIssuedAt);
  const now = Math.floor(Date.now() / 1000);
  if (
    !sessionIdSchema.safeParse(sessionId).success
    || !Number.isSafeInteger(issuedAt)
    || issuedAt > now + 300
    || now - issuedAt > SESSION_LIFETIME_SECONDS
    || !suppliedSignature
  ) return null;

  const expected = Buffer.from(signature(sessionId, issuedAt));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return sessionId;
}

export class ParticipantSessionConfigurationError extends Error {
  readonly code = "PARTICIPANT_SESSION_NOT_CONFIGURED";

  constructor() {
    super("PARTICIPANT_SESSION_SECRET must be configured in production.");
    this.name = "ParticipantSessionConfigurationError";
  }
}

export async function requireParticipantSession(): Promise<string | null> {
  const cookieStore = await cookies();
  return verify(cookieStore.get(COOKIE_NAME)?.value);
}

export async function getOrCreateParticipantSession(): Promise<ParticipantSession> {
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(COOKIE_NAME)?.value;
  const existingId = verify(existingToken);
  if (existingId && existingToken) {
    return { id: existingId, token: existingToken, isNew: false };
  }

  const id = randomUUID();
  const issuedAt = Math.floor(Date.now() / 1000);
  return { id, token: sign(id, issuedAt), isNew: true };
}

export function attachParticipantSession(
  response: NextResponse,
  session: ParticipantSession,
): NextResponse {
  if (!session.isNew) return response;

  response.cookies.set({
    name: COOKIE_NAME,
    value: session.token,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
    priority: "high",
  });
  return response;
}
