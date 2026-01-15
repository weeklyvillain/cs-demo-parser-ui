/**
 * Body Blocking / Movement Griefing Detection
 * 
 * Detects intentional teammate blocking using kinematic analysis without requiring map geometry.
 * Uses player positions, velocities, and movement patterns to identify blocking episodes.
 * 
 * Approach:
 * - Analyzes player pairs (teammates) for blocking patterns
 * - Uses sliding windows to compute features (distance, frontness, speed, acceleration)
 * - Detects "failed pass attempts" through heading changes and speed drops
 * - Filters false positives (rushes, narrow hallways, spawn congestion)
 * - Scores episodes based on duration, blocker behavior, and victim intent
 * 
 * Key Features:
 * - Map-agnostic (no navmesh or geometry required)
 * - Handles spawn congestion, rushes, and narrow corridors
 * - Detects intentional blocking vs incidental contact
 * - Provides explainable results with confidence scores
 */

import { MatchFrame, PlayerState, Round, Team } from '../types';

/**
 * Configuration for body blocking detection
 */
export interface BodyBlockConfig {
  // Sampling
  samplingHz: number; // Sample ticks at this rate (10-20 Hz recommended)
  
  // Distance thresholds
  closeDist: number; // Max distance for blocking detection (units, e.g. 50)
  frontCone: number; // Min frontness (dot product) for blocker to be "in front" (0-1, e.g. 0.7)
  
  // Speed thresholds
  stuckSpeedMax: number; // Max speed for victim to be considered "stuck" (units/s)
  intentSpeedMin: number; // Min speed for victim to show movement intent (units/s)
  runningSpeedMin: number; // Min speed for "running" (for rush guard) (units/s)
  
  // Progress thresholds
  minProgressPerSec: number; // Min displacement per second for victim to be making progress (units/s)
  
  // Time thresholds
  spawnIgnoreSeconds: number; // Ignore blocking in first N seconds after freeze end
  minEventDuration: number; // Min duration for a blocking episode to be flagged (seconds)
  allowGapSeconds: number; // Max gap between samples to continue an episode (seconds)
  
  // Crowdedness
  crowdedRadius: number; // Radius to check for nearby teammates (units)
  crowdedCountThreshold: number; // Min teammates nearby to consider "crowded" (count)
  
  // Acceleration/heading change detection
  accelSpikeThreshold: number; // Min acceleration change to count as "spike" (units/s²)
  headingChangeThreshold: number; // Min heading change to count as "attempt" (degrees)
  
  // Scoring weights
  weights: {
    duration: number; // Weight for episode duration
    progress: number; // Weight for lack of victim progress
    blockerStationary: number; // Weight for blocker being stationary
    failedPasses: number; // Weight for failed pass attempts
    reblock: number; // Weight for re-blocking behavior
    rushGuard: number; // Penalty weight for rush scenarios
    crowdedness: number; // Penalty weight for crowded scenarios
  };
  
  // Multipliers
  repeatMultiplier: number; // Confidence multiplier for repeated episodes (same pair)
}

/**
 * Default configuration
 */
export const DEFAULT_BODY_BLOCK_CONFIG: BodyBlockConfig = {
  samplingHz: 10,
  closeDist: 50, // 50 units (~1.5m in CS2)
  frontCone: 0.7, // ~45 degree cone
  stuckSpeedMax: 80, // units/s (walking speed)
  intentSpeedMin: 50, // units/s (slow walk)
  runningSpeedMin: 150, // units/s (running)
  minProgressPerSec: 30, // units/s
  spawnIgnoreSeconds: 10, // Ignore first 10s after freeze
  minEventDuration: 1.2, // Min 1.2s to flag
  allowGapSeconds: 0.5, // Allow 0.5s gaps
  crowdedRadius: 150, // 150 units (~4.5m)
  crowdedCountThreshold: 3, // 3+ teammates nearby
  accelSpikeThreshold: 200, // units/s²
  headingChangeThreshold: 30, // 30 degrees
  weights: {
    duration: 0.25,
    progress: 0.25,
    blockerStationary: 0.20,
    failedPasses: 0.15,
    reblock: 0.10,
    rushGuard: 0.15, // Penalty
    crowdedness: 0.10 // Penalty
  },
  repeatMultiplier: 1.3
};

/**
 * Features computed for a player pair at a given time
 */
interface BlockingFeatures {
  distance: number;
  frontness: number; // Dot product: victim direction · (blocker - victim) direction
  sideOffset: number; // Perpendicular distance from victim's forward line
  victimSpeed: number;
  blockerSpeed: number;
  relativeForwardSpeed: number; // Victim wants to go faster than blocker
  victimAccel: number; // Acceleration magnitude
  headingChange: number; // Change in victim heading
  nearbyTeammates: number; // Count of teammates within crowdedRadius
  isStackRunning: boolean; // Both running same direction
  timeSinceFreeze: number; // Seconds since freeze end
}

/**
 * A blocking episode candidate
 */
interface BlockingEpisode {
  startTick: number;
  endTick: number;
  startTime: number;
  endTime: number;
  blockerId: number;
  victimId: number;
  samples: Array<{
    tick: number;
    time: number;
    features: BlockingFeatures;
  }>;
}

/**
 * A detected blocking event
 */
export interface BlockEvent {
  startTick: number;
  endTick: number;
  startTime: number;
  endTime: number;
  duration: number;
  blockerId: number;
  blockerName: string;
  victimId: number;
  victimName: string;
  locationHint: string; // Approximate location (e.g., "near spawn", "mid-map")
  confidence: number; // 0-1
  featuresSummary: {
    avgDistance: number;
    frontnessRatio: number; // % of time blocker was in front
    avgVictimSpeed: number;
    avgBlockerSpeed: number;
    blockerStationaryFraction: number; // % of time blocker was stationary
    failedPassAttempts: number; // Count of heading changes + speed drops
    nearbyTeammatesAvg: number;
    rushGuardFraction: number; // % of time in "rush" mode
    reblockCount: number; // Count of re-blocking behaviors
  };
  reason: string; // Human-readable reason
}

/**
 * Result for a round
 */
export interface BodyBlockResult {
  round: number;
  events: BlockEvent[];
  blockScoreRound: number; // Overall blocking score for the round (0-1)
  flagged: boolean; // Whether round has significant blocking
  confidence: number; // Overall confidence (0-1)
}

/**
 * Player tracking state for sliding window analysis
 */
interface PlayerTrackingState {
  playerId: number;
  samples: Array<{
    tick: number;
    time: number;
    position: { x: number; y: number; z?: number };
    velocity: { x: number; y: number; z?: number };
    speed: number;
    heading: number; // Movement direction in degrees
    isAlive: boolean;
  }>;
  lastPosition?: { x: number; y: number; z?: number };
  lastVelocity?: { x: number; y: number; z?: number };
  lastSpeed?: number;
  lastHeading?: number;
}

/**
 * Calculate 2D distance between two positions
 */
function distance2D(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate 3D distance
 */
function distance3D(p1: { x: number; y: number; z?: number }, p2: { x: number; y: number; z?: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = (p2.z || 0) - (p1.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Normalize a 2D vector
 */
function normalize2D(v: { x: number; y: number }): { x: number; y: number } | null {
  const mag = Math.sqrt(v.x * v.x + v.y * v.y);
  if (mag < 0.001) return null;
  return { x: v.x / mag, y: v.y / mag };
}

/**
 * Calculate dot product of two 2D vectors
 */
function dot2D(v1: { x: number; y: number }, v2: { x: number; y: number }): number {
  return v1.x * v2.x + v1.y * v2.y;
}

/**
 * Calculate angle between two headings (handles wrap-around)
 */
function headingDelta(h1: number, h2: number): number {
  let delta = Math.abs(h2 - h1);
  if (delta > 180) {
    delta = 360 - delta;
  }
  return delta;
}

/**
 * Calculate velocity from position samples
 */
function calculateVelocity(
  current: { x: number; y: number; z?: number },
  previous: { x: number; y: number; z?: number },
  timeDelta: number
): { x: number; y: number; z: number } {
  if (timeDelta <= 0) return { x: 0, y: 0, z: 0 };
  return {
    x: (current.x - previous.x) / timeDelta,
    y: (current.y - previous.y) / timeDelta,
    z: ((current.z || 0) - (previous.z || 0)) / timeDelta
  };
}

/**
 * Calculate heading from velocity vector
 */
function velocityToHeading(vel: { x: number; y: number }): number {
  if (Math.abs(vel.x) < 0.001 && Math.abs(vel.y) < 0.001) return 0;
  const angle = Math.atan2(vel.y, vel.x) * (180 / Math.PI);
  return angle < 0 ? angle + 360 : angle;
}

/**
 * Extract blocking features for a player pair
 */
function extractBlockingFeatures(
  victim: PlayerTrackingState,
  blocker: PlayerTrackingState,
  currentTick: number,
  currentTime: number,
  freezeEndTime: number,
  nearbyTeammates: PlayerTrackingState[],
  config: BodyBlockConfig
): BlockingFeatures | null {
  if (victim.samples.length < 2 || blocker.samples.length < 2) return null;
  
  const victimSample = victim.samples[victim.samples.length - 1];
  const blockerSample = blocker.samples[blocker.samples.length - 1];
  
  if (!victimSample || !blockerSample) return null;
  
  // Distance
  const dist = distance2D(victimSample.position, blockerSample.position);
  
  // Victim velocity and direction
  const victimVel = victimSample.velocity;
  const victimSpeed = Math.sqrt(victimVel.x * victimVel.x + victimVel.y * victimVel.y);
  const victimDir = normalize2D(victimVel);
  
  // Blocker velocity and speed
  const blockerVel = blockerSample.velocity;
  const blockerSpeed = Math.sqrt(blockerVel.x * blockerVel.x + blockerVel.y * blockerVel.y);
  
  // Frontness: how much blocker is in front of victim
  let frontness = 0;
  if (victimDir) {
    const toBlocker = normalize2D({
      x: blockerSample.position.x - victimSample.position.x,
      y: blockerSample.position.y - victimSample.position.y
    });
    if (toBlocker) {
      frontness = dot2D(victimDir, toBlocker);
    }
  }
  
  // Side offset: perpendicular distance from victim's forward line
  let sideOffset = 0;
  if (victimDir) {
    const toBlocker = {
      x: blockerSample.position.x - victimSample.position.x,
      y: blockerSample.position.y - victimSample.position.y
    };
    const forwardComponent = dot2D(toBlocker, victimDir);
    const forwardVec = { x: victimDir.x * forwardComponent, y: victimDir.y * forwardComponent };
    const sideVec = { x: toBlocker.x - forwardVec.x, y: toBlocker.y - forwardVec.y };
    sideOffset = Math.sqrt(sideVec.x * sideVec.x + sideVec.y * sideVec.y);
  }
  
  // Relative forward speed
  let relativeForwardSpeed = 0;
  if (victimDir) {
    const victimForward = dot2D(victimVel, victimDir);
    const blockerForward = dot2D(blockerVel, victimDir);
    relativeForwardSpeed = victimForward - blockerForward;
  }
  
  // Acceleration (change in speed)
  let victimAccel = 0;
  if (victim.lastSpeed !== undefined && victim.samples.length >= 2) {
    const prevSample = victim.samples[victim.samples.length - 2];
    const timeDelta = victimSample.time - prevSample.time;
    if (timeDelta > 0) {
      victimAccel = Math.abs(victimSpeed - victim.lastSpeed) / timeDelta;
    }
  }
  
  // Heading change
  let headingChange = 0;
  if (victim.lastHeading !== undefined) {
    headingChange = headingDelta(victim.lastHeading, victimSample.heading);
  }
  
  // Nearby teammates count
  const nearbyCount = nearbyTeammates.filter(t => {
    if (t.playerId === victim.playerId || t.playerId === blocker.playerId) return false;
    const dist = distance2D(victimSample.position, t.samples[t.samples.length - 1]?.position || { x: 0, y: 0 });
    return dist <= config.crowdedRadius;
  }).length;
  
  // Stack running guard: both running same direction
  const isStackRunning = 
    victimSpeed >= config.runningSpeedMin &&
    blockerSpeed >= config.runningSpeedMin &&
    frontness > config.frontCone &&
    Math.abs(victimSample.heading - blockerSample.heading) < 45; // Similar heading
  
  const timeSinceFreeze = currentTime - freezeEndTime;
  
  return {
    distance: dist,
    frontness,
    sideOffset,
    victimSpeed,
    blockerSpeed,
    relativeForwardSpeed,
    victimAccel,
    headingChange,
    nearbyTeammates: nearbyCount,
    isStackRunning,
    timeSinceFreeze
  };
}

/**
 * Detect blocking episodes for a round
 */
export function detectBodyBlocking(
  round: Round,
  frames: MatchFrame[],
  tickRate: number,
  config: BodyBlockConfig = DEFAULT_BODY_BLOCK_CONFIG
): BodyBlockResult {
  const events: BlockEvent[] = [];
  
  if (!round.freezeEndTick || !round.endTick) {
    return {
      round: round.number,
      events: [],
      blockScoreRound: 0,
      flagged: false,
      confidence: 0
    };
  }
  
  // Filter frames to round (after freeze time)
  const roundFrames = frames.filter(f => 
    f.tick >= round.freezeEndTick! && 
    f.tick <= round.endTick!
  );
  
  if (roundFrames.length === 0) {
    return {
      round: round.number,
      events: [],
      blockScoreRound: 0,
      flagged: false,
      confidence: 0
    };
  }
  
  // Sample frames
  const sampleInterval = Math.ceil(tickRate / config.samplingHz);
  const sampledFrames: MatchFrame[] = [];
  for (let i = 0; i < roundFrames.length; i += sampleInterval) {
    sampledFrames.push(roundFrames[i]);
  }
  if (sampledFrames.length === 0 || sampledFrames[sampledFrames.length - 1] !== roundFrames[roundFrames.length - 1]) {
    sampledFrames.push(roundFrames[roundFrames.length - 1]);
  }
  
  const freezeEndTime = roundFrames[0]?.time || 0;
  
  // Initialize tracking for all players
  const playerTracking = new Map<number, PlayerTrackingState>();
  const playerNames = new Map<number, string>();
  
  // Process frames to build tracking
  for (const frame of sampledFrames) {
    for (const player of frame.players) {
      if (player.team === Team.SPECTATOR || !player.isAlive) continue;
      
      let tracking = playerTracking.get(player.id);
      if (!tracking) {
        tracking = {
          playerId: player.id,
          samples: []
        };
        playerTracking.set(player.id, tracking);
        playerNames.set(player.id, player.name);
      }
      
      // Calculate velocity from previous position
      let velocity = { x: 0, y: 0, z: 0 };
      let speed = 0;
      let heading = 0;
      
      if (tracking.samples.length > 0) {
        const prevSample = tracking.samples[tracking.samples.length - 1];
        const timeDelta = frame.time - prevSample.time;
        if (timeDelta > 0) {
          velocity = calculateVelocity(player.position, prevSample.position, timeDelta);
          speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
          heading = velocityToHeading(velocity);
        }
      }
      
      // Store previous state
      tracking.lastPosition = tracking.samples[tracking.samples.length - 1]?.position;
      tracking.lastVelocity = tracking.samples[tracking.samples.length - 1]?.velocity;
      tracking.lastSpeed = tracking.samples[tracking.samples.length - 1]?.speed;
      tracking.lastHeading = tracking.samples[tracking.samples.length - 1]?.heading;
      
      // Add sample
      tracking.samples.push({
        tick: frame.tick,
        time: frame.time,
        position: { ...player.position },
        velocity,
        speed,
        heading,
        isAlive: player.isAlive
      });
      
      // Keep only samples within 5s window
      const window5sTicks = Math.ceil(5 * tickRate);
      tracking.samples = tracking.samples.filter(s => s.tick >= frame.tick - window5sTicks);
    }
  }
  
  // Analyze all player pairs (teammates)
  const episodes = new Map<string, BlockingEpisode>(); // Key: "victimId-blockerId"
  
  for (const frame of sampledFrames) {
    const players = Array.from(playerTracking.values()).filter(t => {
      const sample = t.samples[t.samples.length - 1];
      return sample && sample.tick === frame.tick && sample.isAlive;
    });
    
    // Group by team
    const teams = new Map<Team, PlayerTrackingState[]>();
    for (const player of players) {
      const playerState = frame.players.find(p => p.id === player.playerId);
      if (!playerState || playerState.team === Team.SPECTATOR) continue;
      
      if (!teams.has(playerState.team)) {
        teams.set(playerState.team, []);
      }
      teams.get(playerState.team)!.push(player);
    }
    
    // Check each team for blocking
    for (const [team, teamPlayers] of teams.entries()) {
      for (let i = 0; i < teamPlayers.length; i++) {
        for (let j = i + 1; j < teamPlayers.length; j++) {
          const victim = teamPlayers[i];
          const blocker = teamPlayers[j];
          
          // Try both directions (victim-blocker and blocker-victim)
          for (const [v, b] of [[victim, blocker], [blocker, victim]]) {
            const features = extractBlockingFeatures(
              v,
              b,
              frame.tick,
              frame.time,
              freezeEndTime,
              teamPlayers.filter(p => p.playerId !== v.playerId && p.playerId !== b.playerId),
              config
            );
            
            if (!features) continue;
            
            // Check if blocking conditions are met
            const isBlocking = 
              features.distance < config.closeDist &&
              features.frontness > config.frontCone &&
              features.timeSinceFreeze >= config.spawnIgnoreSeconds &&
              (features.victimSpeed > config.intentSpeedMin || features.victimAccel > config.accelSpikeThreshold || features.relativeForwardSpeed > 20) &&
              (features.victimSpeed < config.stuckSpeedMax || features.relativeForwardSpeed < -20);
            
            if (isBlocking && !features.isStackRunning) {
              const key = `${v.playerId}-${b.playerId}`;
              let episode = episodes.get(key);
              
              if (!episode) {
                episode = {
                  startTick: frame.tick,
                  endTick: frame.tick,
                  startTime: frame.time,
                  endTime: frame.time,
                  blockerId: b.playerId,
                  victimId: v.playerId,
                  samples: []
                };
                episodes.set(key, episode);
              }
              
              // Check if we should continue or start new episode
              const timeSinceLastSample = episode.samples.length > 0
                ? frame.time - episode.samples[episode.samples.length - 1].time
                : 0;
              
              if (timeSinceLastSample <= config.allowGapSeconds) {
                // Continue episode
                episode.endTick = frame.tick;
                episode.endTime = frame.time;
                episode.samples.push({
                  tick: frame.tick,
                  time: frame.time,
                  features
                });
              } else {
                // Gap too large, start new episode
                episode = {
                  startTick: frame.tick,
                  endTick: frame.tick,
                  startTime: frame.time,
                  endTime: frame.time,
                  blockerId: b.playerId,
                  victimId: v.playerId,
                  samples: [{
                    tick: frame.tick,
                    time: frame.time,
                    features
                  }]
                };
                episodes.set(key, episode);
              }
            } else {
              // Not blocking - close episode if exists
              const key = `${v.playerId}-${b.playerId}`;
              const episode = episodes.get(key);
              if (episode && episode.samples.length > 0) {
                const duration = episode.endTime - episode.startTime;
                if (duration >= config.minEventDuration) {
                  // Process episode into event
                  processEpisode(episode, playerNames, config, events, round.number);
                }
                episodes.delete(key);
              }
            }
          }
        }
      }
    }
  }
  
  // Process remaining episodes
  for (const episode of episodes.values()) {
    const duration = episode.endTime - episode.startTime;
    if (duration >= config.minEventDuration) {
      processEpisode(episode, playerNames, config, events, round.number);
    }
  }
  
  // Calculate round score
  const blockScoreRound = events.length > 0
    ? Math.min(1.0, events.reduce((sum, e) => sum + e.confidence, 0) / events.length)
    : 0;
  const flagged = blockScoreRound > 0.5;
  const confidence = blockScoreRound;
  
  return {
    round: round.number,
    events,
    blockScoreRound,
    flagged,
    confidence
  };
}

/**
 * Process a blocking episode into a BlockEvent
 */
function processEpisode(
  episode: BlockingEpisode,
  playerNames: Map<number, string>,
  config: BodyBlockConfig,
  events: BlockEvent[],
  roundNumber: number
): void {
  if (episode.samples.length === 0) return;
  
  const duration = episode.endTime - episode.startTime;
  const blockerName = playerNames.get(episode.blockerId) || 'Unknown';
  const victimName = playerNames.get(episode.victimId) || 'Unknown';
  
  // Calculate features summary
  const avgDistance = episode.samples.reduce((sum, s) => sum + s.features.distance, 0) / episode.samples.length;
  const frontnessRatio = episode.samples.filter(s => s.features.frontness > config.frontCone).length / episode.samples.length;
  const avgVictimSpeed = episode.samples.reduce((sum, s) => sum + s.features.victimSpeed, 0) / episode.samples.length;
  const avgBlockerSpeed = episode.samples.reduce((sum, s) => sum + s.features.blockerSpeed, 0) / episode.samples.length;
  const blockerStationaryFraction = episode.samples.filter(s => s.features.blockerSpeed < config.stuckSpeedMax).length / episode.samples.length;
  const nearbyTeammatesAvg = episode.samples.reduce((sum, s) => sum + s.features.nearbyTeammates, 0) / episode.samples.length;
  const rushGuardFraction = episode.samples.filter(s => s.features.isStackRunning).length / episode.samples.length;
  
  // Count failed pass attempts (heading changes + speed drops)
  let failedPassAttempts = 0;
  let reblockCount = 0;
  let lastHeading = episode.samples[0]?.features.headingChange || 0;
  let lastBlockerSpeed = episode.samples[0]?.features.blockerSpeed || 0;
  
  for (let i = 1; i < episode.samples.length; i++) {
    const curr = episode.samples[i].features;
    const prev = episode.samples[i - 1].features;
    
    // Heading change while close
    if (curr.headingChange > config.headingChangeThreshold && curr.distance < config.closeDist) {
      failedPassAttempts++;
    }
    
    // Speed drop while trying to move
    if (prev.victimSpeed > config.intentSpeedMin && curr.victimSpeed < prev.victimSpeed * 0.7) {
      failedPassAttempts++;
    }
    
    // Re-block: blocker speed increases then decreases (stepped out, stepped back)
    if (lastBlockerSpeed < config.stuckSpeedMax && curr.blockerSpeed > config.runningSpeedMin * 0.5 && 
        i < episode.samples.length - 1 && episode.samples[i + 1].features.blockerSpeed < config.stuckSpeedMax) {
      reblockCount++;
    }
    
    lastBlockerSpeed = curr.blockerSpeed;
  }
  
  // Calculate score
  const progressNormalized = Math.max(0, 1 - (avgVictimSpeed / config.minProgressPerSec));
  const score = 
    config.weights.duration * Math.min(1.0, duration / 5.0) +
    config.weights.progress * progressNormalized +
    config.weights.blockerStationary * blockerStationaryFraction +
    config.weights.failedPasses * Math.min(1.0, failedPassAttempts / 5.0) +
    config.weights.reblock * Math.min(1.0, reblockCount / 3.0) -
    config.weights.rushGuard * rushGuardFraction -
    config.weights.crowdedness * Math.min(1.0, nearbyTeammatesAvg / config.crowdedCountThreshold);
  
  const confidence = Math.max(0, Math.min(1.0, score));
  
  // Generate location hint (simplified - just use distance from spawn estimate)
  const locationHint = avgDistance < 500 ? 'near spawn' : 'mid-map';
  
  // Generate reason
  const reason = generateReason(
    blockerName,
    victimName,
    duration,
    failedPassAttempts,
    blockerStationaryFraction,
    reblockCount
  );
  
  events.push({
    startTick: episode.startTick,
    endTick: episode.endTick,
    startTime: episode.startTime,
    endTime: episode.endTime,
    duration,
    blockerId: episode.blockerId,
    blockerName,
    victimId: episode.victimId,
    victimName,
    locationHint,
    confidence,
    featuresSummary: {
      avgDistance,
      frontnessRatio,
      avgVictimSpeed,
      avgBlockerSpeed,
      blockerStationaryFraction,
      failedPassAttempts,
      nearbyTeammatesAvg,
      rushGuardFraction,
      reblockCount
    },
    reason
  });
}

/**
 * Generate human-readable reason for blocking event
 */
function generateReason(
  blockerName: string,
  victimName: string,
  duration: number,
  failedPassAttempts: number,
  blockerStationaryFraction: number,
  reblockCount: number
): string {
  const parts: string[] = [];
  
  parts.push(`Blocked ${victimName} for ${duration.toFixed(1)}s`);
  
  if (failedPassAttempts > 0) {
    parts.push(`${failedPassAttempts} pass attempt${failedPassAttempts !== 1 ? 's' : ''}`);
  }
  
  if (blockerStationaryFraction > 0.7) {
    parts.push(`blocker stationary ${Math.round(blockerStationaryFraction * 100)}%`);
  }
  
  if (reblockCount > 0) {
    parts.push(`${reblockCount} re-block${reblockCount !== 1 ? 's' : ''}`);
  }
  
  return parts.join(', ');
}

