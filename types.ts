export enum Team {
  CT = 'CT',
  T = 'T',
  SPECTATOR = 'SPECTATOR'
}

export interface Vector2 {
  x: number;
  y: number;
  z?: number; // Z coordinate for multi-floor maps like Vertigo
}

export interface PlayerState {
  id: number;
  name: string;
  team: Team;
  hp: number;
  isAlive: boolean;
  position: Vector2;
  viewAngle: number; // degrees
  hasBomb: boolean;
  isTalking: boolean; // Simulates voice activity
  flashDuration: number; // 0-1 range
  money?: number;
  playerColor?: string | number; // Player color name or ID from CS2
  hasDefuser?: boolean; // Has defuser kit (CT only)
  hasHelmet?: boolean; // Has helmet armor
  isConnected?: boolean; // Player is connected to server
  passiveItems?: string[]; // Passive items (like zeus, etc.)
  shotsFired?: number; // Number of shots fired (for muzzle flash detection)
  equipment: {
    primary?: string;
    grenades: string[];
  };
}

export interface MatchFrame {
  tick: number;
  time: number; // seconds
  players: PlayerState[];
  events: GameEvent[];
}

export interface GameEvent {
  type: 'kill' | 'plant' | 'defuse' | 'throw' | 'chat' | 'weapon_fire' | 'damage';
  tick: number;
  description: string;
  playerName?: string;
  message?: string;
  weapon?: string;
  attackerName?: string;
  victimName?: string;
  attackerTeam?: Team;
  victimTeam?: Team;
  damage?: number;
  isHeadshot?: boolean;
}

export interface Round {
  number: number;
  startTick: number;
  freezeEndTick?: number;
  endTick?: number;
  winner?: Team;
}

export interface DemoFile {
  mapName: string;
  tickRate: number;
  duration: number;
  frames: MatchFrame[];
  rounds: Round[];
  scores: {
    ct: number;
    t: number;
  };
  grenades?: any[]; // Grenade data from parseGrenades
  playerBlindEvents?: any[]; // player_blind events
}
