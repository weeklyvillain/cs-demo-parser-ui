/**
 * Team Kill Detection
 * 
 * Detects friendly fire kills (team kills) by analyzing kill events
 * and checking if the attacker and victim are on the same team.
 */

import { DemoFile, Team } from '../types';

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

/**
 * Detect team kills (friendly fire kills)
 */
export function detectTeamKills(demoFile: DemoFile): TeamKill[] {
  const teamKills: TeamKill[] = [];

  // Build a map of player names to their IDs and teams at each tick
  const playerInfoByTick = new Map<number, Map<string, { id: number; team: Team }>>();

  for (const frame of demoFile.frames) {
    const playerMap = new Map<string, { id: number; team: Team }>();
    for (const player of frame.players) {
      playerMap.set(player.name, { id: player.id, team: player.team });
    }
    playerInfoByTick.set(frame.tick, playerMap);
  }

  // Process kill events
  for (const frame of demoFile.frames) {
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
        const timeFromEnd = demoFile.duration - frame.time;
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

          // If still no round found, this shouldn't happen but we'll default to 0
          if (!round) {
            console.warn(`Could not find round for kill at tick ${frame.tick}, time ${frame.time}`);
          }

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
