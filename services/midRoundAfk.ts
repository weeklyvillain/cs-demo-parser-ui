/**
 * Mid-Round AFK / Inactivity Detection
 * 
 * Detects players who are likely AFK, disconnected, or inactive during active gameplay
 * (after freeze time ends) while avoiding false positives for legitimate gameplay like:
 * - Holding angles (aiming while stationary)
 * - Scoped holding (AWP/Scout)
 * - Post-plant/defuse situations
 * - Corner camping / anchoring
 * - Saving at end of round
 * 
 * Approach:
 * - Uses feature-based scoring with sliding windows (2s, 5s, 10s)
 * - Tracks activity signals (movement, aim, actions, events) that reset inactivity
 * - Uses context signals (scoped, round state, team state) to reduce false positives
 * - Segments continuous inactivity periods and assigns confidence scores
 * 
 * Tuning:
 * - Lower thresholds = more sensitive (more detections, more false positives)
 * - Higher thresholds = less sensitive (fewer detections, fewer false positives)
 * - Adjust scoreWeights to emphasize different features
 * - Adjust minAimActive to control angle-holding detection
 */

import { MatchFrame, PlayerState, GameEvent, Round, Team } from '../types';

/**
 * Configuration for mid-round AFK detection
 */
export interface MidRoundAfkConfig {
  // Sampling
  samplingHz: number; // Sample ticks at this rate (10-20 Hz recommended)
  
  // Displacement thresholds
  maxDisplacementHold: number; // Max distance moved in 5s to be considered "holding" (units)
  minDisplacementActive: number; // Min distance moved in 5s to be considered "active" (units)
  
  // Aim movement thresholds
  minAimActive: number; // Min total aim delta (degrees) in 5s to be considered "active aiming"
  minAimActiveHold: number; // Min aim delta to consider "holding angle" (lower threshold)
  
  // Time thresholds
  afkTimeToFlag: number; // Min seconds of inactivity to flag as AFK
  afkTimeHighConfidence: number; // Min seconds for high confidence (25s+)
  
  // Window sizes (seconds)
  window5s: number;
  window10s: number;
  
  // Score weights (sum should be ~1.0)
  scoreWeights: {
    displacement: number; // Weight for low displacement
    aimMovement: number; // Weight for low aim movement
    actions: number; // Weight for lack of actions
    duration: number; // Weight for duration of inactivity
  };
  
  // Context adjustments
  scopedReduction: number; // Reduce AFK score if scoped (0-1, 1 = no reduction)
  savingTimeThreshold: number; // Seconds remaining in round to consider "saving" scenario
  savingReduction: number; // Reduce AFK score if saving (0-1)
}

/**
 * Default configuration
 */
export const DEFAULT_MID_ROUND_AFK_CONFIG: MidRoundAfkConfig = {
  samplingHz: 10, // Sample every 0.1s at 128 tick rate
  maxDisplacementHold: 50, // 50 units in 5s = holding
  minDisplacementActive: 100, // 100 units in 5s = active movement
  minAimActive: 15, // 15 degrees total in 5s = active aiming
  minAimActiveHold: 5, // 5 degrees in 5s = holding angle (micro-adjustments)
  afkTimeToFlag: 15, // Flag after 15s of inactivity
  afkTimeHighConfidence: 25, // High confidence after 25s
  window5s: 5,
  window10s: 10,
  scoreWeights: {
    displacement: 0.3,
    aimMovement: 0.3,
    actions: 0.2,
    duration: 0.2
  },
  scopedReduction: 0.5, // 50% reduction if scoped
  savingTimeThreshold: 30, // Last 30s of round
  savingReduction: 0.6 // 40% reduction if saving
};

/**
 * Features extracted for a time window
 */
interface ActivityFeatures {
  displacement5s: number; // Total distance moved in last 5s
  aimDelta5s: number; // Total aim movement (degrees) in last 5s
  actionCount10s: number; // Number of actions (shots, weapon switches, etc.) in last 10s
  damageEvents10s: number; // Number of damage events (taken or dealt) in last 10s
  isScoped: boolean; // Whether player is scoped (if available)
  flashDuration: number; // Current flash duration
  roundTimeRemaining: number; // Seconds remaining in round
  isAlive: boolean;
}

/**
 * An inactive segment (continuous period of inactivity)
 */
export interface InactiveSegment {
  startTick: number;
  endTick: number;
  startTime: number; // seconds
  endTime: number; // seconds
  duration: number; // seconds
  score: number; // Inactivity score (0-1, higher = more inactive)
  confidence: number; // Confidence this is true AFK (0-1)
  featuresSummary: {
    avgDisplacement: number;
    avgAimDelta: number;
    totalActions: number;
    totalDamageEvents: number;
  };
  reason: 'no_movement_no_aim' | 'no_movement_low_aim' | 'no_actions' | 'combined';
}

/**
 * Result for a single player in a round
 */
export interface InactivityResult {
  playerId: number;
  playerName: string;
  segments: InactiveSegment[];
  roundScore: number; // Overall inactivity score for the round (0-1)
  flagged: boolean; // Whether player is flagged as possible mid-round AFK
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
    viewAngle: number;
    isAlive: boolean;
    flashDuration: number;
    shotsFired: number;
    primaryWeapon?: string;
  }>;
  lastActionTick: number;
  lastDamageTick: number;
  currentSegmentStart?: number; // Tick when current inactivity segment started
  currentSegmentScore: number;
}

/**
 * Calculate angle difference handling wrap-around (0-360 degrees)
 */
function angleDelta(a1: number, a2: number): number {
  let delta = Math.abs(a2 - a1);
  if (delta > 180) {
    delta = 360 - delta;
  }
  return delta;
}

/**
 * Calculate total distance moved from position samples
 */
function calculateDisplacement(samples: Array<{ position: { x: number; y: number; z?: number } }>): number {
  if (samples.length < 2) return 0;
  
  let totalDistance = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].position;
    const curr = samples[i].position;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dz = (curr.z || 0) - (prev.z || 0);
    totalDistance += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return totalDistance;
}

/**
 * Calculate total aim movement from view angle samples
 */
function calculateAimDelta(samples: Array<{ viewAngle: number }>): number {
  if (samples.length < 2) return 0;
  
  let totalDelta = 0;
  for (let i = 1; i < samples.length; i++) {
    totalDelta += angleDelta(samples[i - 1].viewAngle, samples[i].viewAngle);
  }
  return totalDelta;
}

/**
 * Extract activity features for a player at a given tick
 */
function extractFeatures(
  tracking: PlayerTrackingState,
  currentTick: number,
  currentTime: number,
  roundEndTime: number,
  config: MidRoundAfkConfig,
  tickRate: number
): ActivityFeatures {
  const window5sTicks = Math.ceil(config.window5s * tickRate);
  const window10sTicks = Math.ceil(config.window10s * tickRate);
  
  // Get samples within windows
  const samples5s = tracking.samples.filter(s => s.tick >= currentTick - window5sTicks && s.tick <= currentTick);
  const samples10s = tracking.samples.filter(s => s.tick >= currentTick - window10sTicks && s.tick <= currentTick);
  
  // Calculate displacement in 5s window
  const displacement5s = calculateDisplacement(samples5s);
  
  // Calculate aim delta in 5s window
  const aimDelta5s = calculateAimDelta(samples5s);
  
  // Count actions in 10s window
  const actionCount10s = tracking.samples.filter(s => 
    s.tick >= currentTick - window10sTicks && 
    s.tick <= currentTick &&
    (s.shotsFired > 0 || s.tick === tracking.lastActionTick)
  ).length;
  
  // Count damage events in 10s window
  const damageEvents10s = tracking.lastDamageTick >= currentTick - window10sTicks ? 1 : 0;
  
  // Get current state
  const currentSample = tracking.samples[tracking.samples.length - 1];
  const isScoped = false; // Not available in current PlayerState, would need to be added
  const flashDuration = currentSample?.flashDuration || 0;
  const isAlive = currentSample?.isAlive || false;
  
  const roundTimeRemaining = Math.max(0, roundEndTime - currentTime);
  
  return {
    displacement5s,
    aimDelta5s,
    actionCount10s,
    damageEvents10s,
    isScoped,
    flashDuration,
    roundTimeRemaining,
    isAlive
  };
}

/**
 * Calculate inactivity score from features
 */
function calculateInactivityScore(
  features: ActivityFeatures,
  duration: number,
  config: MidRoundAfkConfig
): number {
  // Base scores (0-1, higher = more inactive)
  const displacementScore = features.displacement5s < config.maxDisplacementHold 
    ? 1.0 - (features.displacement5s / config.maxDisplacementHold)
    : 0;
  
  const aimScore = features.aimDelta5s < config.minAimActiveHold
    ? 1.0 - (features.aimDelta5s / config.minAimActiveHold)
    : 0;
  
  const actionScore = features.actionCount10s === 0 ? 1.0 : 
    Math.max(0, 1.0 - (features.actionCount10s / 5)); // Normalize to 5 actions
  
  const durationScore = Math.min(1.0, duration / config.afkTimeHighConfidence);
  
  // Weighted combination
  let score = 
    displacementScore * config.scoreWeights.displacement +
    aimScore * config.scoreWeights.aimMovement +
    actionScore * config.scoreWeights.actions +
    durationScore * config.scoreWeights.duration;
  
  // Apply context adjustments
  
  // If player is actively aiming (even if not moving), reduce score
  if (features.aimDelta5s >= config.minAimActiveHold) {
    score *= 0.3; // Strong reduction for active aiming
  } else if (features.aimDelta5s >= config.minAimActiveHold * 0.5) {
    score *= 0.6; // Moderate reduction for some aim movement
  }
  
  // If scoped, reduce score (holding angle with scope)
  if (features.isScoped) {
    score *= config.scopedReduction;
  }
  
  // If saving (low time remaining), reduce score
  if (features.roundTimeRemaining < config.savingTimeThreshold) {
    score *= config.savingReduction;
  }
  
  // If fully flashed, reduce score (can't see, legitimate inactivity)
  if (features.flashDuration > 0.8) {
    score *= 0.4;
  }
  
  return Math.min(1.0, Math.max(0, score));
}

/**
 * Determine reason for inactivity
 */
function determineReason(features: ActivityFeatures): InactiveSegment['reason'] {
  if (features.displacement5s < 10 && features.aimDelta5s < 2) {
    return 'no_movement_no_aim';
  } else if (features.displacement5s < 10 && features.aimDelta5s < 5) {
    return 'no_movement_low_aim';
  } else if (features.actionCount10s === 0 && features.damageEvents10s === 0) {
    return 'no_actions';
  } else {
    return 'combined';
  }
}

/**
 * Analyze a single round for mid-round inactivity
 */
export function analyzeRoundInactivity(
  round: Round,
  frames: MatchFrame[],
  events: GameEvent[],
  tickRate: number,
  config: MidRoundAfkConfig = DEFAULT_MID_ROUND_AFK_CONFIG
): Map<number, InactivityResult> {
  const results = new Map<number, InactivityResult>();
  
  if (!round.freezeEndTick || !round.endTick) {
    return results; // Can't analyze without proper round boundaries
  }
  
  // Filter frames to round (after freeze time)
  const roundFrames = frames.filter(f => 
    f.tick >= round.freezeEndTick && 
    f.tick <= round.endTick
  );
  
  if (roundFrames.length === 0) return results;
  
  // Sample frames at configured rate
  const sampleInterval = Math.ceil(tickRate / config.samplingHz);
  const sampledFrames: MatchFrame[] = [];
  for (let i = 0; i < roundFrames.length; i += sampleInterval) {
    sampledFrames.push(roundFrames[i]);
  }
  // Always include last frame
  if (sampledFrames.length === 0 || sampledFrames[sampledFrames.length - 1] !== roundFrames[roundFrames.length - 1]) {
    sampledFrames.push(roundFrames[roundFrames.length - 1]);
  }
  
  // Initialize tracking for all players
  const playerTracking = new Map<number, PlayerTrackingState>();
  
  // Process events to track actions and damage
  const playerActions = new Map<number, number>(); // playerId -> last action tick
  const playerDamage = new Map<number, number>(); // playerId -> last damage tick
  
  for (const event of events) {
    if (event.tick < round.freezeEndTick || event.tick > round.endTick) continue;
    
    if (event.type === 'weapon_fire' || event.type === 'throw' || event.type === 'plant' || event.type === 'defuse') {
      // Find player by name
      const playerName = event.playerName || event.attackerName;
      if (playerName) {
        for (const frame of roundFrames) {
          const player = frame.players.find(p => p.name === playerName);
          if (player) {
            playerActions.set(player.id, event.tick);
            break;
          }
        }
      }
    }
    
    if (event.type === 'damage') {
      const attackerName = event.attackerName;
      const victimName = event.victimName;
      if (attackerName || victimName) {
        for (const frame of roundFrames) {
          if (attackerName) {
            const player = frame.players.find(p => p.name === attackerName);
            if (player) playerDamage.set(player.id, event.tick);
          }
          if (victimName) {
            const player = frame.players.find(p => p.name === victimName);
            if (player) playerDamage.set(player.id, event.tick);
          }
        }
      }
    }
  }
  
  // Process sampled frames
  for (const frame of sampledFrames) {
    for (const player of frame.players) {
      // Skip spectators and dead players
      if (player.team === Team.SPECTATOR || !player.isAlive) continue;
      
      let tracking = playerTracking.get(player.id);
      if (!tracking) {
        tracking = {
          playerId: player.id,
          samples: [],
          lastActionTick: -1,
          lastDamageTick: -1,
          currentSegmentScore: 0
        };
        playerTracking.set(player.id, tracking);
      }
      
      // Update action/damage ticks
      const actionTick = playerActions.get(player.id);
      if (actionTick !== undefined && actionTick > tracking.lastActionTick) {
        tracking.lastActionTick = actionTick;
      }
      const damageTick = playerDamage.get(player.id);
      if (damageTick !== undefined && damageTick > tracking.lastDamageTick) {
        tracking.lastDamageTick = damageTick;
      }
      
      // Add sample
      tracking.samples.push({
        tick: frame.tick,
        time: frame.time,
        position: { ...player.position },
        viewAngle: player.viewAngle,
        isAlive: player.isAlive,
        flashDuration: player.flashDuration || 0,
        shotsFired: player.shotsFired || 0,
        primaryWeapon: player.equipment?.primary
      });
      
      // Keep only samples within 10s window (for efficiency)
      const window10sTicks = Math.ceil(config.window10s * tickRate);
      tracking.samples = tracking.samples.filter(s => s.tick >= frame.tick - window10sTicks);
    }
  }
  
  // Analyze each player
  const roundEndTime = roundFrames[roundFrames.length - 1].time;
  
  for (const [playerId, tracking] of playerTracking.entries()) {
    if (tracking.samples.length < 2) continue;
    
    const segments: InactiveSegment[] = [];
    let currentSegmentStart: number | undefined = undefined;
    let currentSegmentStartTime: number | undefined = undefined;
    let maxScore = 0;
    let totalScore = 0;
    let scoreCount = 0;
    
    // Find player name
    const playerName = tracking.samples[0] ? 
      roundFrames.find(f => f.players.some(p => p.id === playerId))?.players.find(p => p.id === playerId)?.name || 'Unknown' :
      'Unknown';
    
    // Analyze each sample
    for (let i = 1; i < tracking.samples.length; i++) {
      const sample = tracking.samples[i];
      const prevSample = tracking.samples[i - 1];
      
      const features = extractFeatures(tracking, sample.tick, sample.time, roundEndTime, config, tickRate);
      
      // Check for activity signals that reset inactivity
      const hasActivity = 
        features.displacement5s >= config.minDisplacementActive ||
        features.aimDelta5s >= config.minAimActive ||
        features.actionCount10s > 0 ||
        features.damageEvents10s > 0;
      
      if (!hasActivity && features.isAlive) {
        // Inactive - start or continue segment
        const duration = currentSegmentStart !== undefined 
          ? (sample.time - currentSegmentStartTime!)
          : 0;
        
        const score = calculateInactivityScore(features, duration, config);
        
        if (currentSegmentStart === undefined) {
          // Start new segment
          currentSegmentStart = sample.tick;
          currentSegmentStartTime = sample.time;
          tracking.currentSegmentScore = score;
        } else {
          // Continue segment
          tracking.currentSegmentScore = Math.max(tracking.currentSegmentScore, score);
        }
        
        maxScore = Math.max(maxScore, score);
        totalScore += score;
        scoreCount++;
      } else {
        // Activity detected - end current segment if exists
        if (currentSegmentStart !== undefined && currentSegmentStartTime !== undefined) {
          const segmentDuration = sample.time - currentSegmentStartTime;
          
          if (segmentDuration >= config.afkTimeToFlag) {
            // Calculate final features for segment
            const segmentFeatures = extractFeatures(
              tracking,
              currentSegmentStart,
              currentSegmentStartTime,
              roundEndTime,
              config,
              tickRate
            );
            
            const segmentScore = calculateInactivityScore(segmentFeatures, segmentDuration, config);
            const confidence = segmentDuration >= config.afkTimeHighConfidence ? 0.9 : 
              Math.min(0.9, 0.5 + (segmentDuration / config.afkTimeHighConfidence) * 0.4);
            
            segments.push({
              startTick: currentSegmentStart,
              endTick: sample.tick,
              startTime: currentSegmentStartTime,
              endTime: sample.time,
              duration: segmentDuration,
              score: segmentScore,
              confidence,
              featuresSummary: {
                avgDisplacement: segmentFeatures.displacement5s,
                avgAimDelta: segmentFeatures.aimDelta5s,
                totalActions: segmentFeatures.actionCount10s,
                totalDamageEvents: segmentFeatures.damageEvents10s
              },
              reason: determineReason(segmentFeatures)
            });
          }
          
          currentSegmentStart = undefined;
          currentSegmentStartTime = undefined;
          tracking.currentSegmentScore = 0;
        }
      }
    }
    
    // Close final segment if exists
    if (currentSegmentStart !== undefined && currentSegmentStartTime !== undefined) {
      const lastSample = tracking.samples[tracking.samples.length - 1];
      const segmentDuration = lastSample.time - currentSegmentStartTime;
      
      if (segmentDuration >= config.afkTimeToFlag) {
        const segmentFeatures = extractFeatures(
          tracking,
          currentSegmentStart,
          currentSegmentStartTime,
          roundEndTime,
          config,
          tickRate
        );
        
        const segmentScore = calculateInactivityScore(segmentFeatures, segmentDuration, config);
        const confidence = segmentDuration >= config.afkTimeHighConfidence ? 0.9 : 
          Math.min(0.9, 0.5 + (segmentDuration / config.afkTimeHighConfidence) * 0.4);
        
        segments.push({
          startTick: currentSegmentStart,
          endTick: lastSample.tick,
          startTime: currentSegmentStartTime,
          endTime: lastSample.time,
          duration: segmentDuration,
          score: segmentScore,
          confidence,
          featuresSummary: {
            avgDisplacement: segmentFeatures.displacement5s,
            avgAimDelta: segmentFeatures.aimDelta5s,
            totalActions: segmentFeatures.actionCount10s,
            totalDamageEvents: segmentFeatures.damageEvents10s
          },
          reason: determineReason(segmentFeatures)
        });
      }
    }
    
    // Calculate overall round score and confidence
    const roundScore = scoreCount > 0 ? totalScore / scoreCount : 0;
    const maxConfidence = segments.length > 0 
      ? Math.max(...segments.map(s => s.confidence))
      : 0;
    const flagged = segments.length > 0 && maxConfidence >= 0.5;
    
    results.set(playerId, {
      playerId,
      playerName,
      segments,
      roundScore,
      flagged,
      confidence: maxConfidence
    });
  }
  
  return results;
}

