import { DemoFile, MatchFrame, Team, PlayerState } from '../types';

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

export interface TeamKill {
  round: number;
  tick: number;
  time: number; // seconds
  attackerId: number;
  attackerName: string;
  attackerTeam: Team;
  victimId: number;
  victimName: string;
  victimTeam: Team;
  weapon: string;
  isHeadshot: boolean;
}

export interface TeamDamage {
  round: number;
  tick: number;
  time: number; // seconds
  attackerId: number;
  attackerName: string;
  attackerTeam: Team;
  victimId: number;
  victimName: string;
  victimTeam: Team;
  damage: number;
  weapon?: string;
  groupId?: number; // ID for grouping related damage events
  initialHP?: number; // HP before damage
  finalHP?: number; // HP after damage
}

export interface DisconnectReconnect {
  playerId: number;
  playerName: string;
  team: Team;
  disconnectTick: number;
  disconnectTime: number; // seconds
  disconnectRound: number; // Round when player disconnected
  reconnectTick?: number;
  reconnectTime?: number; // seconds
  reconnectRound?: number; // Round when player reconnected
  duration?: number; // seconds disconnected (if reconnected)
  roundsMissed?: number; // Number of rounds the player was disconnected for
  diedBeforeDisconnect?: boolean; // True if player died in the disconnect round (didn't miss that round)
  reconnectedBeforeFreezeEnd?: boolean; // True if player reconnected before freeze time ended (playing reconnect round)
}

export interface TeamFlash {
  round: number;
  tick: number;
  time: number; // seconds
  throwerId: number;
  throwerName: string;
  throwerTeam: Team;
  victimId: number;
  victimName: string;
  victimTeam: Team;
  flashDuration: number; // Duration in seconds that the victim was flashed
  flashPosition: { x: number; y: number; z?: number }; // Where flashbang detonated
  victimPosition: { x: number; y: number; z?: number }; // Where victim was when flashed
}

export interface AnalysisResults {
  afkDetections: AFKDetection[];
  teamKills: TeamKill[];
  teamDamage: TeamDamage[];
  disconnects: DisconnectReconnect[];
  teamFlashes: TeamFlash[];
}

export interface AnalysisProgress {
  percentage: number;
  currentStep: string;
  estimatedTimeRemaining: number; // in seconds
}

/**
 * Analyzes a demo file to detect:
 * - AFK players at round start
 * - Team kills
 * - Team damage
 */
export class DemoAnalyzer {
  private demoFile: DemoFile;
  private afkThresholdSeconds: number = 5; // Consider AFK if no movement/actions for 10 seconds after round start
  private movementThreshold: number = 3; // Minimum distance moved to not be considered AFK (MOVE_EPS: 2-5 units to ignore jitter)
  private progressCallback?: (progress: AnalysisProgress) => void;
  private startTime: number = 0;
  private lastProgressUpdate: number = 0;
  private progressThrottleMs: number = 100; // Update UI at most every 100ms

  constructor(
    demoFile: DemoFile, 
    options?: { 
      afkThresholdSeconds?: number; 
      movementThreshold?: number;
      progressCallback?: (progress: AnalysisProgress) => void;
    }
  ) {
    this.demoFile = demoFile;
    if (options?.afkThresholdSeconds) {
      this.afkThresholdSeconds = options.afkThresholdSeconds;
    }
    if (options?.movementThreshold) {
      this.movementThreshold = options.movementThreshold;
    }
    if (options?.progressCallback) {
      this.progressCallback = options.progressCallback;
    }
  }

  private reportProgress(percentage: number, currentStep: string) {
    if (!this.progressCallback) return;
    
    const now = Date.now();
    // Throttle updates to avoid overwhelming React
    if (now - this.lastProgressUpdate < this.progressThrottleMs && percentage < 100) {
      return;
    }
    this.lastProgressUpdate = now;
    
    const elapsed = (now - this.startTime) / 1000; // seconds
    const estimatedTotal = percentage > 0 ? elapsed / (percentage / 100) : 0;
    const estimatedRemaining = Math.max(0, estimatedTotal - elapsed);
    
    this.progressCallback({
      percentage: Math.min(100, Math.max(0, percentage)),
      currentStep,
      estimatedTimeRemaining: estimatedRemaining
    });
  }

  /**
   * Run all analyses
   */
  public analyze(): AnalysisResults {
    this.startTime = Date.now();
    this.lastProgressUpdate = 0;
    
    this.reportProgress(0, 'Starting analysis...');
    
    // AFK detection (0-30%)
    this.reportProgress(5, 'Detecting AFK players...');
    const afkDetections = this.detectAFKPlayers();
    this.reportProgress(30, `Found ${afkDetections.length} AFK detections`);
    
    // Team kills (30-55%)
    this.reportProgress(35, 'Detecting team kills...');
    const teamKills = this.detectTeamKills();
    this.reportProgress(55, `Found ${teamKills.length} team kills`);
    
    // Team damage (55-80%)
    this.reportProgress(60, 'Detecting team damage...');
    const teamDamage = this.detectTeamDamage();
    this.reportProgress(80, `Found ${teamDamage.length} team damage events`);
    
    // Disconnects/Reconnects (80-90%)
    this.reportProgress(85, 'Detecting disconnects and reconnects...');
    const disconnects = this.detectDisconnects();
    this.reportProgress(90, `Found ${disconnects.length} disconnect events`);

    // Team Flashes (90-100%)
    this.reportProgress(92, 'Detecting team flashes...');
    let teamFlashes: TeamFlash[] = [];
    try {
      teamFlashes = this.detectTeamFlashes();
    } catch (err: any) {
      console.warn('Team flash detection failed:', err.message || err);
      // Continue with empty array - don't break the entire analysis
    }
    this.reportProgress(100, `Found ${teamFlashes.length} team flash events`);

    return {
      afkDetections,
      teamKills,
      teamDamage,
      disconnects,
      teamFlashes
    };
  }

  /**
   * Detect players who appear AFK at the start of rounds
   * A player is considered AFK if they:
   * - Don't move significantly (less than movementThreshold units)
   * - Don't perform actions (shoot, use items, etc.)
   * - For at least afkThresholdSeconds after round start
   */
  private detectAFKPlayers(): AFKDetection[] {
    const detections: AFKDetection[] = [];
    const tickRate = this.demoFile.tickRate;
    const totalRounds = this.demoFile.rounds.length;
    const MOVE_EPS = this.movementThreshold; // 2-5 units to ignore jitter

    for (let roundIndex = 0; roundIndex < this.demoFile.rounds.length; roundIndex++) {
      const round = this.demoFile.rounds[roundIndex];
      
      // Report progress: 5% to 40% (35% range for AFK detection)
      if (totalRounds > 0) {
        const progress = 5 + (roundIndex / totalRounds) * 35;
        this.reportProgress(progress, `Analyzing round ${round.number} for AFK players...`);
      }
      if (!round.startTick) continue;

      // Round timing: freezeEndTick is roundStart
      const freezeEndTick = round.freezeEndTick || round.startTick;
      const roundEndTick = round.endTick || (this.demoFile.frames.length > 0 
        ? this.demoFile.frames[this.demoFile.frames.length - 1].tick 
        : freezeEndTick);
      
      // 5 second grace window: [freezeEndTick, freezeEndTick + 5s)
      const gracePeriodSeconds = 5;
      const gracePeriodTicks = Math.ceil(gracePeriodSeconds * tickRate);
      const gracePeriodEndTick = freezeEndTick + gracePeriodTicks;
      
      // Find frame at freeze end to record initial positions
      const freezeEndFrame = this.demoFile.frames.find(f => f.tick >= freezeEndTick);
      if (!freezeEndFrame) continue;
      
      // Process ALL frames from freezeEnd to roundEnd (not just after grace period)
      const allFrames = this.demoFile.frames.filter(
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
      }>();

      // Initialize tracking for each player at freeze end
      for (const player of freezeEndFrame.players) {
        if (player.team === Team.SPECTATOR || !player.isAlive) continue;
        playerTracking.set(player.id, {
          player,
          initialPosition: { x: player.position.x, y: player.position.y },
          lastPosition: { x: player.position.x, y: player.position.y },
          movedDuringGracePeriod: false,
          isAFK: false, // Will be set to true if they don't move during grace period
          lastStillTick: freezeEndTick
        });
      }

      // Process all frames from freezeEnd to roundEnd
      for (const frame of allFrames) {
        for (const currentPlayer of frame.players) {
          const tracking = playerTracking.get(currentPlayer.id);
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
            
            // If we're in grace period and player hasn't moved, they will be AFK starting at freezeEndTick
            if (frame.tick < gracePeriodEndTick && !tracking.movedDuringGracePeriod) {
              // Will be marked as AFK after grace period check
            }
          }
        }
      }

      // After processing all frames, determine AFK status
      // Rule: If player did NOT move during grace period, they are AFK starting at freezeEndTick
      const MIN_AFK_THRESHOLD_SECONDS = 5;
      
      for (const [playerId, tracking] of playerTracking.entries()) {
        // Skip players who moved during grace period - they're NOT AFK
        if (tracking.movedDuringGracePeriod) {
          continue;
        }
        
        // Player did NOT move during grace period → they are AFK starting at freezeEndTick
        tracking.isAFK = true;
        
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
        const startAfkTick = freezeEndTick; // AFK starts at freezeEndTick (roundStart)
        const afkDuration = (endAfkTick - startAfkTick) / tickRate;
        
        // Only report if AFK duration >= 5 seconds
        if (afkDuration >= MIN_AFK_THRESHOLD_SECONDS) {
          detections.push({
            playerId,
            playerName: tracking.player.name,
            team: tracking.player.team,
            round: round.number,
            startTick: round.startTick,
            freezeEndTick: round.freezeEndTick,
            afkDuration,
            timeToFirstMovement: tracking.firstMovementTick 
              ? (tracking.firstMovementTick - freezeEndTick) / tickRate 
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

  /**
   * Detect team kills (friendly fire kills)
   */
  private detectTeamKills(): TeamKill[] {
    const teamKills: TeamKill[] = [];
    const tickRate = this.demoFile.tickRate;

    // Build a map of player names to their IDs and teams at each tick
    const playerInfoByTick = new Map<number, Map<string, { id: number; team: Team }>>();

    for (const frame of this.demoFile.frames) {
      const playerMap = new Map<string, { id: number; team: Team }>();
      for (const player of frame.players) {
        playerMap.set(player.name, { id: player.id, team: player.team });
      }
      playerInfoByTick.set(frame.tick, playerMap);
    }

    // Process kill events
    this.reportProgress(56, 'Processing kill events...');
    const framesWithKills = this.demoFile.frames.filter(f => f.events.some(e => e.type === 'kill'));
    for (let frameIndex = 0; frameIndex < this.demoFile.frames.length; frameIndex++) {
      const frame = this.demoFile.frames[frameIndex];
      
      // Report progress: 56% to 70% (14% range for processing kills)
      if (framesWithKills.length > 0 && frameIndex % Math.max(1, Math.floor(this.demoFile.frames.length / 10)) === 0) {
        const progress = 56 + (frameIndex / this.demoFile.frames.length) * 14;
        this.reportProgress(progress, `Processing kill events... (${teamKills.length} team kills found)`);
      }
      for (const event of frame.events) {
        if (event.type === 'kill') {
          // Parse the kill event description to extract attacker and victim
          // Format: "attackerName killed victimName with weapon (headshot)"
          const match = event.description.match(/^(.+?)\s+killed\s+(.+?)\s+with\s+(.+?)(?:\s+\(headshot\))?$/i);
          if (!match) continue;

          const attackerName = match[1].trim();
          const victimName = match[2].trim();
          const weapon = match[3].trim();
          const isHeadshot = event.description.toLowerCase().includes('headshot');

          // Filter out world/environmental kills
          const attackerNameLower = attackerName.toLowerCase();
          if (attackerNameLower === 'world' || 
              attackerNameLower === '<world>' || 
              attackerNameLower === 'environment' ||
              attackerNameLower === '') {
            continue;
          }

          // Filter out kills near the end of the game (last 10 seconds - server shutdown)
          const timeFromEnd = this.demoFile.duration - frame.time;
          if (timeFromEnd <= 10) {
            continue; // Skip kills in last 10 seconds
          }

          // Get player info for this tick
          const playerInfo = playerInfoByTick.get(frame.tick);
          if (!playerInfo) continue;

          const attackerInfo = playerInfo.get(attackerName);
          const victimInfo = playerInfo.get(victimName);

          if (!attackerInfo || !victimInfo) continue;

          // Check if same team
          if (attackerInfo.team === victimInfo.team && attackerInfo.team !== Team.SPECTATOR) {
            // Find which round this kill occurred in
            const round = this.demoFile.rounds.find(
              r => r.startTick && frame.tick >= r.startTick && (!r.endTick || frame.tick <= r.endTick)
            );

            teamKills.push({
              round: round?.number || 0,
              tick: frame.tick,
              time: frame.time,
              attackerId: attackerInfo.id,
              attackerName,
              attackerTeam: attackerInfo.team,
              victimId: victimInfo.id,
              victimName,
              victimTeam: victimInfo.team,
              weapon,
              isHeadshot
            });
          }
        }
      }
    }

    return teamKills;
  }

  /**
   * Detect team damage (friendly fire damage)
   */
  private detectTeamDamage(): TeamDamage[] {
    const teamDamage: TeamDamage[] = [];
    const tickRate = this.demoFile.tickRate;

    // Build a map of player names to their IDs, teams, and HP at each tick
    const playerInfoByTick = new Map<number, Map<string, { id: number; team: Team; hp: number }>>();

    for (const frame of this.demoFile.frames) {
      const playerMap = new Map<string, { id: number; team: Team; hp: number }>();
      for (const player of frame.players) {
        playerMap.set(player.name, { id: player.id, team: player.team, hp: player.hp });
      }
      playerInfoByTick.set(frame.tick, playerMap);
    }

    // Process damage events
    this.reportProgress(72, 'Processing damage events...');
    const framesWithDamage = this.demoFile.frames.filter(f => f.events.some(e => e.type === 'damage'));
    for (let frameIndex = 0; frameIndex < this.demoFile.frames.length; frameIndex++) {
      const frame = this.demoFile.frames[frameIndex];
      
      // Report progress: 72% to 100% (28% range for processing damage)
      if (framesWithDamage.length > 0 && frameIndex % Math.max(1, Math.floor(this.demoFile.frames.length / 10)) === 0) {
        const progress = 72 + (frameIndex / this.demoFile.frames.length) * 28;
        this.reportProgress(progress, `Processing damage events... (${teamDamage.length} team damage events found)`);
      }
      
      for (const event of frame.events) {
        if (event.type === 'damage' && event.attackerName && event.victimName && event.damage) {
          // Filter out world/environmental damage
          const attackerNameLower = event.attackerName.toLowerCase();
          if (attackerNameLower === 'world' || 
              attackerNameLower === '<world>' || 
              attackerNameLower === 'environment' ||
              attackerNameLower === '') {
            continue;
          }

          // Get player info for this tick (HP after damage)
          const playerInfo = playerInfoByTick.get(frame.tick);
          if (!playerInfo) continue;

          const attackerInfo = playerInfo.get(event.attackerName);
          const victimInfo = playerInfo.get(event.victimName);

          if (!attackerInfo || !victimInfo) continue;

          // Check if same team
          if (attackerInfo.team === victimInfo.team && attackerInfo.team !== Team.SPECTATOR) {
            // Find which round this damage occurred in
            const round = this.demoFile.rounds.find(
              r => r.startTick && frame.tick >= r.startTick && (!r.endTick || frame.tick <= r.endTick)
            );

            // Skip damage events that occur after round end (HP might have been reset)
            if (round && round.endTick && frame.tick > round.endTick) {
              continue;
            }

            // Calculate HP: current HP (after damage) + damage = initial HP (before damage)
            const finalHP = victimInfo.hp; // HP after damage
            const initialHP = finalHP + event.damage; // HP before damage

            // Validate HP values - they should be reasonable
            // initialHP should be <= 100 (max HP), and damage should be positive
            if (initialHP > 100 || event.damage <= 0) {
              // This might be a round boundary issue - skip it
              continue;
            }

            // Additional validation: if finalHP is 100 and damage > 0, this might be a round reset issue
            // Only allow this if we're very early in the round (within first 5 seconds)
            if (finalHP === 100 && event.damage > 0 && round) {
              const roundStartTime = round.startTick ? round.startTick / tickRate : 0;
              const timeSinceRoundStart = frame.time - roundStartTime;
              // If it's more than 5 seconds into the round and HP is 100, this is likely a reset issue
              if (timeSinceRoundStart > 5) {
                continue;
              }
            }

            // Ensure damage is positive (can't heal from utility damage)
            if (event.damage <= 0) {
              continue;
            }

            teamDamage.push({
              round: round?.number || 0,
              tick: frame.tick,
              time: frame.time,
              attackerId: attackerInfo.id,
              attackerName: event.attackerName,
              attackerTeam: attackerInfo.team,
              victimId: victimInfo.id,
              victimName: event.victimName,
              victimTeam: victimInfo.team,
              damage: event.damage,
              weapon: event.weapon,
              initialHP: initialHP,
              finalHP: finalHP
            });
          }
        }
      }
    }

    // Combine team damage events that occur within a short time span (5 seconds)
    // Events are combined if they involve the same attacker-victim pair and occur within 5 seconds
    const GROUP_TIME_WINDOW = 5; // seconds
    
    // Sort by time, then by tick to ensure proper ordering
    teamDamage.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      return a.tick - b.tick;
    });
    
    const combinedDamage: TeamDamage[] = [];
    const processed = new Set<number>();
    
    for (let i = 0; i < teamDamage.length; i++) {
      if (processed.has(i)) continue;
      
      const firstDamage = teamDamage[i];
      const group: TeamDamage[] = [firstDamage];
      processed.add(i);
      
      // Find all related damage events in the time window
      // Also check if they're sequential (same tick or very close ticks)
      for (let j = i + 1; j < teamDamage.length; j++) {
        if (processed.has(j)) continue;
        
        const otherDamage = teamDamage[j];
        
        // Check if same attacker-victim pair
        const samePair = otherDamage.attackerId === firstDamage.attackerId &&
                         otherDamage.victimId === firstDamage.victimId;
        
        if (!samePair) {
          // Different pair, but check if we should continue looking
          // If time difference is small, might still be same sequence
          if (otherDamage.time - firstDamage.time > GROUP_TIME_WINDOW) {
            break; // Too far in time, stop checking
          }
          continue;
        }
        
        // Same pair - check time window
        const timeDiff = otherDamage.time - firstDamage.time;
        const tickDiff = otherDamage.tick - firstDamage.tick;
        
        // Combine if within time window OR if sequential (within 64 ticks, ~1 second)
        if (timeDiff <= GROUP_TIME_WINDOW || tickDiff <= 64) {
          group.push(otherDamage);
          processed.add(j);
        } else {
          // Beyond time window, stop checking for this group
          break;
        }
      }
      
      if (group.length > 1) {
        // Combine multiple events into one
        // Use HP difference for accurate total damage calculation
        const initialHP = group[0].initialHP ?? (group[0].finalHP ?? 0) + group[0].damage;
        const finalHP = group[group.length - 1].finalHP ?? 0;
        const totalDamage = initialHP - finalHP; // Calculate from HP difference, not sum of individual damages
        
        // Validate: damage should be positive, initialHP should be <= 100, finalHP should be >= 0
        if (totalDamage <= 0 || initialHP > 100 || finalHP < 0) {
          // Skip invalid damage groups (likely round boundary issues)
          continue;
        }
        
        // Get unique weapons (remove duplicates)
        const weapons = [...new Set(group.map(d => d.weapon).filter(Boolean))];
        
        combinedDamage.push({
          round: firstDamage.round,
          tick: firstDamage.tick, // Use first tick
          time: firstDamage.time, // Use first time
          attackerId: firstDamage.attackerId,
          attackerName: firstDamage.attackerName,
          attackerTeam: firstDamage.attackerTeam,
          victimId: firstDamage.victimId,
          victimName: firstDamage.victimName,
          victimTeam: firstDamage.victimTeam,
          damage: totalDamage,
          weapon: weapons.join(', '), // Combine unique weapons
          initialHP: initialHP,
          finalHP: finalHP,
          groupId: undefined // No longer using groupId for display
        });
      } else {
        // Single event - validate before adding
        if (firstDamage.damage > 0 && 
            firstDamage.initialHP !== undefined && firstDamage.initialHP <= 100 &&
            firstDamage.finalHP !== undefined && firstDamage.finalHP >= 0) {
          combinedDamage.push(firstDamage);
        }
      }
    }

    return combinedDamage;
  }

  /**
   * Detect player disconnects and reconnects
   * Uses explicit disconnect/connect events from the demo file as primary source
   * Falls back to frame-based detection (when player disappears for >2 seconds) if events are not available
   */
  private detectDisconnects(): DisconnectReconnect[] {
    const disconnects: DisconnectReconnect[] = [];
    const tickRate = this.demoFile.tickRate;
    
    // Build a map of userid -> playerId, playerName, team from frames
    // Events use userid, but we need playerId for consistency
    const userIdToPlayerInfo = new Map<number, { playerId: number; playerName: string; team: Team }>();
    for (const frame of this.demoFile.frames) {
      for (const player of frame.players) {
        if (player.team === Team.SPECTATOR) continue;
        // Try to find userid from player data - this might not be directly available
        // For now, we'll use player.id as userid (they're often the same)
        // If events have different userids, we'll need to match by name
        userIdToPlayerInfo.set(player.id, {
          playerId: player.id,
          playerName: player.name,
          team: player.team
        });
      }
    }
    
    // Process explicit disconnect/connect events if available
    const eventBasedDisconnects = new Map<string, DisconnectReconnect>(); // key: playerId-disconnectTick
    
    if (this.demoFile.disconnectEvents && this.demoFile.disconnectEvents.length > 0) {
      for (const event of this.demoFile.disconnectEvents) {
        // Extract event data - handle both Map and object structures
        let userId: number | undefined;
        let playerName: string | undefined;
        let eventTick: number | undefined;
        
        if (event instanceof Map) {
          userId = event.get('userid') || event.get('user_id') || event.get('player_id') || event.get('playerid');
          playerName = event.get('player_name') || event.get('name') || event.get('playerName');
          eventTick = event.get('tick') || event.get('tick_num') || event.get('t');
        } else {
          userId = event.userid || event.user_id || event.player_id || event.playerid;
          playerName = event.player_name || event.name || event.playerName;
          eventTick = event.tick || event.tick_num || event.t;
        }
        
        if (eventTick && (userId !== undefined || playerName)) {
          // Find player info by userId or by name
          let playerInfo: { playerId: number; playerName: string; team: Team } | undefined;
          
          if (userId !== undefined) {
            playerInfo = userIdToPlayerInfo.get(userId);
          }
          
          // If not found by userId, try to find by name
          if (!playerInfo && playerName) {
            for (const [uid, info] of userIdToPlayerInfo.entries()) {
              if (info.playerName === playerName) {
                playerInfo = info;
                break;
              }
            }
          }
          
          if (playerInfo) {
            const disconnectRound = this.demoFile.rounds.find(
              r => r.startTick && eventTick! >= r.startTick && (!r.endTick || eventTick! <= r.endTick)
            );
            
            const disconnectTime = eventTick! / tickRate;
            
            const key = `${playerInfo.playerId}-${eventTick}`;
            eventBasedDisconnects.set(key, {
              playerId: playerInfo.playerId,
              playerName: playerInfo.playerName,
              team: playerInfo.team,
              disconnectTick: eventTick!,
              disconnectTime: disconnectTime,
              disconnectRound: disconnectRound?.number || 0
            });
          }
        }
      }
    }
    
    // Process connect events to mark reconnects
    if (this.demoFile.connectEvents && this.demoFile.connectEvents.length > 0) {
      for (const event of this.demoFile.connectEvents) {
        let userId: number | undefined;
        let playerName: string | undefined;
        let eventTick: number | undefined;
        
        if (event instanceof Map) {
          userId = event.get('userid') || event.get('user_id') || event.get('player_id') || event.get('playerid');
          playerName = event.get('player_name') || event.get('name') || event.get('playerName');
          eventTick = event.get('tick') || event.get('tick_num') || event.get('t');
        } else {
          userId = event.userid || event.user_id || event.player_id || event.playerid;
          playerName = event.player_name || event.name || event.playerName;
          eventTick = event.tick || event.tick_num || event.t;
        }
        
        if (eventTick && (userId !== undefined || playerName)) {
          // Find player info
          let playerInfo: { playerId: number; playerName: string; team: Team } | undefined;
          
          if (userId !== undefined) {
            playerInfo = userIdToPlayerInfo.get(userId);
          }
          
          if (!playerInfo && playerName) {
            for (const [uid, info] of userIdToPlayerInfo.entries()) {
              if (info.playerName === playerName) {
                playerInfo = info;
                break;
              }
            }
          }
          
          if (playerInfo) {
            // Find the most recent disconnect for this player that hasn't been reconnected
            let matchingDisconnect: DisconnectReconnect | undefined;
            let latestDisconnectTick = 0;
            
            for (const [key, dc] of eventBasedDisconnects.entries()) {
              if (dc.playerId === playerInfo.playerId && 
                  !dc.reconnectTick && 
                  dc.disconnectTick < eventTick! &&
                  dc.disconnectTick > latestDisconnectTick) {
                matchingDisconnect = dc;
                latestDisconnectTick = dc.disconnectTick;
              }
            }
            
            if (matchingDisconnect) {
              const reconnectRound = this.demoFile.rounds.find(
                r => r.startTick && eventTick! >= r.startTick && (!r.endTick || eventTick! <= r.endTick)
              );
              
              const reconnectTime = eventTick! / tickRate;
              const duration = reconnectTime - matchingDisconnect.disconnectTime;
              
              matchingDisconnect.reconnectTick = eventTick!;
              matchingDisconnect.reconnectTime = reconnectTime;
              matchingDisconnect.reconnectRound = reconnectRound?.number;
              matchingDisconnect.duration = duration;
            }
          }
        }
      }
    }
    
    // Add event-based disconnects to the results
    for (const dc of eventBasedDisconnects.values()) {
      disconnects.push(dc);
    }
    
    // Track which players already have event-based disconnects (to avoid duplicates)
    const playersWithEventDisconnects = new Set<number>();
    for (const dc of eventBasedDisconnects.values()) {
      playersWithEventDisconnects.add(dc.playerId);
    }
    
    // Track player presence across frames (for frame-based detection fallback)
    // Map: playerId -> { lastSeenTick, lastSeenTime, playerName, team, isDisconnected, disconnectTick?, disconnectTime?, wasAliveAtDisconnect? }
    const playerState = new Map<number, {
      lastSeenTick: number;
      lastSeenTime: number;
      playerName: string;
      team: Team;
      isDisconnected: boolean;
      disconnectTick?: number;
      disconnectTime?: number;
      wasAliveAtDisconnect?: boolean; // True if player was alive when they disconnected
    }>();
    
    // Track when each player died in each round: Map<roundNumber, Set<playerId>>
    const playerDeathsByRound = new Map<number, Set<number>>();
    
    // Minimum time gap to consider it a disconnect (2 seconds)
    // This prevents false positives from brief frame gaps
    const DISCONNECT_THRESHOLD_SECONDS = 2;
    const DISCONNECT_THRESHOLD_TICKS = Math.ceil(DISCONNECT_THRESHOLD_SECONDS * tickRate);
    
    // Process all frames chronologically
    for (const frame of this.demoFile.frames) {
      const currentPlayerIds = new Set<number>();
      
      // Find which round this frame belongs to
      const currentRound = this.demoFile.rounds.find(
        r => r.startTick && frame.tick >= r.startTick && (!r.endTick || frame.tick <= r.endTick)
      );
      
      // Collect all players present in this frame
      for (const player of frame.players) {
        if (player.team === Team.SPECTATOR) continue;
        
        currentPlayerIds.add(player.id);
        
        // Track player deaths by round
        if (!player.isAlive && currentRound) {
          if (!playerDeathsByRound.has(currentRound.number)) {
            playerDeathsByRound.set(currentRound.number, new Set());
          }
          playerDeathsByRound.get(currentRound.number)!.add(player.id);
        }
        
        const existingState = playerState.get(player.id);
        
        if (!existingState) {
          // First time seeing this player - they just connected
          playerState.set(player.id, {
            lastSeenTick: frame.tick,
            lastSeenTime: frame.time,
            playerName: player.name,
            team: player.team,
            isDisconnected: false
          });
        } else {
          // Player was seen before
          if (existingState.isDisconnected) {
            // Player was disconnected and now reappeared - this is a reconnect
            const reconnectRound = this.demoFile.rounds.find(
              r => r.startTick && frame.tick >= r.startTick && (!r.endTick || frame.tick <= r.endTick)
            );
            
            const duration = existingState.disconnectTime 
              ? frame.time - existingState.disconnectTime 
              : undefined;
            
            // Find and update the disconnect entry
            const disconnectEntry = disconnects.find(d => 
              d.playerId === player.id && 
              d.disconnectTick === existingState.disconnectTick &&
              !d.reconnectTick
            );
            
            if (disconnectEntry) {
              disconnectEntry.reconnectTick = frame.tick;
              disconnectEntry.reconnectTime = frame.time;
              disconnectEntry.reconnectRound = reconnectRound?.number;
              disconnectEntry.duration = duration;
              
              // Set flags
              const diedInDisconnectRound = playerDeathsByRound.get(disconnectEntry.disconnectRound)?.has(player.id) ?? false;
              disconnectEntry.diedBeforeDisconnect = diedInDisconnectRound;
              
              // Check if player reconnected before freeze time ended in the reconnect round
              // Use the reconnectRound object we already found, not look it up again
              let reconnectedBeforeFreezeEnd = false;
              if (reconnectRound && reconnectRound.startTick) {
                // Calculate time since round start
                const timeSinceRoundStart = (frame.tick - reconnectRound.startTick) / this.demoFile.tickRate;
                
                // Freeze time is typically 20 seconds, but can vary
                // Player reconnected before freeze end if they reconnect within 20 seconds of round start
                // We use time-based check for more accuracy
                const FREEZE_TIME_SECONDS = 20;
                reconnectedBeforeFreezeEnd = timeSinceRoundStart < FREEZE_TIME_SECONDS;
                
                // Also verify with freezeEndTick if available (for double-check)
                if (reconnectRound.freezeEndTick) {
                  const tickBasedCheck = frame.tick < reconnectRound.freezeEndTick;
                  // Use the more lenient check (if either says before freeze end, it's true)
                  // This handles cases where freezeEndTick might be slightly off
                  reconnectedBeforeFreezeEnd = reconnectedBeforeFreezeEnd || tickBasedCheck;
                }
              }
              disconnectEntry.reconnectedBeforeFreezeEnd = reconnectedBeforeFreezeEnd;
              
              // Calculate rounds missed
              // Don't count the disconnect round if the player died in that round
              // Don't count the reconnect round if the player reconnected before freeze time ended
              if (disconnectEntry.disconnectRound && disconnectEntry.reconnectRound) {
                let roundsMissed = 0;
                
                if (diedInDisconnectRound) {
                  // Player died in disconnect round - don't count that round, start from next round
                  roundsMissed = disconnectEntry.reconnectRound - disconnectEntry.disconnectRound;
                } else {
                  // Player was alive when they disconnected - count from disconnect round
                  roundsMissed = disconnectEntry.reconnectRound - disconnectEntry.disconnectRound + 1;
                }
                
                // If player reconnected before freeze end, they're playing the reconnect round - don't count it
                if (reconnectedBeforeFreezeEnd && roundsMissed > 0) {
                  roundsMissed -= 1;
                }
                
                disconnectEntry.roundsMissed = roundsMissed;
              }
            } else {
              // Create new entry if not found
              const disconnectRound = this.demoFile.rounds.find(
                r => r.startTick && existingState.disconnectTick! >= r.startTick && (!r.endTick || existingState.disconnectTick! <= r.endTick)
              );
              
              let roundsMissed = 0;
              const diedInDisconnectRound = disconnectRound ? playerDeathsByRound.get(disconnectRound.number)?.has(player.id) ?? false : false;
              
              // Check if player reconnected before freeze time ended in the reconnect round
              let reconnectedBeforeFreezeEnd = false;
              if (reconnectRound && reconnectRound.startTick) {
                // Calculate time since round start
                const timeSinceRoundStart = (frame.tick - reconnectRound.startTick) / this.demoFile.tickRate;
                
                // Freeze time is typically 20 seconds, but can vary
                // Player reconnected before freeze end if they reconnect within 20 seconds of round start
                // We use time-based check for more accuracy
                const FREEZE_TIME_SECONDS = 20;
                reconnectedBeforeFreezeEnd = timeSinceRoundStart < FREEZE_TIME_SECONDS;
                
                // Also verify with freezeEndTick if available (for double-check)
                if (reconnectRound.freezeEndTick) {
                  const tickBasedCheck = frame.tick < reconnectRound.freezeEndTick;
                  // Use the more lenient check (if either says before freeze end, it's true)
                  // This handles cases where freezeEndTick might be slightly off
                  reconnectedBeforeFreezeEnd = reconnectedBeforeFreezeEnd || tickBasedCheck;
                }
              }
              
              if (disconnectRound && reconnectRound) {
                if (diedInDisconnectRound) {
                  // Player died in disconnect round - don't count that round
                  roundsMissed = reconnectRound.number - disconnectRound.number;
                } else {
                  // Player was alive when they disconnected - count from disconnect round
                  roundsMissed = reconnectRound.number - disconnectRound.number + 1;
                }
                
                // If player reconnected before freeze end, they're playing the reconnect round - don't count it
                if (reconnectedBeforeFreezeEnd && roundsMissed > 0) {
                  roundsMissed -= 1;
                }
              }
              
              disconnects.push({
                playerId: player.id,
                playerName: existingState.playerName,
                team: existingState.team,
                disconnectTick: existingState.disconnectTick!,
                disconnectTime: existingState.disconnectTime!,
                disconnectRound: disconnectRound?.number || 0,
                reconnectTick: frame.tick,
                reconnectTime: frame.time,
                reconnectRound: reconnectRound?.number,
                duration,
                roundsMissed,
                diedBeforeDisconnect: diedInDisconnectRound,
                reconnectedBeforeFreezeEnd: reconnectedBeforeFreezeEnd
              });
            }
            
            // Update state - player is now connected again
            existingState.isDisconnected = false;
            existingState.lastSeenTick = frame.tick;
            existingState.lastSeenTime = frame.time;
            existingState.disconnectTick = undefined;
            existingState.disconnectTime = undefined;
          } else {
            // Player is still connected - just update last seen
            existingState.lastSeenTick = frame.tick;
            existingState.lastSeenTime = frame.time;
          }
        }
      }
      
      // Check for players who were seen before but are not in this frame
      // Skip players that already have event-based disconnects
      for (const [playerId, state] of playerState.entries()) {
        if (!currentPlayerIds.has(playerId) && !state.isDisconnected && !playersWithEventDisconnects.has(playerId)) {
          // Player was here before but not now - check if it's been long enough to be a disconnect
          const ticksSinceLastSeen = frame.tick - state.lastSeenTick;
          
          if (ticksSinceLastSeen >= DISCONNECT_THRESHOLD_TICKS) {
            // This is a disconnect (frame-based fallback)
            const disconnectRound = this.demoFile.rounds.find(
              r => r.startTick && state.lastSeenTick >= r.startTick && (!r.endTick || state.lastSeenTick <= r.endTick)
            );
            
            // Check if player was alive when they disconnected
            // Look at the last frame where we saw them
            const lastSeenFrame = this.demoFile.frames.find(f => f.tick === state.lastSeenTick);
            const wasAlive = lastSeenFrame?.players.find(p => p.id === playerId)?.isAlive ?? true;
            
            state.isDisconnected = true;
            state.disconnectTick = state.lastSeenTick;
            state.disconnectTime = state.lastSeenTime;
            state.wasAliveAtDisconnect = wasAlive;
            
            // Create a disconnect entry (will be updated if they reconnect)
            disconnects.push({
              playerId,
              playerName: state.playerName,
              team: state.team,
              disconnectTick: state.disconnectTick,
              disconnectTime: state.disconnectTime,
              disconnectRound: disconnectRound?.number || 0
            });
          }
        }
      }
    }
    
    // Final pass: mark any remaining disconnects that never reconnected
    // (players who disconnected and never came back)
    // Process both frame-based and event-based disconnects
    for (const [playerId, state] of playerState.entries()) {
      if (state.isDisconnected) {
        // Find the disconnect entry and mark it as permanent
        const disconnectEntry = disconnects.find(d => 
          d.playerId === playerId && 
          d.disconnectTick === state.disconnectTick &&
          !d.reconnectTick
        );
        
        if (disconnectEntry) {
          // Calculate duration from disconnect to end of demo
          disconnectEntry.duration = this.demoFile.duration - state.disconnectTime!;
          
          // Set flag for died before disconnect
          const diedInDisconnectRound = playerDeathsByRound.get(disconnectEntry.disconnectRound)?.has(playerId) ?? false;
          disconnectEntry.diedBeforeDisconnect = diedInDisconnectRound;
          
          // Calculate rounds missed (from disconnect round to end of demo)
          if (disconnectEntry.disconnectRound) {
            const lastRound = this.demoFile.rounds[this.demoFile.rounds.length - 1];
            if (lastRound && lastRound.number > disconnectEntry.disconnectRound) {
              if (diedInDisconnectRound) {
                // Player died in disconnect round - don't count that round
                // If they disconnect in round 5 (after death) and last round is 10, they missed rounds 6-10 = 5 rounds
                disconnectEntry.roundsMissed = lastRound.number - disconnectEntry.disconnectRound;
              } else {
                // Player was alive when they disconnected - count from disconnect round
                // If they disconnect in round 5 and last round is 10, they missed rounds 5-10 = 6 rounds
                disconnectEntry.roundsMissed = lastRound.number - disconnectEntry.disconnectRound + 1;
              }
            } else {
              disconnectEntry.roundsMissed = 0;
            }
          }
        }
      }
    }
    
    // Also process event-based disconnects that don't have all metadata filled in
    for (const disconnectEntry of disconnects) {
      if (!disconnectEntry.reconnectTick && (disconnectEntry.diedBeforeDisconnect === undefined || disconnectEntry.roundsMissed === undefined)) {
        // Fill in missing metadata for event-based disconnects
        const diedInDisconnectRound = playerDeathsByRound.get(disconnectEntry.disconnectRound)?.has(disconnectEntry.playerId) ?? false;
        if (disconnectEntry.diedBeforeDisconnect === undefined) {
          disconnectEntry.diedBeforeDisconnect = diedInDisconnectRound;
        }
        
        if (!disconnectEntry.roundsMissed && disconnectEntry.disconnectRound) {
          const lastRound = this.demoFile.rounds[this.demoFile.rounds.length - 1];
          if (lastRound && lastRound.number > disconnectEntry.disconnectRound) {
            if (diedInDisconnectRound) {
              disconnectEntry.roundsMissed = lastRound.number - disconnectEntry.disconnectRound;
            } else {
              disconnectEntry.roundsMissed = lastRound.number - disconnectEntry.disconnectRound + 1;
            }
          } else {
            disconnectEntry.roundsMissed = 0;
          }
        }
        
        // Fill in duration if missing
        if (!disconnectEntry.duration) {
          const disconnectTime = disconnectEntry.disconnectTick / tickRate;
          disconnectEntry.duration = this.demoFile.duration - disconnectTime;
        }
      }
    }
    
    // Filter out disconnects in the last round where the player was offline for less than 10 seconds
    // These are likely brief network hiccups at the end of the match, not meaningful disconnects
    const lastRound = this.demoFile.rounds.length > 0 ? this.demoFile.rounds[this.demoFile.rounds.length - 1] : null;
    const MIN_DISCONNECT_DURATION_SECONDS = 10;
    
    const filteredDisconnects = disconnects.filter(dc => {
      // Only apply the 10-second filter to disconnects in the last round
      if (lastRound && dc.disconnectRound === lastRound.number) {
        // If player reconnected, use the duration field
        // If they never reconnected, duration should already be calculated (time from disconnect to end of demo)
        if (dc.duration !== undefined && dc.duration < MIN_DISCONNECT_DURATION_SECONDS) {
          return false; // Filter out - too brief to be meaningful (only for last round)
        }
      }
      // Keep all disconnects from other rounds regardless of duration
      // Keep disconnects in last round that lasted 10+ seconds
      return true;
    });
    
    // Sort by disconnect time
    filteredDisconnects.sort((a, b) => a.disconnectTime - b.disconnectTime);
    
    return filteredDisconnects;
  }

  /**
   * Detect team flashes (friendly flashbangs)
   * Uses only player_blind events which contain all needed information (victim, thrower, duration, position)
   */
  private detectTeamFlashes(): TeamFlash[] {
    const teamFlashes: TeamFlash[] = [];
    
    try {
      const playerBlinds = this.demoFile.playerBlindEvents || [];
      
      if (playerBlinds.length === 0) {
        console.log('No player_blind events available for team flash detection');
        return teamFlashes;
      }

      console.log(`Processing ${playerBlinds.length} player_blind events`);
      
      // Log sample event for debugging
      if (playerBlinds.length > 0) {
        const firstBlind = playerBlinds[0];
        if (firstBlind instanceof Map) {
          console.log('Sample player_blind (Map):', Array.from(firstBlind.entries()));
        } else {
          console.log('Sample player_blind (Object):', Object.keys(firstBlind), firstBlind);
        }
      }

      const tickRate = this.demoFile.tickRate;
      
      // Process each player_blind event
      for (const blindEvent of playerBlinds) {
        try {
          // Extract blind event data - player_blind events should contain thrower/attacker info
          let blindTick = 0;
          let victimName = '';
          let victimId: number | undefined;
          let throwerName = '';
          let throwerId: number | undefined;
          let flashDuration = 0;
          let flashPosition: { x: number; y: number; z?: number } | undefined;
          
          if (blindEvent instanceof Map) {
            blindTick = blindEvent.get('tick') || blindEvent.get('tick_num') || 0;
            victimName = blindEvent.get('user_name') || blindEvent.get('player_name') || blindEvent.get('victim_name') || '';
            victimId = blindEvent.get('user_id') || blindEvent.get('player_id') || blindEvent.get('victim_id');
            throwerName = blindEvent.get('attacker_name') || blindEvent.get('thrower_name') || blindEvent.get('user_name') || '';
            throwerId = blindEvent.get('attacker_id') || blindEvent.get('thrower_id') || blindEvent.get('user_id');
            flashDuration = blindEvent.get('blind_duration') || blindEvent.get('flash_duration') || blindEvent.get('duration') || 0;
            const x = blindEvent.get('x') || blindEvent.get('X') || blindEvent.get('flash_x');
            const y = blindEvent.get('y') || blindEvent.get('Y') || blindEvent.get('flash_y');
            const z = blindEvent.get('z') || blindEvent.get('Z') || blindEvent.get('flash_z');
            if (x !== undefined && y !== undefined && x !== null && y !== null) {
              flashPosition = { x, y, z };
            }
          } else {
            blindTick = blindEvent.tick || blindEvent.tick_num || 0;
            victimName = blindEvent.user_name || blindEvent.player_name || blindEvent.victim_name || '';
            victimId = blindEvent.user_id || blindEvent.player_id || blindEvent.victim_id;
            throwerName = blindEvent.attacker_name || blindEvent.thrower_name || blindEvent.user_name || '';
            throwerId = blindEvent.attacker_id || blindEvent.thrower_id || blindEvent.user_id;
            flashDuration = blindEvent.blind_duration || blindEvent.flash_duration || blindEvent.duration || 0;
            const x = blindEvent.x || blindEvent.X || blindEvent.flash_x;
            const y = blindEvent.y || blindEvent.Y || blindEvent.flash_y;
            const z = blindEvent.z || blindEvent.Z || blindEvent.flash_z;
            if (x !== undefined && y !== undefined && x !== null && y !== null) {
              flashPosition = { x, y, z };
            }
          }
          
          // Filter out flashes shorter than 1 second (not significant team flashes)
          if (blindTick === 0 || flashDuration <= 0 || flashDuration < 1.0) {
            continue;
          }
          
          // Skip if no thrower information (can't determine if it's a team flash)
          if (!throwerName && throwerId === undefined) {
            continue;
          }
          
          // Skip if victim and thrower are the same (self-flash, not a team flash)
          if (victimName === throwerName || (victimId !== undefined && throwerId !== undefined && victimId === throwerId)) {
            continue;
          }
          
          // Find victim and thrower info from frames
          let victimTeam: Team | undefined;
          let victimIdFinal: number | undefined = victimId;
          let victimPosition: { x: number; y: number; z?: number } | undefined;
          let throwerTeam: Team | undefined;
          let throwerIdFinal: number | undefined = throwerId;
          
          // Try to find victim and thrower in frames
          for (const frame of this.demoFile.frames) {
            if (frame.tick >= blindTick - 5 && frame.tick <= blindTick) {
              // Find victim
              if (!victimTeam) {
                const victim = frame.players.find(p => 
                  p.name === victimName || 
                  (victimId !== undefined && p.id === victimId)
                );
                if (victim) {
                  victimTeam = victim.team;
                  victimIdFinal = victim.id;
                  victimPosition = victim.position;
                }
              }
              
              // Find thrower
              if (!throwerTeam) {
                const thrower = frame.players.find(p => 
                  p.name === throwerName || 
                  (throwerId !== undefined && p.id === throwerId)
                );
                if (thrower) {
                  throwerTeam = thrower.team;
                  throwerIdFinal = thrower.id;
                }
              }
              
              if (victimTeam && throwerTeam) {
                break;
              }
            }
          }
          
          // Check if victim and thrower are on the same team (team flash)
          // Also filter out flashes shorter than 1 second (not significant team flashes)
          if (victimTeam && throwerTeam && victimTeam === throwerTeam && victimTeam !== Team.SPECTATOR && flashDuration >= 1.0) {
            // Find which round this flash occurred in
            const round = this.demoFile.rounds.find(
              r => r.startTick && blindTick >= r.startTick && (!r.endTick || blindTick <= r.endTick)
            );
            
            // Find frame time for this tick
            const frame = this.demoFile.frames.find(f => f.tick === blindTick);
            const frameTime = frame ? frame.time : blindTick / tickRate;
            
            teamFlashes.push({
              round: round?.number || 0,
              tick: blindTick,
              time: frameTime,
              throwerId: throwerIdFinal || 0,
              throwerName: throwerName || 'Unknown',
              throwerTeam: throwerTeam,
              victimId: victimIdFinal || 0,
              victimName: victimName,
              victimTeam: victimTeam,
              flashDuration: flashDuration,
              flashPosition: flashPosition || { x: 0, y: 0 },
              victimPosition: victimPosition || { x: 0, y: 0 }
            });
          }
        } catch (err: any) {
          console.warn('Error processing player_blind event:', err);
          continue;
        }
      }
      
      console.log(`Detected ${teamFlashes.length} team flash events from ${playerBlinds.length} player_blind events`);
    
      // Deduplicate - same thrower-victim pair within a short time window (1 second) is likely the same flash
    const deduplicated: TeamFlash[] = [];
    const processed = new Set<string>();
    const DEDUP_TIME_WINDOW = 1; // seconds
    
    teamFlashes.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      return a.tick - b.tick;
    });
    
    for (const flash of teamFlashes) {
      const key = `${flash.throwerId}-${flash.victimId}-${flash.round}`;
      const lastFlash = deduplicated.find(f => 
        f.throwerId === flash.throwerId && 
        f.victimId === flash.victimId &&
        f.round === flash.round &&
        Math.abs(f.time - flash.time) < DEDUP_TIME_WINDOW
      );
      
      if (!lastFlash) {
        deduplicated.push(flash);
      } else {
        // Keep the one with higher flashDuration (more flashed)
        if (flash.flashDuration > lastFlash.flashDuration) {
          const index = deduplicated.indexOf(lastFlash);
          deduplicated[index] = flash;
        }
      }
    }
    
      return deduplicated;
    } catch (err: any) {
      console.warn('Error in detectTeamFlashes:', err);
      return [];
    }
  }
}

