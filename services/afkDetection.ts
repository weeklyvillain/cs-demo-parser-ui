/**
 * AFK Detection at Round Start
 * 
 * Detects players who are AFK (Away From Keyboard) at the start of each round.
 * Players are considered AFK if they don't move or perform actions for a specified
 * duration after freeze time ends.
 */

import { DemoFile, Team, PlayerState } from '../types';

export interface AFKDetection {
  playerId: number;
  playerName: string;
  team: Team;
  round: number;
  startTick: number;
  freezeEndTick?: number;
  afkDuration: number; // Total seconds the player was AFK (full duration, not capped)
  timeToFirstMovement?: number; // seconds from freeze end to first movement (if moved)
  reason: 'no_movement' | 'no_actions' | 'both';
  startAfkTick?: number; // Tick when AFK period started (freezeEndTick)
  endAfkTick?: number; // Tick when AFK period ended (when they moved, died, or round ended)
  diedWhileAFK?: boolean; // True if player died during the AFK interval
}

export interface AFKDetectionConfig {
  afkThresholdSeconds?: number; // Consider AFK if no movement/actions for this many seconds (default: 5)
  movementThreshold?: number; // Minimum distance moved to not be considered AFK (default: 3)
}

const DEFAULT_CONFIG: Required<AFKDetectionConfig> = {
  afkThresholdSeconds: 5,
  movementThreshold: 3
};

/**
 * Detect AFK players at round start
 */
export function detectAFKPlayers(
  demoFile: DemoFile,
  config: AFKDetectionConfig = {}
): AFKDetection[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const detections: AFKDetection[] = [];
  const tickRate = demoFile.tickRate;
  const MOVE_EPS = cfg.movementThreshold;

  for (let roundIndex = 0; roundIndex < demoFile.rounds.length; roundIndex++) {
    const round = demoFile.rounds[roundIndex];
    if (!round.startTick) continue;

    // Round timing: freezeEndTick is roundStart
    const freezeEndTick = round.freezeEndTick || round.startTick;
    const roundEndTick = round.endTick || (demoFile.frames.length > 0 
      ? demoFile.frames[demoFile.frames.length - 1].tick 
      : freezeEndTick);
    
    // 5 second grace window: [freezeEndTick, freezeEndTick + 5s)
    const gracePeriodSeconds = 5;
    const gracePeriodTicks = Math.ceil(gracePeriodSeconds * tickRate);
    const gracePeriodEndTick = freezeEndTick + gracePeriodTicks;
    
    // Process ALL frames from freezeEnd to roundEnd (not just after grace period)
    const allFrames = demoFile.frames.filter(
      f => f.tick >= freezeEndTick && f.tick <= roundEndTick
    );
    
    if (allFrames.length === 0) continue;
    
    // Track each player's state
    const playerTracking = new Map<number, {
      player: PlayerState;
      initialPosition: { x: number; y: number };
      lastPosition: { x: number; y: number };
      movedDuringGracePeriod: boolean; // If true, player is NOT AFK
      isAFK: boolean; // True if player is currently AFK (started at freezeEndTick)
      firstMovementTick?: number; // When player first moved (ends AFK)
      deathTick?: number; // When player died (ends AFK)
      lastStillTick: number; // Last tick where player was still
      firstSeenTick?: number; // First tick where player was seen alive in this round
    }>();

    // Process all frames from freezeEnd to roundEnd
    // Initialize tracking for players as we encounter them (not just at freeze end)
    for (const frame of allFrames) {
      for (const currentPlayer of frame.players) {
        // Skip spectators
        if (currentPlayer.team === Team.SPECTATOR) continue;
        
        // Get or create tracking for this player
        let tracking = playerTracking.get(currentPlayer.id);
        
        // If player not tracked yet, initialize them
        if (!tracking) {
          // Track all players, even if they're dead when first seen
          // They might have been alive earlier or might become alive later
          tracking = {
            player: currentPlayer,
            initialPosition: { x: currentPlayer.position.x, y: currentPlayer.position.y },
            lastPosition: { x: currentPlayer.position.x, y: currentPlayer.position.y },
            movedDuringGracePeriod: false,
            isAFK: false,
            lastStillTick: frame.tick,
            firstSeenTick: frame.tick
          };
          playerTracking.set(currentPlayer.id, tracking);
          
          // If player first appears after grace period, we'll check their movement separately
          // Don't mark them as moved yet - they might still be AFK
        }
        
        // Skip if tracking doesn't exist (shouldn't happen, but safety check)
        if (!tracking) continue;
        
        // Check if player died
        if (!currentPlayer.isAlive) {
          if (!tracking.deathTick) {
            tracking.deathTick = frame.tick;
          }
          // If player was AFK and died, mark it
          if (tracking.isAFK) {
            // AFK ends at death
          }
          continue;
        }

        // Check for movement: distance from last position > MOVE_EPS
        const distance = Math.sqrt(
          Math.pow(currentPlayer.position.x - tracking.lastPosition.x, 2) +
          Math.pow(currentPlayer.position.y - tracking.lastPosition.y, 2)
        );
        
        const hasMoved = distance > MOVE_EPS;
        
        // Update last position
        tracking.lastPosition = { x: currentPlayer.position.x, y: currentPlayer.position.y };
        
        if (hasMoved) {
          // Player moved - record first movement tick
          if (!tracking.firstMovementTick) {
            tracking.firstMovementTick = frame.tick;
          }
          
          // If during grace period, mark that they moved (they're NOT AFK)
          if (frame.tick < gracePeriodEndTick) {
            tracking.movedDuringGracePeriod = true;
          }
          
          // If AFK, movement ends the AFK period
          if (tracking.isAFK) {
            // AFK ends at first movement
          }
        } else {
          // Player is still - update last still tick
          tracking.lastStillTick = frame.tick;
        }
      }
    }

    // After processing all frames, determine AFK status
    // Rule: If player did NOT move during grace period (or didn't appear until after), 
    // and they don't move for a long time, they are AFK
    const MIN_AFK_THRESHOLD_SECONDS = cfg.afkThresholdSeconds;
    
    // Debug: Log tracking info for round 1
    if (round.number === 1) {
      console.log(`[AFK Debug Round 1] Tracking ${playerTracking.size} players`);
      for (const [playerId, tracking] of playerTracking.entries()) {
        console.log(`  Player ${tracking.player.name}: firstSeen=${tracking.firstSeenTick}, movedDuringGrace=${tracking.movedDuringGracePeriod}, firstMovement=${tracking.firstMovementTick}, death=${tracking.deathTick}`);
      }
    }
    
    for (const [playerId, tracking] of playerTracking.entries()) {
      // Skip players who moved during grace period - they're NOT AFK
      if (tracking.movedDuringGracePeriod) {
        continue;
      }
      
      // Determine when player first appeared relative to grace period
      const firstSeenTick = tracking.firstSeenTick || freezeEndTick;
      
      // Determine when AFK starts:
      // - If player was present at freeze end (or appeared during grace period), AFK starts at freezeEndTick
      // - If player appeared after grace period, AFK starts when they first appeared (they're stationary from that point)
      let startAfkTick: number;
      if (firstSeenTick <= gracePeriodEndTick) {
        // Player was present during or before grace period - AFK starts at round start
        startAfkTick = freezeEndTick;
      } else {
        // Player appeared after grace period - AFK starts when they first appeared
        // But only if they don't move for a long time after appearing
        startAfkTick = firstSeenTick;
      }
      
      // Determine when AFK ends:
      // 1. Player moved → endAfkTick = firstMovementTick
      // 2. Player died → endAfkTick = deathTick, diedWhileAFK = true
      // 3. Round ended → endAfkTick = roundEndTick
      let endAfkTick: number;
      let diedWhileAFK = false;
      
      if (tracking.firstMovementTick) {
        endAfkTick = tracking.firstMovementTick;
      } else if (tracking.deathTick) {
        endAfkTick = tracking.deathTick;
        diedWhileAFK = true;
      } else {
        endAfkTick = roundEndTick;
      }
      
      // Calculate AFK duration
      const afkDuration = (endAfkTick - startAfkTick) / tickRate;
      
      // Only report if AFK duration >= threshold
      if (afkDuration >= MIN_AFK_THRESHOLD_SECONDS) {
        // For players who appeared after grace period, make sure they were stationary for the full duration
        // (i.e., they didn't move at all from when they appeared)
        if (firstSeenTick > gracePeriodEndTick && tracking.firstMovementTick) {
          // Player appeared late but moved - not AFK
          if (round.number === 1) {
            console.log(`[AFK Debug Round 1] Skipping ${tracking.player.name}: appeared late but moved`);
          }
          continue;
        }
        
        // Debug: Log detection for round 1
        if (round.number === 1) {
          console.log(`[AFK Debug Round 1] Detected AFK: ${tracking.player.name}, duration=${afkDuration.toFixed(2)}s, startTick=${startAfkTick}, endTick=${endAfkTick}`);
        }
        
        detections.push({
          playerId,
          playerName: tracking.player.name,
          team: tracking.player.team,
          round: round.number,
          startTick: round.startTick,
          freezeEndTick: round.freezeEndTick,
          afkDuration,
          timeToFirstMovement: tracking.firstMovementTick 
            ? (tracking.firstMovementTick - startAfkTick) / tickRate 
            : undefined,
          reason: 'no_movement', // Simplified for now
          startAfkTick,
          endAfkTick,
          diedWhileAFK
        });
      }
    }
  }

  return detections;
}
