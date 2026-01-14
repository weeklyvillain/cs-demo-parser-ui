import { DemoFile, MatchFrame, PlayerState, Team } from '../types';
import { MOCK_PLAYERS, getMapConfig } from '../constants';

// Helper to generate a random walk constrained to map config
const movePlayer = (current: PlayerState, tickIndex: number, mapConfig: any): PlayerState => {
  if (!current.isAlive) return current;

  // Simple random movement logic
  const speed = 5;
  const angle = Math.random() * 360;
  const radians = (angle * Math.PI) / 180;
  
  let newX = current.position.x + Math.cos(radians) * speed;
  let newY = current.position.y + Math.sin(radians) * speed;

  // Clamp to map bounds (loosely) with some padding so they don't stick to edge
  const padding = 100;
  newX = Math.max(mapConfig.minX + padding, Math.min(mapConfig.maxX - padding, newX));
  newY = Math.max(mapConfig.minY + padding, Math.min(mapConfig.maxY - padding, newY));

  // Simulate voice activity (random bursts)
  const isTalking = Math.random() > 0.98;

  return {
    ...current,
    position: { x: newX, y: newY },
    viewAngle: (current.viewAngle + (Math.random() - 0.5) * 20) % 360,
    isTalking: isTalking,
    hp: Math.random() > 0.99 ? Math.max(0, current.hp - 10) : current.hp,
    isAlive: current.hp > 0,
    hasBomb: current.hasBomb,
    flashDuration: Math.max(0, current.flashDuration - 0.05),
    equipment: current.equipment
  };
};

// Generates frames based on real duration
export const generateMockFrames = (mapName: string, durationSeconds: number, tickRate: number): MatchFrame[] => {
  const mapConfig = getMapConfig(mapName);
  const frames: MatchFrame[] = [];
  const safeDuration = durationSeconds > 0 ? durationSeconds : 60; // Fallback
  const totalTicks = Math.floor(safeDuration * tickRate);

  // Initial State
  let currentPlayers: PlayerState[] = MOCK_PLAYERS.map((p, idx) => ({
    id: idx + 100, // IDs
    name: p.name,
    team: p.team,
    hp: 100,
    isAlive: true,
    position: { 
      // Spawn points roughly based on team (Center of map roughly)
      x: (mapConfig.minX + mapConfig.maxX) / 2 + (p.team === Team.CT ? -500 : 500), 
      y: (mapConfig.minY + mapConfig.maxY) / 2 + (Math.random() * 400 - 200)
    },
    viewAngle: Math.random() * 360,
    hasBomb: p.team === Team.T && idx === 5,
    isTalking: false,
    flashDuration: 0,
    equipment: { 
        primary: p.team === Team.CT ? 'M4A1-S' : 'AK-47',
        grenades: [] 
    }
  }));

  for (let i = 0; i < totalTicks; i++) {
    currentPlayers = currentPlayers.map(p => movePlayer(p, i, mapConfig));

    frames.push({
      tick: i,
      time: i / tickRate,
      players: currentPlayers,
      events: [] 
    });
  }
  
  return frames;
};

// Legacy fallback
export const generateMockDemo = (): DemoFile => {
    return {
        mapName: 'de_mirage',
        tickRate: 64,
        duration: 60,
        frames: generateMockFrames('de_mirage', 60, 64)
    };
};