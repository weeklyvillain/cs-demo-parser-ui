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

export interface AnalysisResults {
  afkDetections: AFKDetection[];
  teamKills: TeamKill[];
  teamDamage: TeamDamage[];
  disconnects: DisconnectReconnect[];
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
    
    // Disconnects/Reconnects (80-100%)
    this.reportProgress(85, 'Detecting disconnects and reconnects...');
    const disconnects = this.detectDisconnects();
    this.reportProgress(100, `Found ${disconnects.length} disconnect events`);

    return {
      afkDetections,
      teamKills,
      teamDamage,
      disconnects
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

            // Calculate HP: current HP (after damage) + damage = initial HP (before damage)
            const finalHP = victimInfo.hp; // HP after damage
            const initialHP = finalHP + event.damage; // HP before damage

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
        // Single event, keep as is
        combinedDamage.push(firstDamage);
      }
    }

    return combinedDamage;
  }

  /**
   * Detect player disconnects and reconnects
   * A disconnect is detected when a player disappears from frames for more than 2 seconds
   * A reconnect is detected when the same player reappears later
   */
  private detectDisconnects(): DisconnectReconnect[] {
    const disconnects: DisconnectReconnect[] = [];
    const tickRate = this.demoFile.tickRate;
    
    // Track player presence across frames
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
      for (const [playerId, state] of playerState.entries()) {
        if (!currentPlayerIds.has(playerId) && !state.isDisconnected) {
          // Player was here before but not now - check if it's been long enough to be a disconnect
          const ticksSinceLastSeen = frame.tick - state.lastSeenTick;
          
          if (ticksSinceLastSeen >= DISCONNECT_THRESHOLD_TICKS) {
            // This is a disconnect
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
    
    // Sort by disconnect time
    disconnects.sort((a, b) => a.disconnectTime - b.disconnectTime);
    
    return disconnects;
  }
}

