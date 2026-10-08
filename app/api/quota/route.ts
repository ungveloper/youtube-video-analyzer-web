import { NextResponse } from 'next/server';
import { personalModeStatus } from '@/lib/server/personal-mode';
export const runtime = 'nodejs';
export async function GET() {
  const status = personalModeStatus();
  // Keep the existing JSON shape but with no per-user counters or quota.
  return NextResponse.json({ enabled: status.enabled, limit: 0, remaining: 0, reserved: 0, completed: 0, reason: status.reason, mode: 'personal-free' }, { headers: { 'Cache-Control': 'no-store' } });
}
