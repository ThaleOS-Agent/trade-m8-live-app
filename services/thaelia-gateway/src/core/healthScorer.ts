// ============================================================
// THAELIA Exchange Gateway v1.0 — Connection Health Scorer
// XQ Trade M8 Pro | ThaleOS/FernXQ
// PROVENANCE: ARCHITECTURE_DESIGN
//
// Composite score 0–100:
//   Latency          30 pts
//   Reconnect freq   25 pts
//   Missed heartbeat 25 pts
//   Message rate     10 pts
//   Sequence integ.  10 pts
//
// Green ≥ 80 | Amber 50–79 | Red < 50
// ============================================================

export type HealthBand = 'GREEN' | 'AMBER' | 'RED';

interface HealthInput {
  latencyMs: number;
  reconnectCount: number;
  missedPings: number;
  messagesPerSecond: number;
  sequenceGaps: number;
  windowSeconds?: number; // observation window for reconnect scoring
}

export interface HealthScore {
  score: number;
  band: HealthBand;
  breakdown: {
    latency: number;
    reconnectFreq: number;
    heartbeat: number;
    messageRate: number;
    sequenceIntegrity: number;
  };
}

export function computeHealthScore(input: HealthInput): HealthScore {
  const {
    latencyMs,
    reconnectCount,
    missedPings,
    messagesPerSecond,
    sequenceGaps,
    windowSeconds = 300, // 5-minute window
  } = input;

  // Latency component (30 pts)
  // 0–50ms = full, 50–200ms = linear decay, >200ms = 0
  const latencyPts = latencyMs <= 50
    ? 30
    : latencyMs <= 200
      ? Math.max(0, 30 - ((latencyMs - 50) / 150) * 30)
      : 0;

  // Reconnect frequency (25 pts)
  // reconnectsPerMinute: 0 = full, 0.1 = half, >0.5 = 0
  const reconnectsPerMin = (reconnectCount / windowSeconds) * 60;
  const reconnectPts = reconnectsPerMin === 0
    ? 25
    : Math.max(0, 25 - (reconnectsPerMin / 0.5) * 25);

  // Heartbeat (25 pts)
  // 0 missed = full, 1 = half, 2+ = 0
  const heartbeatPts = missedPings === 0
    ? 25
    : missedPings === 1
      ? 12
      : 0;

  // Message rate (10 pts)
  // < 0.1 msg/s = 0, > 1 msg/s = full
  const msgRatePts = messagesPerSecond <= 0
    ? 0
    : Math.min(10, (messagesPerSecond / 1) * 10);

  // Sequence integrity (10 pts)
  // 0 gaps = full, 1–2 = half, >2 = 0
  const seqPts = sequenceGaps === 0
    ? 10
    : sequenceGaps <= 2
      ? 5
      : 0;

  const score = Math.round(latencyPts + reconnectPts + heartbeatPts + msgRatePts + seqPts);

  return {
    score: Math.max(0, Math.min(100, score)),
    band: score >= 80 ? 'GREEN' : score >= 50 ? 'AMBER' : 'RED',
    breakdown: {
      latency: Math.round(latencyPts),
      reconnectFreq: Math.round(reconnectPts),
      heartbeat: Math.round(heartbeatPts),
      messageRate: Math.round(msgRatePts),
      sequenceIntegrity: Math.round(seqPts),
    },
  };
}
