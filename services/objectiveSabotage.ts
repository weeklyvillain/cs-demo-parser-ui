/**
 * Objective Sabotage / Bomb Griefing Detection
 * 
 * Detects intentional objective misuse: not planting when appropriate, refusing/aborting defuse,
 * and bad bomb drops. Uses only demo-extractable data (no voice/chat).
 * 
 * Approach:
 * - Analyzes bomb possession, plant/defuse attempts, and bomb drops
 * - Uses pressure indicators (damage, deaths, combat) to avoid false positives
 * - Detects opportunities using map-agnostic heuristics (team clustering, position)
 * - Scores events based on context and confidence
 * - Tracks patterns across rounds for repeat behavior
 * 
 * Key Features:
 * - Map-agnostic (no bombsite polygons required)
 * - Handles time constraints, pressure, and tactical scenarios
 * - Explains results with confidence scores and human-readable reasons
 */

import { MatchFrame, PlayerState, Round, Team, GameEvent } from '../types';

/**
 * Configuration for objective sabotage detection
 */
export interface ObjectiveConfig {
  // Sampling
  samplingHz: number; // Sample ticks at this rate (10-20 Hz recommended)
  
  // Radii
  nearTeammateRadius: number; // Radius to check for nearby teammates (units)
  defuseRadius: number; // Max distance for defuse opportunity (units)
  siteClusterRadius: number; // Radius for site clustering detection (units)
  
  // Time buffers
  plantBufferSeconds: number; // Buffer time needed for plant (seconds)
  defuseBufferSeconds: number; // Buffer time needed for defuse (seconds)
  defuseWithKitSeconds: number; // Time needed with kit (seconds)
  defuseWithoutKitSeconds: number; // Time needed without kit (seconds)
  
  // Pressure detection
  pressureWindowSeconds: number; // Window to check for pressure (seconds)
  pressureDamageThreshold: number; // Min damage to indicate pressure
  pressureDeathWindowSeconds: number; // Window for teammate deaths (seconds)
  
  // Duration thresholds
  stallMinSeconds: number; // Min duration for bomb carrier stall (seconds)
  opportunityMinSeconds: number; // Min duration for plant opportunity (seconds)
  siteClusterMinSeconds: number; // Min duration for site cluster detection (seconds)
  defuseOpportunityMinSeconds: number; // Min duration for defuse opportunity (seconds)
  
  // Movement thresholds
  stallMoveEps: number; // Max displacement for stall detection (units)
  lowSpeedThreshold: number; // Speed threshold for low movement (units/s)
  
  // Hopelessness thresholds
  hopelessTeammateRatio: number; // Min enemy/teammate ratio for hopeless (e.g. 4.0 = 1v4+)
  hopelessTimePrePlant: number; // Min time remaining pre-plant for hopeless (seconds)
  hopelessTimePostPlant: number; // Min time remaining post-plant for hopeless (seconds)
  
  // Scoring weights
  weights: {
    bombCarrierStall: number;
    noPlantOpportunity: number;
    badBombDrop: number;
    defuseRefusal: number;
    defuseAbort: number;
  };
  
  // Pattern multiplier
  repeatPatternMultiplier: number; // Confidence multiplier for repeated behavior
}

/**
 * Default configuration
 */
export const DEFAULT_OBJECTIVE_CONFIG: ObjectiveConfig = {
  samplingHz: 10,
  nearTeammateRadius: 200, // 200 units (~6m)
  defuseRadius: 150, // 150 units (~4.5m)
  siteClusterRadius: 300, // 300 units (~9m)
  plantBufferSeconds: 6, // Need 6s buffer for plant
  defuseBufferSeconds: 2, // Need 2s buffer for defuse
  defuseWithKitSeconds: 5,
  defuseWithoutKitSeconds: 10,
  pressureWindowSeconds: 5,
  pressureDamageThreshold: 20, // 20 HP damage
  pressureDeathWindowSeconds: 3,
  stallMinSeconds: 8, // 8s of stalling
  opportunityMinSeconds: 6, // 6s opportunity window
  siteClusterMinSeconds: 3, // 3s in cluster
  defuseOpportunityMinSeconds: 2, // 2s near bomb
  stallMoveEps: 100, // 100 units in 10s
  lowSpeedThreshold: 80, // 80 units/s
  hopelessTeammateRatio: 4.0, // 1v4+
  hopelessTimePrePlant: 15, // < 15s pre-plant
  hopelessTimePostPlant: 8, // < 8s post-plant
  weights: {
    bombCarrierStall: 0.15,
    noPlantOpportunity: 0.20,
    badBombDrop: 0.25,
    defuseRefusal: 0.25,
    defuseAbort: 0.15
  },
  repeatPatternMultiplier: 1.4
};

/**
 * Features computed for a player at a given time
 */
interface ObjectiveFeatures {
  timeLeft: number; // Seconds remaining in round
  aliveTeammates: number;
  aliveEnemies: number;
  recentPressureScore: number; // 0-1, higher = more pressure
  nearbyTeammatesCount: number;
  movementLow: boolean; // Low movement in last 3s
  engagementLow: boolean; // No shots/damage in last 10s
  hasBomb: boolean;
  isDefusing: boolean;
  isPlanting: boolean;
  distanceToBomb?: number; // If bomb is planted
  hopelessScore: number; // 0-1, higher = more hopeless
}

/**
 * An objective sabotage event
 */
export interface ObjectiveEvent {
  type: 'BombCarrierStall' | 'NoPlantOpportunity' | 'BadBombDrop' | 'DefuseRefusal' | 'DefuseAbortLowPressure';
  startTick: number;
  endTick: number;
  startTime: number;
  endTime: number;
  duration: number;
  actorId: number;
  actorName: string;
  round: number;
  confidence: number; // 0-1
  score: number; // Raw score before confidence mapping
  featuresSummary: {
    timeLeft: number;
    aliveTeammates: number;
    aliveEnemies: number;
    pressureScore: number;
    hopelessScore: number;
    [key: string]: number | boolean; // Additional type-specific features
  };
  humanReason: string;
}

/**
 * Result for a player in a round
 */
interface PlayerObjectiveResult {
  playerId: number;
  playerName: string;
  events: ObjectiveEvent[];
  objectiveScoreRound: number; // 0-1
  flagged: boolean;
  confidence: number; // 0-1
}

/**
 * Result for a round
 */
export interface ObjectiveResult {
  round: number;
  eventsByPlayer: Map<number, PlayerObjectiveResult>;
  allEvents: ObjectiveEvent[]; // Flattened for convenience
}

/**
 * Player tracking state
 */
interface PlayerTrackingState {
  playerId: number;
  playerName?: string; // Add player name for easier access
  samples: Array<{
    tick: number;
    time: number;
    position: { x: number; y: number; z?: number };
    hasBomb: boolean;
    isAlive: boolean;
    hp: number;
    isDefusing?: boolean;
    isPlanting?: boolean;
  }>;
  bombPossessionStart?: number; // Time when got bomb
  lastDamageTime: number;
  lastFireTime: number;
  defuseStartTime?: number;
  plantStartTime?: number;
}

/**
 * Bomb state tracking
 */
interface BombState {
  isPlanted: boolean;
  plantTime?: number;
  plantPosition?: { x: number; y: number; z?: number };
  explosionTime?: number;
}

/**
 * Calculate 2D distance
 */
function distance2D(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate centroid of positions
 */
function centroid(positions: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (positions.length === 0) return { x: 0, y: 0 };
  const sum = positions.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / positions.length, y: sum.y / positions.length };
}

/**
 * Extract objective features for a player
 */
function extractObjectiveFeatures(
  player: PlayerTrackingState,
  currentTick: number,
  currentTime: number,
  roundEndTime: number,
  teammates: PlayerTrackingState[],
  enemies: PlayerTrackingState[],
  bombState: BombState,
  events: GameEvent[],
  config: ObjectiveConfig,
  tickRate: number
): ObjectiveFeatures {
  const timeLeft = Math.max(0, roundEndTime - currentTime);
  const aliveTeammates = teammates.filter(t => {
    const sample = t.samples[t.samples.length - 1];
    return sample && sample.isAlive && t.playerId !== player.playerId;
  }).length;
  const aliveEnemies = enemies.filter(e => {
    const sample = e.samples[e.samples.length - 1];
    return sample && sample.isAlive;
  }).length;
  
  // Recent pressure score
  const pressureWindowTicks = Math.ceil(config.pressureWindowSeconds * tickRate);
  const recentEvents = events.filter(e => {
    const eventTick = e.tick || 0;
    return eventTick >= currentTick - pressureWindowTicks && eventTick <= currentTick;
  });
  
  let pressureScore = 0;
  const playerSample = player.samples[player.samples.length - 1];
  const playerName = player.playerName || (playerNames ? playerNames.get(player.playerId) : undefined);
  if (playerSample && playerName) {
    // Check for damage taken
    const damageEvents = recentEvents.filter(e => 
      e.type === 'damage' && e.victimName === playerName
    );
    const totalDamage = damageEvents.reduce((sum, e) => sum + (e.damage || 0), 0);
    if (totalDamage >= config.pressureDamageThreshold) {
      pressureScore = Math.min(1.0, totalDamage / 100); // Normalize to 0-1
    }
    
    // Check for teammate deaths
    const deathWindowTicks = Math.ceil(config.pressureDeathWindowSeconds * tickRate);
    const recentDeaths = events.filter(e => {
      const eventTick = e.tick || 0;
      return e.type === 'kill' && 
             eventTick >= currentTick - deathWindowTicks && 
             eventTick <= currentTick &&
             teammates.some(t => {
               const tName = t.playerName || playerNames.get(t.playerId);
               return tName === e.victimName;
             });
    });
    pressureScore = Math.max(pressureScore, recentDeaths.length * 0.3);
    
    // Check for weapon fire (combat activity)
    const fireEvents = recentEvents.filter(e => e.type === 'weapon_fire');
    if (fireEvents.length > 5) {
      pressureScore = Math.max(pressureScore, 0.4);
    }
  }
  
  // Nearby teammates
  const nearbyTeammates = teammates.filter(t => {
    if (t.playerId === player.playerId) return false;
    const tSample = t.samples[t.samples.length - 1];
    const pSample = player.samples[player.samples.length - 1];
    if (!tSample || !pSample || !tSample.isAlive) return false;
    return distance2D(tSample.position, pSample.position) <= config.nearTeammateRadius;
  }).length;
  
  // Movement low (last 3s)
  const movementWindowTicks = Math.ceil(3 * tickRate);
  const movementSamples = player.samples.filter(s => s.tick >= currentTick - movementWindowTicks);
  let movementLow = true;
  if (movementSamples.length >= 2) {
    const first = movementSamples[0];
    const last = movementSamples[movementSamples.length - 1];
    const displacement = distance2D(first.position, last.position);
    const timeDelta = last.time - first.time;
    if (timeDelta > 0) {
      const avgSpeed = displacement / timeDelta;
      movementLow = avgSpeed < config.lowSpeedThreshold;
    }
  }
  
  // Engagement low (no shots/damage in last 10s)
  const engagementWindowTicks = Math.ceil(10 * tickRate);
  const recentFire = player.lastFireTime > 0 && (currentTime - player.lastFireTime) < 10;
  const recentDamage = player.lastDamageTime > 0 && (currentTime - player.lastDamageTime) < 10;
  const engagementLow = !recentFire && !recentDamage;
  
  // Has bomb
  const hasBomb = playerSample?.hasBomb || false;
  
  // Is defusing/planting
  const isDefusing = playerSample?.isDefusing || false;
  const isPlanting = playerSample?.isPlanting || false;
  
  // Distance to bomb (if planted)
  let distanceToBomb: number | undefined;
  if (bombState.isPlanted && bombState.plantPosition && playerSample) {
    distanceToBomb = distance2D(playerSample.position, bombState.plantPosition);
  }
  
  // Hopeless score
  let hopelessScore = 0;
  if (aliveEnemies > 0 && aliveTeammates === 0) {
    const ratio = aliveEnemies / Math.max(1, aliveTeammates + 1);
    if (ratio >= config.hopelessTeammateRatio) {
      hopelessScore += 0.5;
    }
  }
  if (timeLeft < config.hopelessTimePrePlant && !bombState.isPlanted) {
    hopelessScore += 0.3;
  }
  if (timeLeft < config.hopelessTimePostPlant && bombState.isPlanted) {
    hopelessScore += 0.3;
  }
  hopelessScore = Math.min(1.0, hopelessScore);
  
  return {
    timeLeft,
    aliveTeammates,
    aliveEnemies,
    recentPressureScore: pressureScore,
    nearbyTeammatesCount: nearbyTeammates,
    movementLow,
    engagementLow,
    hasBomb,
    isDefusing,
    isPlanting,
    distanceToBomb,
    hopelessScore
  };
}

/**
 * Detect objective sabotage for a round
 */
export function detectObjectiveSabotage(
  round: Round,
  frames: MatchFrame[],
  events: GameEvent[],
  tickRate: number,
  config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG
): ObjectiveResult {
  const eventsByPlayer = new Map<number, PlayerObjectiveResult>();
  const allEvents: ObjectiveEvent[] = [];
  
  if (!round.freezeEndTick || !round.endTick) {
    return {
      round: round.number,
      eventsByPlayer,
      allEvents
    };
  }
  
  // Filter frames and events to round
  const roundFrames = frames.filter(f => 
    f.tick >= round.freezeEndTick! && 
    f.tick <= round.endTick!
  );
  
  if (roundFrames.length === 0) {
    return {
      round: round.number,
      eventsByPlayer,
      allEvents
    };
  }
  
  const roundStartTime = roundFrames[0]?.time || 0;
  const roundEndTime = roundFrames[roundFrames.length - 1]?.time || 0;
  const roundDuration = roundEndTime - roundStartTime;
  
  // Sample frames
  const sampleInterval = Math.ceil(tickRate / config.samplingHz);
  const sampledFrames: MatchFrame[] = [];
  for (let i = 0; i < roundFrames.length; i += sampleInterval) {
    sampledFrames.push(roundFrames[i]);
  }
  if (sampledFrames.length === 0 || sampledFrames[sampledFrames.length - 1] !== roundFrames[roundFrames.length - 1]) {
    sampledFrames.push(roundFrames[roundFrames.length - 1]);
  }
  
  // Initialize tracking
  const playerTracking = new Map<number, PlayerTrackingState>();
  const playerNames = new Map<number, string>();
  const bombState: BombState = { isPlanted: false };
  
  // Process events to track bomb state
  for (const event of events) {
    if (event.tick < round.freezeEndTick! || event.tick > round.endTick!) continue;
    
    if (event.type === 'plant') {
      bombState.isPlanted = true;
      const frame = roundFrames.find(f => f.tick === event.tick);
      if (frame) {
        const planter = frame.players.find(p => p.name === event.playerName);
        if (planter) {
          bombState.plantTime = frame.time;
          bombState.plantPosition = { ...planter.position };
        }
      }
    }
  }
  
  // Build player tracking
  for (const frame of sampledFrames) {
    for (const player of frame.players) {
      if (player.team === Team.SPECTATOR) continue;
      
      let tracking = playerTracking.get(player.id);
      if (!tracking) {
        tracking = {
          playerId: player.id,
          playerName: player.name,
          samples: [],
          lastDamageTime: -1,
          lastFireTime: -1
        };
        playerTracking.set(player.id, tracking);
        playerNames.set(player.id, player.name);
      }
      
      // Update from events
      const frameEvents = events.filter(e => e.tick === frame.tick);
      for (const event of frameEvents) {
        if (event.type === 'damage' && event.victimName === player.name) {
          tracking.lastDamageTime = frame.time;
        }
        if (event.type === 'weapon_fire' && event.playerName === player.name) {
          tracking.lastFireTime = frame.time;
        }
      }
      
      // Track bomb possession
      if (player.hasBomb && !tracking.bombPossessionStart) {
        tracking.bombPossessionStart = frame.time;
      } else if (!player.hasBomb && tracking.bombPossessionStart) {
        tracking.bombPossessionStart = undefined;
      }
      
      tracking.samples.push({
        tick: frame.tick,
        time: frame.time,
        position: { ...player.position },
        hasBomb: player.hasBomb,
        isAlive: player.isAlive,
        hp: player.hp,
        isDefusing: false, // Would need to be extracted from events
        isPlanting: false // Would need to be extracted from events
      });
      
      // Keep only recent samples
      const windowTicks = Math.ceil(10 * tickRate);
      tracking.samples = tracking.samples.filter(s => s.tick >= frame.tick - windowTicks);
    }
  }
  
  // Group players by team
  const teams = new Map<Team, PlayerTrackingState[]>();
  for (const tracking of playerTracking.values()) {
    const playerState = roundFrames[0]?.players.find(p => p.id === tracking.playerId);
    if (!playerState || playerState.team === Team.SPECTATOR) continue;
    
    if (!teams.has(playerState.team)) {
      teams.set(playerState.team, []);
    }
    teams.get(playerState.team)!.push(tracking);
  }
  
  // Analyze each team
  for (const [team, teamPlayers] of teams.entries()) {
    const enemyTeam = team === Team.CT ? Team.T : Team.CT;
    const enemies = teams.get(enemyTeam) || [];
    
    for (const player of teamPlayers) {
      const playerEvents: ObjectiveEvent[] = [];
      
      // Detect BombCarrierStall
      detectBombCarrierStall(player, sampledFrames, teamPlayers, enemies, events, bombState, config, tickRate, round.number, playerNames, playerEvents);
      
      // Detect NoPlantOpportunity
      detectNoPlantOpportunity(player, sampledFrames, teamPlayers, enemies, events, bombState, config, tickRate, round.number, playerNames, playerEvents);
      
      // Detect BadBombDrop
      detectBadBombDrop(player, sampledFrames, teamPlayers, events, bombState, config, tickRate, round.number, playerNames, playerEvents);
      
      // Detect DefuseRefusal (CT only)
      if (team === Team.CT && bombState.isPlanted) {
        detectDefuseRefusal(player, sampledFrames, enemies, events, bombState, config, tickRate, round.number, playerNames, playerEvents);
      }
      
      // Detect DefuseAbortLowPressure (CT only)
      if (team === Team.CT && bombState.isPlanted) {
        detectDefuseAbort(player, sampledFrames, enemies, events, bombState, config, tickRate, round.number, playerNames, playerEvents);
      }
      
      if (playerEvents.length > 0) {
        // Calculate round score
        const objectiveScoreRound = playerEvents.reduce((sum, e) => 
          sum + e.score * config.weights[e.type as keyof typeof config.weights], 0
        );
        const flagged = objectiveScoreRound > 0.5 || playerEvents.some(e => e.confidence > 0.7);
        const confidence = Math.min(1.0, objectiveScoreRound);
        
        eventsByPlayer.set(player.playerId, {
          playerId: player.playerId,
          playerName: playerNames.get(player.playerId) || 'Unknown',
          events: playerEvents,
          objectiveScoreRound,
          flagged,
          confidence
        });
        
        allEvents.push(...playerEvents);
      }
    }
  }
  
  return {
    round: round.number,
    eventsByPlayer,
    allEvents
  };
}

/**
 * Detect bomb carrier stall
 */
function detectBombCarrierStall(
  player: PlayerTrackingState,
  frames: MatchFrame[],
  teammates: PlayerTrackingState[],
  enemies: PlayerTrackingState[],
  events: GameEvent[],
  bombState: BombState,
  config: ObjectiveConfig,
  tickRate: number,
  roundNumber: number,
  playerNames: Map<number, string>,
  resultEvents: ObjectiveEvent[]
): void {
  if (bombState.isPlanted) return; // Only pre-plant
  
  let stallStart: number | undefined;
  let stallStartTick: number | undefined;
  
  for (const frame of frames) {
    const playerSample = player.samples.find(s => s.tick === frame.tick);
    if (!playerSample || !playerSample.hasBomb || !playerSample.isAlive) {
      if (stallStart !== undefined) {
        const duration = frame.time - stallStart;
        if (duration >= config.stallMinSeconds) {
          // Check if this is a valid stall
          const features = extractObjectiveFeatures(
            player,
            stallStartTick!,
            stallStart,
            frame.time,
            teammates,
            enemies,
            bombState,
            events,
            config,
            tickRate,
            playerNames
          );
          
          if (features.timeLeft > config.plantBufferSeconds &&
              features.recentPressureScore < 0.5 &&
              features.hopelessScore < 0.7) {
            const score = Math.min(1.0, duration / 20.0); // Normalize to 20s
            const confidence = score * (1 - features.hopelessScore) * (1 - features.recentPressureScore * 0.5);
            
            resultEvents.push({
              type: 'BombCarrierStall',
              startTick: stallStartTick!,
              endTick: frame.tick,
              startTime: stallStart,
              endTime: frame.time,
              duration,
              actorId: player.playerId,
              actorName: playerNames.get(player.playerId) || 'Unknown',
              round: roundNumber,
              confidence,
              score,
              featuresSummary: {
                timeLeft: features.timeLeft,
                aliveTeammates: features.aliveTeammates,
                aliveEnemies: features.aliveEnemies,
                pressureScore: features.recentPressureScore,
                hopelessScore: features.hopelessScore,
                movementLow: features.movementLow ? 1 : 0
              },
              humanReason: `Carried bomb for ${duration.toFixed(1)}s without planting (${features.timeLeft.toFixed(1)}s remaining, low pressure)`
            });
          }
        }
        stallStart = undefined;
      }
      continue;
    }
    
    const features = extractObjectiveFeatures(
      player,
      frame.tick,
      frame.time,
      frame.time + 100, // Estimate round end
      teammates,
      enemies,
      bombState,
      events,
      config,
      tickRate
    );
    
    // Check stall conditions
    if (features.timeLeft > config.plantBufferSeconds &&
        features.movementLow &&
        features.recentPressureScore < 0.5 &&
        features.hopelessScore < 0.7) {
      if (stallStart === undefined) {
        stallStart = frame.time;
        stallStartTick = frame.tick;
      }
    } else {
      if (stallStart !== undefined) {
        const duration = frame.time - stallStart;
        if (duration >= config.stallMinSeconds) {
          const score = Math.min(1.0, duration / 20.0);
          const confidence = score * (1 - features.hopelessScore) * (1 - features.recentPressureScore * 0.5);
          
          resultEvents.push({
            type: 'BombCarrierStall',
            startTick: stallStartTick!,
            endTick: frame.tick,
            startTime: stallStart,
            endTime: frame.time,
            duration,
            actorId: player.playerId,
            actorName: playerNames.get(player.playerId) || 'Unknown',
            round: roundNumber,
            confidence,
            score,
            featuresSummary: {
              timeLeft: features.timeLeft,
              aliveTeammates: features.aliveTeammates,
              aliveEnemies: features.aliveEnemies,
              pressureScore: features.recentPressureScore,
              hopelessScore: features.hopelessScore,
              movementLow: features.movementLow ? 1 : 0
            },
            humanReason: `Carried bomb for ${duration.toFixed(1)}s without planting (${features.timeLeft.toFixed(1)}s remaining, low pressure)`
          });
        }
        stallStart = undefined;
      }
    }
  }
}

/**
 * Detect no plant opportunity
 */
function detectNoPlantOpportunity(
  player: PlayerTrackingState,
  frames: MatchFrame[],
  teammates: PlayerTrackingState[],
  enemies: PlayerTrackingState[],
  events: GameEvent[],
  bombState: BombState,
  config: ObjectiveConfig,
  tickRate: number,
  roundNumber: number,
  playerNames: Map<number, string>,
  resultEvents: ObjectiveEvent[]
): void {
  if (bombState.isPlanted) return;
  
  // Detect site cluster (map-agnostic)
  let clusterStart: number | undefined;
  let clusterStartTick: number | undefined;
  let clusterCentroid: { x: number; y: number } | undefined;
  
  for (const frame of frames) {
    const playerSample = player.samples.find(s => s.tick === frame.tick);
    if (!playerSample || !playerSample.hasBomb || !playerSample.isAlive) {
      clusterStart = undefined;
      continue;
    }
    
    // Find nearby teammates
    const nearbyTeammates = teammates.filter(t => {
      if (t.playerId === player.playerId) return false;
      const tSample = t.samples.find(s => s.tick === frame.tick);
      if (!tSample || !tSample.isAlive) return false;
      return distance2D(tSample.position, playerSample.position) <= config.siteClusterRadius;
    });
    
    if (nearbyTeammates.length >= 2) {
      // Check if cluster is stable
      const positions = [playerSample.position, ...nearbyTeammates.map(t => {
        const s = t.samples.find(s => s.tick === frame.tick);
        return s?.position || { x: 0, y: 0 };
      })];
      const newCentroid = centroid(positions);
      
      if (clusterStart === undefined) {
        clusterStart = frame.time;
        clusterStartTick = frame.tick;
        clusterCentroid = newCentroid;
      } else if (clusterCentroid) {
        const centroidMovement = distance2D(clusterCentroid, newCentroid);
        if (centroidMovement > 100) {
          // Cluster moved too much, reset
          clusterStart = frame.time;
          clusterStartTick = frame.tick;
          clusterCentroid = newCentroid;
        }
      }
      
      // Check if opportunity window is long enough
      if (clusterStart !== undefined) {
        const duration = frame.time - clusterStart;
        if (duration >= config.opportunityMinSeconds) {
          const features = extractObjectiveFeatures(
            player,
            frame.tick,
            frame.time,
            frame.time + 100,
            teammates,
            enemies,
            bombState,
            events,
            config,
            tickRate
          );
          
          // Check if plant was attempted
          const plantEvents = events.filter(e => 
            e.type === 'plant' && 
            e.tick >= clusterStartTick! && 
            e.tick <= frame.tick &&
            e.playerName === playerNames.get(player.playerId)
          );
          
          if (plantEvents.length === 0 &&
              features.timeLeft >= config.plantBufferSeconds &&
              features.recentPressureScore < 0.5 &&
              features.hopelessScore < 0.7) {
            const score = Math.min(1.0, duration / 15.0);
            const confidence = score * (1 - features.hopelessScore) * (1 - features.recentPressureScore * 0.5);
            
            resultEvents.push({
              type: 'NoPlantOpportunity',
              startTick: clusterStartTick!,
              endTick: frame.tick,
              startTime: clusterStart,
              endTime: frame.time,
              duration,
              actorId: player.playerId,
              actorName: playerNames.get(player.playerId) || 'Unknown',
              round: roundNumber,
              confidence,
              score,
              featuresSummary: {
                timeLeft: features.timeLeft,
                aliveTeammates: features.aliveTeammates,
                aliveEnemies: features.aliveEnemies,
                pressureScore: features.recentPressureScore,
                hopelessScore: features.hopelessScore,
                nearbyTeammates: nearbyTeammates.length
              },
              humanReason: `Had plant opportunity for ${duration.toFixed(1)}s (${nearbyTeammates.length} teammates nearby, ${features.timeLeft.toFixed(1)}s remaining) but didn't plant`
            });
            
            clusterStart = undefined; // Reset after flagging
          }
        }
      }
    } else {
      clusterStart = undefined;
    }
  }
}

/**
 * Detect bad bomb drop
 */
function detectBadBombDrop(
  player: PlayerTrackingState,
  frames: MatchFrame[],
  teammates: PlayerTrackingState[],
  events: GameEvent[],
  bombState: BombState,
  config: ObjectiveConfig,
  tickRate: number,
  roundNumber: number,
  playerNames: Map<number, string>,
  resultEvents: ObjectiveEvent[]
): void {
  // Find bomb drop events
  const dropEvents: Array<{ tick: number; time: number }> = [];
  
  for (let i = 1; i < player.samples.length; i++) {
    const prev = player.samples[i - 1];
    const curr = player.samples[i];
    if (prev.hasBomb && !curr.hasBomb && curr.isAlive) {
      dropEvents.push({ tick: curr.tick, time: curr.time });
    }
  }
  
  for (const drop of dropEvents) {
    const frame = frames.find(f => f.tick === drop.tick);
    if (!frame) continue;
    
    const features = extractObjectiveFeatures(
      player,
      drop.tick,
      drop.time,
      drop.time + 100,
      teammates,
      [],
      bombState,
      events,
      config,
      tickRate
    );
    
    // Check if drop is bad
    let score = 0;
    let reasonParts: string[] = [];
    
    // Drop while teammates nearby (unnecessary)
    if (features.nearbyTeammatesCount >= 1 && features.recentPressureScore < 0.3) {
      score += 0.4;
      reasonParts.push('teammates nearby');
    }
    
    // Check if enemy picks up (strong evidence)
    const pickupWindowTicks = Math.ceil(5 * tickRate);
    const enemyPickups = events.filter(e => 
      e.type === 'bombPickup' && // Would need to be in event types
      e.tick >= drop.tick && 
      e.tick <= drop.tick + pickupWindowTicks &&
      e.playerName !== playerNames.get(player.playerId)
    );
    if (enemyPickups.length > 0) {
      score += 0.6;
      reasonParts.push('enemy picked up');
    }
    
    // Drop in early/mid round with low pressure
    if (features.timeLeft > 30 && features.recentPressureScore < 0.3) {
      score += 0.3;
      reasonParts.push('low pressure');
    }
    
    if (score > 0.3) {
      const confidence = Math.min(1.0, score * (1 - features.recentPressureScore));
      
      resultEvents.push({
        type: 'BadBombDrop',
        startTick: drop.tick,
        endTick: drop.tick,
        startTime: drop.time,
        endTime: drop.time,
        duration: 0,
        actorId: player.playerId,
        actorName: playerNames.get(player.playerId) || 'Unknown',
        round: roundNumber,
        confidence,
        score,
        featuresSummary: {
          timeLeft: features.timeLeft,
          aliveTeammates: features.aliveTeammates,
          aliveEnemies: features.aliveEnemies,
          pressureScore: features.recentPressureScore,
          hopelessScore: features.hopelessScore,
          nearbyTeammates: features.nearbyTeammatesCount,
          enemyPickup: enemyPickups.length > 0 ? 1 : 0
        },
        humanReason: `Dropped bomb (${reasonParts.join(', ')})`
      });
    }
  }
}

/**
 * Detect defuse refusal
 */
function detectDefuseRefusal(
  player: PlayerTrackingState,
  frames: MatchFrame[],
  enemies: PlayerTrackingState[],
  events: GameEvent[],
  bombState: BombState,
  config: ObjectiveConfig,
  tickRate: number,
  roundNumber: number,
  playerNames: Map<number, string>,
  resultEvents: ObjectiveEvent[]
): void {
  if (!bombState.isPlanted || !bombState.plantPosition) return;
  
  let opportunityStart: number | undefined;
  let opportunityStartTick: number | undefined;
  
  for (const frame of frames) {
    const playerSample = player.samples.find(s => s.tick === frame.tick);
    if (!playerSample || !playerSample.isAlive) {
      opportunityStart = undefined;
      continue;
    }
    
    const distance = distance2D(playerSample.position, bombState.plantPosition);
    const features = extractObjectiveFeatures(
      player,
      frame.tick,
      frame.time,
      frame.time + 100,
      [],
      enemies,
      bombState,
      events,
      config,
      tickRate
    );
    
    // Check defuse opportunity
    const requiredTime = config.defuseWithoutKitSeconds + config.defuseBufferSeconds;
    const timeToExplosion = bombState.explosionTime ? (bombState.explosionTime - frame.time) : features.timeLeft;
    
    if (distance <= config.defuseRadius &&
        timeToExplosion >= requiredTime &&
        features.recentPressureScore < 0.5 &&
        features.hopelessScore < 0.8) {
      if (opportunityStart === undefined) {
        opportunityStart = frame.time;
        opportunityStartTick = frame.tick;
      }
      
      const duration = frame.time - opportunityStart;
      if (duration >= config.defuseOpportunityMinSeconds) {
        // Check if defuse was attempted
        const defuseEvents = events.filter(e => 
          (e.type === 'defuse' || e.type === 'defuseStart') &&
          e.tick >= opportunityStartTick! &&
          e.tick <= frame.tick &&
          e.playerName === playerNames.get(player.playerId)
        );
        
        if (defuseEvents.length === 0) {
          const score = Math.min(1.0, duration / 10.0);
          const confidence = score * (1 - features.hopelessScore) * (1 - features.recentPressureScore * 0.5);
          
          resultEvents.push({
            type: 'DefuseRefusal',
            startTick: opportunityStartTick!,
            endTick: frame.tick,
            startTime: opportunityStart,
            endTime: frame.time,
            duration,
            actorId: player.playerId,
            actorName: playerNames.get(player.playerId) || 'Unknown',
            round: roundNumber,
            confidence,
            score,
            featuresSummary: {
              timeLeft: timeToExplosion,
              aliveTeammates: features.aliveTeammates,
              aliveEnemies: features.aliveEnemies,
              pressureScore: features.recentPressureScore,
              hopelessScore: features.hopelessScore,
              distanceToBomb: distance
            },
            humanReason: `Near bomb for ${duration.toFixed(1)}s (${timeToExplosion.toFixed(1)}s until explosion) but didn't defuse`
          });
          
          opportunityStart = undefined; // Reset after flagging
        }
      }
    } else {
      opportunityStart = undefined;
    }
  }
}

/**
 * Detect defuse abort without pressure
 */
function detectDefuseAbort(
  player: PlayerTrackingState,
  frames: MatchFrame[],
  enemies: PlayerTrackingState[],
  events: GameEvent[],
  bombState: BombState,
  config: ObjectiveConfig,
  tickRate: number,
  roundNumber: number,
  playerNames: Map<number, string>,
  resultEvents: ObjectiveEvent[]
): void {
  if (!bombState.isPlanted || !bombState.plantPosition) return;
  
  // Track defuse start/stop sequences
  let defuseStart: number | undefined;
  let defuseStartTick: number | undefined;
  
  for (const frame of frames) {
    const playerSample = player.samples.find(s => s.tick === frame.tick);
    if (!playerSample || !playerSample.isAlive) continue;
    
    // Check for defuse events (would need to be extracted from events)
    const defuseStartEvents = events.filter(e => 
      e.type === 'defuseStart' &&
      e.tick === frame.tick &&
      e.playerName === playerNames.get(player.playerId)
    );
    
    const defuseStopEvents = events.filter(e => 
      e.type === 'defuseStop' &&
      e.tick === frame.tick &&
      e.playerName === playerNames.get(player.playerId)
    );
    
    if (defuseStartEvents.length > 0 && defuseStart === undefined) {
      defuseStart = frame.time;
      defuseStartTick = frame.tick;
    }
    
    if (defuseStopEvents.length > 0 && defuseStart !== undefined) {
      const abortDuration = frame.time - defuseStart;
      const features = extractObjectiveFeatures(
        player,
        frame.tick,
        frame.time,
        frame.time + 100,
        [],
        enemies,
        bombState,
        events,
        config,
        tickRate
      );
      
      // Check if abort is suspicious
      if (abortDuration < 1.5 && // Quick abort
          features.recentPressureScore < 0.3 && // Low pressure
          features.hopelessScore < 0.8) {
        // Check if player re-attempts soon
        const reattemptWindowTicks = Math.ceil(3 * tickRate);
        const reattempts = events.filter(e => 
          e.type === 'defuseStart' &&
          e.tick > frame.tick &&
          e.tick <= frame.tick + reattemptWindowTicks &&
          e.playerName === playerNames.get(player.playerId)
        );
        
        if (reattempts.length === 0) {
          const score = 0.7; // High score for abort without reattempt
          const confidence = score * (1 - features.recentPressureScore);
          
          resultEvents.push({
            type: 'DefuseAbortLowPressure',
            startTick: defuseStartTick!,
            endTick: frame.tick,
            startTime: defuseStart,
            endTime: frame.time,
            duration: abortDuration,
            actorId: player.playerId,
            actorName: playerNames.get(player.playerId) || 'Unknown',
            round: roundNumber,
            confidence,
            score,
            featuresSummary: {
              timeLeft: features.timeLeft,
              aliveTeammates: features.aliveTeammates,
              aliveEnemies: features.aliveEnemies,
              pressureScore: features.recentPressureScore,
              hopelessScore: features.hopelessScore,
              abortDuration
            },
            humanReason: `Started defuse then aborted after ${abortDuration.toFixed(1)}s (low pressure, no reattempt)`
          });
        }
      }
      
      defuseStart = undefined;
    }
  }
}

