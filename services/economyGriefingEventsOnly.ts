/**
 * Economy Griefing / Buy Sabotage Detection (EVENT-ONLY)
 * 
 * Detects intentional economy sabotage patterns using ONLY events from demo files.
 * Does NOT use money/cash data (not available in demos).
 * 
 * Approach:
 * - Track inventory via item_pickup and item_equip events
 * - Infer buy behavior from equipment value changes
 * - Compare player behavior to team norms (relative detection)
 * - Pattern-based (requires repetition across rounds)
 * - Explainable with human-readable reasons
 */

import { MatchFrame, Round, Team, GameEvent, DemoFile } from '../types';

/**
 * Weapon price table (CS2 approximate prices)
 */
const WEAPON_PRICES: Record<string, number> = {
  // Rifles
  'weapon_ak47': 2700, 'weapon_m4a1': 3100, 'weapon_m4a4': 3100, 'weapon_m4a1_silencer': 2900,
  'weapon_aug': 3300, 'weapon_sg556': 3000, 'weapon_galil': 1800, 'weapon_famas': 2050,
  // AWP
  'weapon_awp': 4750,
  // Snipers
  'weapon_ssg08': 1700, 'weapon_scar20': 5000, 'weapon_g3sg1': 5000,
  // SMGs
  'weapon_mac10': 1050, 'weapon_mp9': 1250, 'weapon_mp7': 1500, 'weapon_ump45': 1200,
  'weapon_p90': 2350, 'weapon_pp_bizon': 1400, 'weapon_mp5': 1500,
  // Shotguns
  'weapon_nova': 1050, 'weapon_xm1014': 2000, 'weapon_sawedoff': 1100, 'weapon_mag7': 1300,
  // Pistols
  'weapon_glock': 200, 'weapon_usp_silencer': 200, 'weapon_p250': 300, 'weapon_tec9': 500,
  'weapon_five_seven': 500, 'weapon_cz75': 500, 'weapon_deagle': 700, 'weapon_r8_revolver': 600,
  'weapon_p2000': 200, 'weapon_dual_berettas': 300,
  // Heavy
  'weapon_negev': 1700, 'weapon_m249': 5200,
  // Grenades
  'weapon_hegrenade': 300, 'weapon_flashbang': 200, 'weapon_smokegrenade': 300,
  'weapon_molotov': 400, 'weapon_incgrenade': 600, 'weapon_decoy': 50,
  // Other
  'weapon_zeus': 200, 'weapon_knife': 0, 'weapon_c4': 0,
  // Armor/Kit (alternative names)
  'item_kevlar': 650, 'item_assaultsuit': 1000, 'item_defuser': 400,
};

const ARMOR_PRICE = 650;
const HELMET_PRICE = 350;
const DEFUSER_PRICE = 400;

/**
 * Get weapon price
 */
function getWeaponPrice(itemName: string): number {
  const normalized = itemName.toLowerCase();
  return WEAPON_PRICES[normalized] || 0;
}

/**
 * Check if item is a primary weapon
 */
function isPrimaryWeapon(itemName: string): boolean {
  const normalized = itemName.toLowerCase();
  const primaryWeapons = [
    'ak47', 'm4a1', 'm4a4', 'aug', 'sg556', 'galil', 'famas',
    'awp', 'ssg08', 'scar20', 'g3sg1',
    'mac10', 'mp9', 'mp7', 'ump45', 'p90', 'pp_bizon', 'mp5',
    'nova', 'xm1014', 'sawedoff', 'mag7', 'negev', 'm249'
  ];
  return primaryWeapons.some(w => normalized.includes(w));
}

/**
 * Check if item is a secondary weapon (pistol)
 */
function isSecondaryWeapon(itemName: string): boolean {
  const normalized = itemName.toLowerCase();
  const secondaryWeapons = [
    'glock', 'usp', 'p250', 'tec9', 'five_seven', 'cz75', 'deagle', 'r8', 'p2000', 'dual_berettas'
  ];
  return secondaryWeapons.some(w => normalized.includes(w));
}

/**
 * Get grenade type
 */
function getGrenadeType(itemName: string): 'flash' | 'smoke' | 'molotov' | 'he' | 'decoy' | null {
  const normalized = itemName.toLowerCase();
  if (normalized.includes('flash')) return 'flash';
  if (normalized.includes('smoke')) return 'smoke';
  if (normalized.includes('molotov') || normalized.includes('incgrenade')) return 'molotov';
  if (normalized.includes('hegrenade') || normalized.includes('he')) return 'he';
  if (normalized.includes('decoy')) return 'decoy';
  return null;
}

/**
 * Player inventory state (per round)
 */
interface PlayerInventory {
  primaryWeapon: string | null;
  secondaryWeapon: string | null;
  armor: 'none' | 'kevlar' | 'kevlar+helmet';
  kit: boolean;
  grenades: {
    flash: number;
    smoke: number;
    molotov: number;
    he: number;
    decoy: number;
  };
  taser: boolean;
}

/**
 * Initialize empty inventory
 */
function createEmptyInventory(): PlayerInventory {
  return {
    primaryWeapon: null,
    secondaryWeapon: null,
    armor: 'none',
    kit: false,
    grenades: { flash: 0, smoke: 0, molotov: 0, he: 0, decoy: 0 },
    taser: false,
  };
}

/**
 * Calculate inventory value
 */
function calculateInventoryValue(inv: PlayerInventory): number {
  let value = 0;
  
  if (inv.primaryWeapon) {
    value += getWeaponPrice(inv.primaryWeapon);
  }
  if (inv.secondaryWeapon) {
    value += getWeaponPrice(inv.secondaryWeapon);
  }
  if (inv.armor === 'kevlar') {
    value += ARMOR_PRICE;
  } else if (inv.armor === 'kevlar+helmet') {
    value += ARMOR_PRICE + HELMET_PRICE;
  }
  if (inv.kit) {
    value += DEFUSER_PRICE;
  }
  value += inv.grenades.flash * 200;
  value += inv.grenades.smoke * 300;
  value += inv.grenades.molotov * 400;
  value += inv.grenades.he * 300;
  value += inv.grenades.decoy * 50;
  if (inv.taser) {
    value += 200;
  }
  
  return value;
}

/**
 * Update inventory from item pickup/equip
 */
function updateInventory(inv: PlayerInventory, itemName: string): void {
  const normalized = itemName.toLowerCase();
  
  // Handle weapons
  if (isPrimaryWeapon(itemName)) {
    inv.primaryWeapon = itemName;
  } else if (isSecondaryWeapon(itemName)) {
    inv.secondaryWeapon = itemName;
  }
  // Handle armor
  else if (normalized.includes('assaultsuit') || normalized.includes('kevlar+helmet')) {
    inv.armor = 'kevlar+helmet';
  } else if (normalized.includes('kevlar') && !normalized.includes('assaultsuit')) {
    inv.armor = 'kevlar';
  }
  // Handle kit
  else if (normalized.includes('defuser') || normalized.includes('defuse')) {
    inv.kit = true;
  }
  // Handle grenades
  else {
    const grenadeType = getGrenadeType(itemName);
    if (grenadeType) {
      inv.grenades[grenadeType] = Math.min(inv.grenades[grenadeType] + 1, 4); // Cap at 4
    }
  }
  // Handle taser
  if (normalized.includes('zeus') || normalized.includes('taser')) {
    inv.taser = true;
  }
}

/**
 * Configuration
 */
export interface EconomyEventsOnlyConfig {
  // Team buy state thresholds
  ecoMedianThreshold: number;
  fullMedianThreshold: number;
  
  // Underbuy detection
  underbuyRatio: number;
  absoluteUnderbuyValue: number;
  
  // Overbuy detection
  overbuyRatio: number;
  absoluteOverbuyValue: number;
  
  // High value early death
  highValueThreshold: number;
  earlyDeathSeconds: number;
  lowDamageThreshold: number;
  
  // Drop transfer detection
  transferWindowSeconds: number;
  
  // Kitless CT
  kitlessCTMinRounds: number;
  
  // Scoring weights
  weights: {
    underbuy: number;
    overbuy: number;
    kitlessCT: number;
    highValueEarlyDeath: number;
    outlierBuyProfile: number;
  };
  
  // Pattern multipliers
  patternMultiplierBase: number;
  patternMultiplierIncrement: number;
  patternMultiplierMax: number;
}

export const DEFAULT_ECONOMY_EVENTS_ONLY_CONFIG: EconomyEventsOnlyConfig = {
  ecoMedianThreshold: 1400,
  fullMedianThreshold: 3800,
  underbuyRatio: 0.5,
  absoluteUnderbuyValue: 1500,
  overbuyRatio: 2.0,
  absoluteOverbuyValue: 4500,
  highValueThreshold: 5000,
  earlyDeathSeconds: 18,
  lowDamageThreshold: 25,
  transferWindowSeconds: 2.0,
  kitlessCTMinRounds: 2,
  weights: {
    underbuy: 0.4,
    overbuy: 0.3,
    kitlessCT: 0.2,
    highValueEarlyDeath: 0.35,
    outlierBuyProfile: 0.1,
  },
  patternMultiplierBase: 1.0,
  patternMultiplierIncrement: 0.25,
  patternMultiplierMax: 3.0,
};

/**
 * Economy event types
 */
export type EconomyEventType =
  | 'Underbuy'
  | 'Overbuy'
  | 'KitlessCT'
  | 'HighValueEarlyDeath'
  | 'OutlierBuyProfile';

/**
 * Economy event
 */
export interface EconomyEvent {
  round: number;
  actorId: number;
  actorName: string;
  type: EconomyEventType;
  score: number;
  confidence: number;
  featureSummary: {
    postBuyValue?: number;
    teamMedianValue?: number;
    teamBuyState?: 'ECO' | 'FORCE' | 'FULL';
    timeToDeath?: number;
    damageDealt?: number;
    kills?: number;
    [key: string]: any;
  };
  humanReason: string;
}

/**
 * Per-round summary for a player
 */
export interface EconomyPlayerRoundSummary {
  round: number;
  preBuyValue: number;
  postBuyValue: number;
  acquiredDuringBuy: string[];
  droppedDuringBuyTo?: number[];
  teamMedianValue: number;
  teamBuyState: 'ECO' | 'FORCE' | 'FULL';
}

/**
 * Per-player result
 */
export interface EconomyPlayerResult {
  events: EconomyEvent[];
  matchScore: number;
  matchConfidence: number;
  flaggedMatch: boolean;
  roundSummaries: EconomyPlayerRoundSummary[];
}

/**
 * Economy result
 */
export interface EconomyResult {
  byPlayer: Map<number, EconomyPlayerResult>;
}

/**
 * Raw event from demo parser (Map or object)
 */
type RawEvent = Map<string, any> | { [key: string]: any };

/**
 * Extract value from raw event (handles both Map and object)
 */
function getEventValue(event: RawEvent, key: string): any {
  if (event instanceof Map) {
    return event.get(key);
  }
  return (event as any)[key];
}

/**
 * Get event name from raw event
 */
function getEventName(event: RawEvent): string {
  return getEventValue(event, 'event_name') || getEventValue(event, 'name') || '';
}

/**
 * Get tick from raw event
 */
function getEventTick(event: RawEvent): number {
  return getEventValue(event, 'tick') || getEventValue(event, 'tick_num') || getEventValue(event, 't') || 0;
}

/**
 * Get player name from raw event
 */
function getPlayerName(event: RawEvent): string {
  return getEventValue(event, 'user_name') || 
         getEventValue(event, 'player_name') || 
         getEventValue(event, 'name') || 
         getEventValue(event, 'userid') || 
         'Unknown';
}

/**
 * Get item from raw event
 */
function getItem(event: RawEvent): string {
  return getEventValue(event, 'item') || 
         getEventValue(event, 'weapon') || 
         getEventValue(event, 'weapon_name') || 
         'unknown';
}

/**
 * Track player inventories from raw events
 */
function trackPlayerInventories(
  rounds: Round[],
  rawEvents: RawEvent[],
  playerNames: Map<number, string>,
  tickRate: number
): Map<number, Map<number, { preBuy: PlayerInventory; postBuy: PlayerInventory; acquired: string[]; dropped: number[] }>> {
  const inventories = new Map<number, Map<number, { preBuy: PlayerInventory; postBuy: PlayerInventory; acquired: string[]; dropped: number[] }>>();
  
  // Track current inventory per player per round
  const roundInventories = new Map<number, Map<number, PlayerInventory>>();
  
  // Track buy windows per round
  const buyWindows = new Map<number, { start: number; end: number }>();
  for (const round of rounds) {
    const freezeEndTick = round.freezeEndTick || round.startTick || 0;
    let buyTimeEndTick = freezeEndTick + (20 * tickRate); // Default: 20 seconds after freeze end
    
    // Find buytime_ended event
    for (const event of rawEvents) {
      const eventName = getEventName(event);
      const eventTick = getEventTick(event);
      if (eventName === 'buytime_ended' && eventTick >= freezeEndTick && eventTick <= (round.endTick || Infinity)) {
        buyTimeEndTick = eventTick;
        break;
      }
    }
    
    buyWindows.set(round.number, { start: freezeEndTick, end: buyTimeEndTick });
    
    // Initialize inventories for this round
    roundInventories.set(round.number, new Map());
  }
  
  // Process events chronologically
  const sortedEvents = [...rawEvents].sort((a, b) => getEventTick(a) - getEventTick(b));
  
  console.log('[Economy Events Only] Processing events:', {
    total: sortedEvents.length,
    itemPickup: sortedEvents.filter(e => getEventName(e) === 'item_pickup').length,
    itemEquip: sortedEvents.filter(e => getEventName(e) === 'item_equip').length,
    playerSpawn: sortedEvents.filter(e => getEventName(e) === 'player_spawn').length,
  });
  
  // Track item transfers (drop detection)
  const itemTransfers = new Map<string, { from: number; to: number; tick: number; item: string }>();
  
  let processedItemEvents = 0;
  let matchedPlayerEvents = 0;
  
  for (const event of sortedEvents) {
    const eventName = getEventName(event);
    const eventTick = getEventTick(event);
    
    const round = rounds.find(r => eventTick >= (r.startTick || 0) && eventTick <= (r.endTick || Infinity));
    if (!round) continue;
    
    const buyWindow = buyWindows.get(round.number);
    if (!buyWindow) continue;
    
    const isInBuyWindow = eventTick >= buyWindow.start && eventTick <= buyWindow.end;
    const roundInv = roundInventories.get(round.number)!;
    
    // Handle player_spawn - reset inventory
    if (eventName === 'player_spawn') {
      const playerName = getPlayerName(event);
      const playerId = Array.from(playerNames.entries()).find(([_, name]) => name === playerName)?.[0];
      if (playerId) {
        roundInv.set(playerId, createEmptyInventory());
      }
    }
    
    // Handle item_pickup and item_equip
    if (eventName === 'item_pickup' || eventName === 'item_equip') {
      processedItemEvents++;
      const playerName = getPlayerName(event);
      const playerId = Array.from(playerNames.entries()).find(([_, name]) => name === playerName)?.[0];
      const item = getItem(event);
      
      if (!playerId) {
        if (processedItemEvents <= 10) {
          console.log(`[Economy Events Only] Could not find player ID for "${playerName}" in item event`);
        }
        continue;
      }
      if (item === 'unknown') {
        if (processedItemEvents <= 10) {
          console.log(`[Economy Events Only] Unknown item for player "${playerName}"`);
        }
        continue;
      }
      
      matchedPlayerEvents++;
      
      // Initialize inventory if not exists
      if (!roundInv.has(playerId)) {
        roundInv.set(playerId, createEmptyInventory());
      }
      
      const inv = roundInv.get(playerId)!;
      
      // Update inventory
      updateInventory(inv, item);
      
      // Track acquisition during buy window
      if (isInBuyWindow) {
        // Check if this might be a transfer (teammate picks up same item shortly after)
        const transferKey = `${round.number}-${item}`;
        const existingTransfer = itemTransfers.get(transferKey);
        
        if (existingTransfer && existingTransfer.from !== playerId) {
          // This looks like a transfer - mark the original player as having dropped
          if (!inventories.has(existingTransfer.from)) {
            inventories.set(existingTransfer.from, new Map());
          }
          if (!inventories.get(existingTransfer.from)!.has(round.number)) {
            inventories.get(existingTransfer.from)!.set(round.number, {
              preBuy: createEmptyInventory(),
              postBuy: createEmptyInventory(),
              acquired: [],
              dropped: [],
            });
          }
          const summary = inventories.get(existingTransfer.from)!.get(round.number)!;
          if (!summary.dropped) summary.dropped = [];
          if (!summary.dropped.includes(playerId)) {
            summary.dropped.push(playerId);
          }
        } else {
          // Mark as potential transfer source
          itemTransfers.set(transferKey, { from: playerId, to: 0, tick: eventTick, item });
          
          // Clean up old transfers
          for (const [key, transfer] of itemTransfers.entries()) {
            if (eventTick - transfer.tick > (2.0 * tickRate)) {
              itemTransfers.delete(key);
            }
          }
        }
      }
    }
  }
  
  console.log('[Economy Events Only] Item event processing:', {
    processed: processedItemEvents,
    matched: matchedPlayerEvents,
    roundsWithInventories: roundInventories.size
  });
  
  // Snapshot inventories at pre-buy and post-buy
  for (const round of rounds) {
    const buyWindow = buyWindows.get(round.number);
    if (!buyWindow) continue;
    
    const roundInv = roundInventories.get(round.number);
    if (!roundInv) continue;
    
    for (const [playerId, inv] of roundInv.entries()) {
      if (!inventories.has(playerId)) {
        inventories.set(playerId, new Map());
      }
      
      // Get pre-buy inventory (at freeze end)
      const preBuyInv = createEmptyInventory();
      // We'll need to snapshot at freeze end - for now use initial state
      
      // Get post-buy inventory (at buy time end)
      const postBuyInv = { ...inv };
      
      // Get acquired items during buy window
      const acquired: string[] = [];
      for (const event of sortedEvents) {
        const eventName = getEventName(event);
        const eventTick = getEventTick(event);
        if (eventTick >= buyWindow.start && eventTick <= buyWindow.end) {
          const playerName = getPlayerName(event);
          const foundPlayerId = Array.from(playerNames.entries()).find(([_, name]) => name === playerName)?.[0];
          if (foundPlayerId === playerId && (eventName === 'item_pickup' || eventName === 'item_equip')) {
            const item = getItem(event);
            if (item !== 'unknown' && !acquired.includes(item)) {
              acquired.push(item);
            }
          }
        }
      }
      
      inventories.get(playerId)!.set(round.number, {
        preBuy: preBuyInv,
        postBuy: postBuyInv,
        acquired,
        dropped: [],
      });
    }
  }
  
  return inventories;
}

/**
 * Infer team buy state
 */
function inferTeamBuyState(
  playerValues: number[],
  config: EconomyEventsOnlyConfig
): 'ECO' | 'FORCE' | 'FULL' {
  if (playerValues.length === 0) return 'ECO';
  
  const sorted = [...playerValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  
  if (median < config.ecoMedianThreshold) return 'ECO';
  if (median >= config.fullMedianThreshold) return 'FULL';
  return 'FORCE';
}

/**
 * Detector 1: RelativeUnderbuyWhileTeamBuys
 */
function detectUnderbuy(
  round: number,
  playerId: number,
  playerName: string,
  postBuyValue: number,
  teamMedianValue: number,
  teamBuyState: 'ECO' | 'FORCE' | 'FULL',
  savedWeapon: boolean,
  droppedWeapon: boolean,
  config: EconomyEventsOnlyConfig
): EconomyEvent | null {
  if (teamBuyState === 'ECO') return null;
  if (savedWeapon) return null; // Has saved weapon, legit
  if (droppedWeapon) return null; // Dropped to teammate, legit
  
  if (postBuyValue >= (teamMedianValue * config.underbuyRatio)) return null;
  if (postBuyValue >= config.absoluteUnderbuyValue) return null;
  
  const score = config.weights.underbuy;
  const confidence = Math.min(1.0, score * 2.0);
  
  return {
    round,
    actorId: playerId,
    actorName: playerName,
    type: 'Underbuy',
    score,
    confidence,
    featureSummary: {
      postBuyValue,
      teamMedianValue,
      teamBuyState,
    },
    humanReason: `Underbought: team median value $${teamMedianValue.toLocaleString()} (${teamBuyState}), player value $${postBuyValue.toLocaleString()} at buy end.`,
  };
}

/**
 * Detector 2: RelativeOverbuyWhenTeamEcos
 */
function detectOverbuy(
  round: number,
  playerId: number,
  playerName: string,
  postBuyValue: number,
  teamMedianValue: number,
  teamBuyState: 'ECO' | 'FORCE' | 'FULL',
  savedWeapon: boolean,
  impact: { kills: number; damage: number },
  config: EconomyEventsOnlyConfig
): EconomyEvent | null {
  if (teamBuyState !== 'ECO') return null;
  if (savedWeapon && impact.kills > 0) return null; // Saved weapon with impact, might be legit
  
  if (postBuyValue <= (teamMedianValue * config.overbuyRatio)) return null;
  if (postBuyValue <= config.absoluteOverbuyValue) return null;
  
  // Reduce confidence if player has impact
  const impactPenalty = impact.kills > 0 || impact.damage > config.lowDamageThreshold ? 0.5 : 1.0;
  
  const score = config.weights.overbuy;
  const confidence = Math.min(1.0, score * 1.5 * impactPenalty);
  
  return {
    round,
    actorId: playerId,
    actorName: playerName,
    type: 'Overbuy',
    score,
    confidence,
    featureSummary: {
      postBuyValue,
      teamMedianValue,
      teamBuyState,
      kills: impact.kills,
      damageDealt: impact.damage,
    },
    humanReason: `Overbought on eco: team median $${teamMedianValue.toLocaleString()} (ECO), player value $${postBuyValue.toLocaleString()}.`,
  };
}

/**
 * Detector 3: KitlessCTRepeated
 */
function detectKitlessCT(
  round: number,
  playerId: number,
  playerName: string,
  team: Team,
  postBuyValue: number,
  hasKit: boolean,
  teamBuyState: 'ECO' | 'FORCE' | 'FULL',
  config: EconomyEventsOnlyConfig
): EconomyEvent | null {
  if (team !== Team.CT) return null;
  if (teamBuyState === 'ECO') return null;
  if (hasKit) return null;
  if (postBuyValue < config.ecoMedianThreshold) return null; // Too low value, probably eco
  
  const score = config.weights.kitlessCT;
  const confidence = Math.min(1.0, score * 1.2);
  
  return {
    round,
    actorId: playerId,
    actorName: playerName,
    type: 'KitlessCT',
    score,
    confidence,
    featureSummary: {
      postBuyValue,
      teamBuyState,
    },
    humanReason: `CT ${teamBuyState} buy but no defuser kit (value $${postBuyValue.toLocaleString()}).`,
  };
}

/**
 * Detector 4: HighValueEarlyDeathLowImpact
 */
function detectHighValueEarlyDeath(
  round: number,
  playerId: number,
  playerName: string,
  postBuyValue: number,
  timeToDeath: number | undefined,
  impact: { kills: number; damage: number },
  config: EconomyEventsOnlyConfig
): EconomyEvent | null {
  if (postBuyValue < config.highValueThreshold) return null;
  if (timeToDeath === undefined) return null;
  if (timeToDeath >= config.earlyDeathSeconds) return null;
  
  // Guard: if player has impact, don't flag
  if (impact.kills > 0 || impact.damage > config.lowDamageThreshold) return null;
  
  const score = config.weights.highValueEarlyDeath;
  const confidence = Math.min(1.0, score * 2.0);
  
  return {
    round,
    actorId: playerId,
    actorName: playerName,
    type: 'HighValueEarlyDeath',
    score,
    confidence,
    featureSummary: {
      postBuyValue,
      timeToDeath,
      kills: impact.kills,
      damageDealt: impact.damage,
    },
    humanReason: `High value early death: value $${postBuyValue.toLocaleString()}, died in ${timeToDeath.toFixed(1)}s with ${impact.kills} kills and ${impact.damage} damage.`,
  };
}

/**
 * Main analysis function
 */
export function analyzeEconomyGriefingEventsOnly(
  demoFile: DemoFile,
  rawEvents: RawEvent[],
  config: EconomyEventsOnlyConfig = DEFAULT_ECONOMY_EVENTS_ONLY_CONFIG
): EconomyResult {
  console.log('[Economy Events Only] Starting analysis...', { 
    rounds: demoFile.rounds.length, 
    events: rawEvents.length,
    tickRate: demoFile.tickRate 
  });
  
  const { rounds, frames, tickRate } = demoFile;
  
  // Build player name and team maps
  const playerNames = new Map<number, string>();
  const playerTeams = new Map<number, Team>();
  for (const frame of frames) {
    for (const player of frame.players) {
      if (!playerNames.has(player.id)) {
        playerNames.set(player.id, player.name);
      }
      playerTeams.set(player.id, player.team);
    }
  }
  
  console.log('[Economy Events Only] Player names map:', Array.from(playerNames.entries()).slice(0, 5));
  console.log('[Economy Events Only] Sample raw events:', rawEvents.slice(0, 5).map(e => ({
    name: getEventName(e),
    tick: getEventTick(e),
    player: getPlayerName(e),
    item: getItem(e)
  })));
  
  // Track inventories
  const inventories = trackPlayerInventories(rounds, rawEvents, playerNames, tickRate);
  
  console.log('[Economy Events Only] Inventories tracked:', {
    playerCount: inventories.size,
    roundsWithData: Array.from(inventories.values()).reduce((sum, roundMap) => sum + roundMap.size, 0)
  });
  
  // Track damage and kills per player per round
  const damageByPlayerByRound = new Map<number, Map<number, number>>();
  const killsByPlayerByRound = new Map<number, Map<number, number>>();
  const deathTicksByPlayerByRound = new Map<number, Map<number, number>>();
  
  for (const event of rawEvents) {
    const eventName = getEventName(event);
    const eventTick = getEventTick(event);
    
    const round = rounds.find(r => eventTick >= (r.startTick || 0) && eventTick <= (r.endTick || Infinity));
    if (!round) continue;
    
    // Track damage
    if (eventName === 'player_hurt' || eventName === 'damage') {
      const attackerName = getEventValue(event, 'attacker_name') || getEventValue(event, 'attacker');
      const damage = getEventValue(event, 'dmg_health') || getEventValue(event, 'damage') || 0;
      const attackerId = Array.from(playerNames.entries()).find(([_, name]) => name === attackerName)?.[0];
      
      if (attackerId && damage > 0) {
        if (!damageByPlayerByRound.has(attackerId)) {
          damageByPlayerByRound.set(attackerId, new Map());
        }
        const roundDamage = damageByPlayerByRound.get(attackerId)!.get(round.number) || 0;
        damageByPlayerByRound.get(attackerId)!.set(round.number, roundDamage + damage);
      }
    }
    
    // Track kills and deaths
    if (eventName === 'player_death' || eventName === 'other_death') {
      const attackerName = getEventValue(event, 'attacker_name') || getEventValue(event, 'attacker');
      const victimName = getEventValue(event, 'user_name') || getEventValue(event, 'victim_name') || getEventValue(event, 'victim');
      
      if (attackerName && attackerName !== victimName) {
        const attackerId = Array.from(playerNames.entries()).find(([_, name]) => name === attackerName)?.[0];
        if (attackerId) {
          if (!killsByPlayerByRound.has(attackerId)) {
            killsByPlayerByRound.set(attackerId, new Map());
          }
          const roundKills = killsByPlayerByRound.get(attackerId)!.get(round.number) || 0;
          killsByPlayerByRound.get(attackerId)!.set(round.number, roundKills + 1);
        }
      }
      
      if (victimName) {
        const victimId = Array.from(playerNames.entries()).find(([_, name]) => name === victimName)?.[0];
        if (victimId) {
          if (!deathTicksByPlayerByRound.has(victimId)) {
            deathTicksByPlayerByRound.set(victimId, new Map());
          }
          deathTicksByPlayerByRound.get(victimId)!.set(round.number, eventTick);
        }
      }
    }
  }
  
  // Track saved weapons (carried from previous round)
  const savedWeapons = new Map<number, Map<number, boolean>>();
  for (let i = 1; i < rounds.length; i++) {
    const prevRound = rounds[i - 1];
    const currRound = rounds[i];
    
    // Check each player for saved weapons
    for (const [playerId, playerRoundInventories] of inventories.entries()) {
      const prevInv = playerRoundInventories.get(prevRound.number);
      const currInv = playerRoundInventories.get(currRound.number);
      
      if (!prevInv || !currInv) continue;
      
      // Check if player has same primary weapon (saved)
      if (prevInv.postBuy.primaryWeapon && 
          currInv.postBuy.primaryWeapon === prevInv.postBuy.primaryWeapon) {
        // Check if they didn't acquire it during buy (no pickup in buy window)
        const roundData = playerRoundInventories.get(currRound.number);
        if (roundData && roundData.acquired.length === 0) {
          if (!savedWeapons.has(playerId)) {
            savedWeapons.set(playerId, new Map());
          }
          savedWeapons.get(playerId)!.set(currRound.number, true);
        }
      }
    }
  }
  
  const result: EconomyResult = {
    byPlayer: new Map(),
  };
  
  // Process each round
  for (const round of rounds) {
    // Group by team and calculate team values
    const ctValues: number[] = [];
    const tValues: number[] = [];
    const ctPlayers: number[] = [];
    const tPlayers: number[] = [];
    
    // Collect inventory data for this round from all players
    for (const [playerId, playerRoundInventories] of inventories.entries()) {
      const invData = playerRoundInventories.get(round.number);
      if (!invData) continue;
      const team = playerTeams.get(playerId);
      const value = calculateInventoryValue(invData.postBuy);
      
      if (team === Team.CT) {
        ctValues.push(value);
        ctPlayers.push(playerId);
      } else if (team === Team.T) {
        tValues.push(value);
        tPlayers.push(playerId);
      }
    }
    
    const ctMedian = ctValues.length > 0 
      ? [...ctValues].sort((a, b) => a - b)[Math.floor(ctValues.length / 2)]
      : 0;
    const tMedian = tValues.length > 0
      ? [...tValues].sort((a, b) => a - b)[Math.floor(tValues.length / 2)]
      : 0;
    
    const ctBuyState = inferTeamBuyState(ctValues, config);
    const tBuyState = inferTeamBuyState(tValues, config);
    
    // Process each player
    for (const [playerId, playerRoundInventories] of inventories.entries()) {
      const invData = playerRoundInventories.get(round.number);
      if (!invData) continue;
      const playerName = playerNames.get(playerId) || 'Unknown';
      const team = playerTeams.get(playerId);
      if (!team || team === Team.SPECTATOR) continue;
      
      const postBuyValue = calculateInventoryValue(invData.postBuy);
      const teamMedian = team === Team.CT ? ctMedian : tMedian;
      const teamBuyState = team === Team.CT ? ctBuyState : tBuyState;
      
      const savedWeapon = savedWeapons.get(playerId)?.get(round.number) || false;
      const droppedWeapon = (invData.dropped?.length || 0) > 0;
      
      const damage = damageByPlayerByRound.get(playerId)?.get(round.number) || 0;
      const kills = killsByPlayerByRound.get(playerId)?.get(round.number) || 0;
      const deathTick = deathTicksByPlayerByRound.get(playerId)?.get(round.number);
      const freezeEndTick = round.freezeEndTick || round.startTick || 0;
      const timeToDeath = deathTick ? (deathTick - freezeEndTick) / tickRate : undefined;
      
      // Initialize player result
      if (!result.byPlayer.has(playerId)) {
        result.byPlayer.set(playerId, {
          events: [],
          matchScore: 0,
          matchConfidence: 0,
          flaggedMatch: false,
          roundSummaries: [],
        });
      }
      
      const playerResult = result.byPlayer.get(playerId)!;
      
      // Add round summary
      playerResult.roundSummaries.push({
        round: round.number,
        preBuyValue: calculateInventoryValue(invData.preBuy),
        postBuyValue,
        acquiredDuringBuy: invData.acquired,
        droppedDuringBuyTo: invData.dropped,
        teamMedianValue: teamMedian,
        teamBuyState,
      });
      
      // Run detectors
      const underbuyEvent = detectUnderbuy(
        round.number, playerId, playerName, postBuyValue, teamMedian, teamBuyState,
        savedWeapon, droppedWeapon, config
      );
      if (underbuyEvent) playerResult.events.push(underbuyEvent);
      
      const overbuyEvent = detectOverbuy(
        round.number, playerId, playerName, postBuyValue, teamMedian, teamBuyState,
        savedWeapon, { kills, damage }, config
      );
      if (overbuyEvent) playerResult.events.push(overbuyEvent);
      
      const kitlessEvent = detectKitlessCT(
        round.number, playerId, playerName, team, postBuyValue,
        invData.postBuy.kit, teamBuyState, config
      );
      if (kitlessEvent) playerResult.events.push(kitlessEvent);
      
      const earlyDeathEvent = detectHighValueEarlyDeath(
        round.number, playerId, playerName, postBuyValue, timeToDeath,
        { kills, damage }, config
      );
      if (earlyDeathEvent) playerResult.events.push(earlyDeathEvent);
    }
  }
  
  // Calculate match scores with pattern multipliers
  for (const [playerId, playerResult] of result.byPlayer.entries()) {
    // Group events by type
    const eventsByType = new Map<EconomyEventType, EconomyEvent[]>();
    for (const event of playerResult.events) {
      if (!eventsByType.has(event.type)) {
        eventsByType.set(event.type, []);
      }
      eventsByType.get(event.type)!.push(event);
    }
    
    // Calculate scores with repetition multipliers
    let totalScore = 0;
    let totalConfidence = 0;
    
    for (const [type, events] of eventsByType.entries()) {
      const repeatCount = events.length;
      const multiplier = Math.min(
        config.patternMultiplierMax,
        config.patternMultiplierBase + (repeatCount - 1) * config.patternMultiplierIncrement
      );
      
      for (const event of events) {
        const adjustedScore = event.score * multiplier;
        const adjustedConfidence = event.confidence * multiplier;
        totalScore += adjustedScore;
        totalConfidence += adjustedConfidence;
      }
    }
    
    playerResult.matchScore = totalScore;
    playerResult.matchConfidence = Math.min(1.0, totalConfidence);
    
    // Flag match if:
    // - 1 strong detector (underbuy/overbuy) triggers >=2 rounds
    // - OR >=4 medium events across match
    const strongEvents = playerResult.events.filter(e => 
      e.type === 'Underbuy' || e.type === 'Overbuy'
    );
    const mediumEvents = playerResult.events.filter(e => 
      e.type === 'KitlessCT' || e.type === 'HighValueEarlyDeath'
    );
    
    playerResult.flaggedMatch = 
      (strongEvents.length >= 2) || 
      (mediumEvents.length >= 4) ||
      (playerResult.matchConfidence >= 0.7);
  }
  
  console.log('[Economy Events Only] Analysis complete:', {
    playersWithEvents: result.byPlayer.size,
    totalEvents: Array.from(result.byPlayer.values()).reduce((sum, p) => sum + p.events.length, 0),
    flaggedPlayers: Array.from(result.byPlayer.values()).filter(p => p.flaggedMatch).length,
  });
  
  return result;
}

