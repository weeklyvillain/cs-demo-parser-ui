/**
 * Team Damage Detection
 * 
 * Detects friendly fire damage by analyzing damage events
 * and checking if the attacker and victim are on the same team.
 * Groups related damage events that occur within a short time span.
 */

import { DemoFile, Team } from '../types';

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

/**
 * Detect team damage (friendly fire damage)
 */
export function detectTeamDamage(demoFile: DemoFile): TeamDamage[] {
  const teamDamage: TeamDamage[] = [];
  const tickRate = demoFile.tickRate;

  // Build a map of player names to their IDs, teams, and HP at each tick
  const playerInfoByTick = new Map<number, Map<string, { id: number; team: Team; hp: number }>>();

  for (const frame of demoFile.frames) {
    const playerMap = new Map<string, { id: number; team: Team; hp: number }>();
    for (const player of frame.players) {
      playerMap.set(player.name, { id: player.id, team: player.team, hp: player.hp });
    }
    playerInfoByTick.set(frame.tick, playerMap);
  }

  // Process damage events
  for (const frame of demoFile.frames) {
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
          // Find the most recent round that contains this tick (highest startTick that's still <= frame.tick)
          // First try to find rounds where the tick is within the round's bounds
          let round = demoFile.rounds
            .filter(r => {
              if (!r.startTick) return false;
              const inStart = frame.tick >= r.startTick;
              const inEnd = !r.endTick || frame.tick <= r.endTick;
              return inStart && inEnd;
            })
            .sort((a, b) => (b.startTick || 0) - (a.startTick || 0))[0];
          
          // If no round found with proper bounds, find the most recent round that started before this tick
          if (!round) {
            round = demoFile.rounds
              .filter(r => r.startTick && frame.tick >= r.startTick)
              .sort((a, b) => (b.startTick || 0) - (a.startTick || 0))[0];
          }

          // Skip damage events that occur after round end (HP might have been reset)
          if (round && round.endTick && frame.tick > round.endTick) {
            continue;
          }

          // If no round found, this shouldn't happen but we'll skip this damage event
          if (!round) {
            console.warn(`Could not find round for damage at tick ${frame.tick}, time ${frame.time}`);
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
