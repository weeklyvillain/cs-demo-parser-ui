/**
 * Economy Griefing / Buy Sabotage Detection
 * 
 * Detects intentional economy sabotage patterns: refusing to buy, troll buys, repeatedly
 * donating expensive guns, hoarding money, etc. Uses only demo-extractable data.
 * 
 * Approach:
 * - Pattern-based detection (not single-round anomalies)
 * - Tracks money, equipment value, and spending patterns per round
 * - Compares player behavior to team economy state
 * - Avoids false positives for legitimate strategies (eco, force buys, hero rifles, saving)
 * - Scores events with confidence and provides human-readable explanations
 */

import { MatchFrame, PlayerState, Round, Team, GameEvent } from '../types';

/**
 * Weapon price table (approximate CS2 prices)
 * Used to calculate equipment values when exact prices aren't available
 */
const WEAPON_PRICES: Record<string, number> = {
  // Rifles
  'ak47': 2700,
  'm4a1': 3100,
  'm4a4': 3100,
  'm4a1_silencer': 2900,
  'aug': 3300,
  'sg556': 3000,
  'galil': 1800,
  'famas': 2050,
  // AWP
  'awp': 4750,
  // Snipers
  'ssg08': 1700,
  'scar20': 5000,
  'g3sg1': 5000,
  // SMGs
  'mac10': 1050,
  'mp9': 1250,
  'mp7': 1500,
  'ump45': 1200,
  'p90': 2350,
  'pp_bizon': 1400,
  'mp5': 1500,
  // Shotguns
  'nova': 1050,
  'xm1014': 2000,
  'sawedoff': 1100,
  'mag7': 1300,
  // Pistols
  'glock': 200,
  'usp_silencer': 200,
  'p250': 300,
  'tec9': 500,
  'five_seven': 500,
  'cz75': 500,
  'deagle': 700,
  'r8_revolver': 600,
  'p2000': 200,
  'dual_berettas': 300,
  // Heavy
  'negev': 1700,
  'm249': 5200,
  // Grenades
  'hegrenade': 300,
  'flashbang': 200,
  'smokegrenade': 300,
  'molotov': 400,
  'incgrenade': 600,
  'decoy': 50,
  // Other
  'zeus': 200,
  'knife': 0,
  'c4': 0,
};

const ARMOR_PRICE = 650;
const HELMET_PRICE = 350;
const DEFUSER_PRICE = 400;

/**
 * Get approximate weapon price
 */
function getWeaponPrice(weaponName: string | undefined): number {
  if (!weaponName) return 0;
  const normalized = weaponName.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return WEAPON_PRICES[normalized] || 0;
}

/**
 * Calculate equipment value from player state
 * Note: If primary weapon is not available in demo data, we estimate based on equipment value
 * and money spent patterns
 */
function calculateEquipmentValue(player: PlayerState): number {
  let value = 0;
  
  // Primary weapon
  if (player.equipment?.primary) {
    value += getWeaponPrice(player.equipment.primary);
  }
  // If primary weapon is not available, we can't accurately calculate value
  // This is a limitation - we'll rely on other signals like money spent
  
  // Grenades
  if (player.equipment?.grenades) {
    for (const nade of player.equipment.grenades) {
      value += getWeaponPrice(nade);
    }
  }
  
  // Armor
  if (player.hasHelmet) {
    value += ARMOR_PRICE + HELMET_PRICE;
  } else if (player.hp > 0) {
    // Assume armor if HP > 0 (might not be perfect, but reasonable heuristic)
    value += ARMOR_PRICE;
  }
  
  // Defuser (CT only)
  if (player.hasDefuser && player.team === Team.CT) {
    value += DEFUSER_PRICE;
  }
  
  return value;
}

/**
 * Configuration for economy griefing detection
 */
export interface EconomyConfig {
  // Money thresholds
  minMoneyToBuy: number; // Minimum money to consider "refusing to buy" (e.g., 3500-4500)
  hoardMoneyThreshold: number; // Money threshold for hoarding (e.g., 4000)
  
  // Equipment value thresholds
  lowEquipValueRatio: number; // Ratio to team median for "low equip" (e.g., 0.4-0.55)
  highEquipValueThreshold: number; // Value threshold for "high value" (e.g., 3000-4000)
  
  // Team buy state inference
  fullBuyEquipValue: number; // Median equip value for full buy (e.g., 4000+)
  forceBuyEquipValue: number; // Median equip value for force buy (e.g., 2000-4000)
  ecoEquipValue: number; // Median equip value for eco (e.g., <2000)
  
  // Time thresholds
  earlyDeathSeconds: number; // Time to death for "early death" (e.g., 15-20s)
  
  // Damage thresholds
  lowDamageThreshold: number; // Damage threshold for "low impact" (e.g., 20-30)
  
  // Pattern detection
  minRepeatCount: number; // Minimum rounds for pattern (e.g., 2-3)
  repeatMultiplier: number; // Confidence multiplier per repeat (e.g., 1.0 + 0.25*(n-1))
  
  // AWP saving detection
  awpPrice: number; // AWP price (4750)
  awpSaveMoneyThreshold: number; // Money threshold for AWP saving (e.g., 3000+)
  
  // Scoring weights
  weights: {
    refuseToBuy: number;
    permaForceBuy: number;
    trollBuys: number;
    weaponDonation: number;
    hoardMoney: number;
    buyThenSuicide: number;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  minMoneyToBuy: 3000, // Lowered: enough for rifle + armor (~$3350)
  hoardMoneyThreshold: 4000,
  lowEquipValueRatio: 0.45,
  highEquipValueThreshold: 3500,
  fullBuyEquipValue: 4000,
  forceBuyEquipValue: 2000,
  ecoEquipValue: 2000,
  earlyDeathSeconds: 18,
  lowDamageThreshold: 25,
  minRepeatCount: 2,
  repeatMultiplier: 0.25,
  awpPrice: 4750,
  awpSaveMoneyThreshold: 3000,
  weights: {
    refuseToBuy: 0.40, // Increased: refusing to buy is a key griefing pattern
    permaForceBuy: 0.20,
    trollBuys: 0.15,
    weaponDonation: 0.20,
    hoardMoney: 0.15,
    buyThenSuicide: 0.15,
  },
};

/**
 * Economy event types
 */
export type EconomyEventType =
  | 'RefuseToBuyWithMoney'
  | 'PermaForceBuyAgainstTeamEconomy'
  | 'TrollBuys'
  | 'WeaponDonationToEnemy'
  | 'HoardMoneyWhileTeamNeedsBuy'
  | 'BuyThenSuicidePeek';

/**
 * Economy event
 */
export interface EconomyEvent {
  round: number;
  time: number; // seconds
  actorId: number;
  actorName: string;
  type: EconomyEventType;
  score: number;
  confidence: number;
  featureSummary: {
    moneyStart?: number;
    moneyAfterBuy?: number;
    equipValue?: number;
    teamMedianEquip?: number;
    teamBuyState?: 'fullBuy' | 'force' | 'eco';
    spent?: number;
    damageDealt?: number;
    timeToDeath?: number;
    carriedOverValue?: number;
    primaryWeapon?: string;
    hasHelmet?: boolean;
    hasDefuser?: boolean;
    grenades?: string[];
  };
  humanReason: string;
}

/**
 * Per-round economy state for a player
 */
interface PlayerRoundEconomy {
  round: number;
  playerId: number;
  playerName: string;
  team: Team;
  moneyStart: number; // Money at round start (freeze end)
  moneyAfterBuy?: number; // Money after buy period (or nearest available)
  equipValue: number; // Equipment value at freeze end
  equipValueAfterBuy?: number; // Equipment value after buy period
  spent: number; // moneyStart - moneyAfterBuy (clamped >= 0)
  carriedOverValue: number; // Value of weapons carried from previous round
  damageDealt: number; // Damage dealt this round
  kills: number; // Kills this round
  timeToDeath?: number; // Seconds until death (if died)
  timeAlive: number; // Total time alive in round
  diedEarly: boolean; // Died within earlyDeathSeconds
  lowImpact: boolean; // Low damage dealt
  hasDefuser: boolean;
  hasHelmet: boolean;
  primaryWeapon?: string;
  grenades: string[];
}

/**
 * Team economy state per round
 */
interface TeamRoundEconomy {
  round: number;
  team: Team;
  avgEquipValue: number;
  medianEquipValue: number;
  avgMoney: number;
  buyState: 'fullBuy' | 'force' | 'eco'; // Inferred from team equip values
  playerEconomies: Map<number, PlayerRoundEconomy>;
}

/**
 * Per-player economy result
 */
export interface EconomyPlayerResult {
  playerId: number;
  playerName: string;
  team: Team;
  events: EconomyEvent[];
  ecoScoreMatch: number;
  flaggedMatch: boolean;
  confidenceMatch: number;
  perRoundScore: Map<number, number>; // round -> score
}

/**
 * Economy griefing result
 */
export interface EconomyResult {
  byPlayer: Map<number, EconomyPlayerResult>;
}

/**
 * Calculate loss streak for a team up to a given round
 */
function calculateLossStreak(roundNumber: number, rounds: Round[], team: Team): number {
  if (roundNumber === 1) return 0;
  
  let streak = 0;
  for (let i = roundNumber - 1; i >= 1; i--) {
    const round = rounds.find(r => r.number === i);
    if (!round || !round.winner) break;
    
    if (round.winner !== team) {
      streak++;
    } else {
      break; // Streak broken by a win
    }
  }
  
  return streak;
}

/**
 * Calculate starting money for a round based on CS2 economy rules
 */
function calculateStartingMoney(
  roundNumber: number,
  team: Team,
  previousRoundWon: boolean,
  lossStreak: number,
  previousRoundMoney?: number
): number {
  // Pistol round (round 1)
  if (roundNumber === 1) {
    return 800;
  }
  
  // Calculate loss bonus (increases with consecutive losses, caps at $3400)
  // Loss bonus: $1400 for first loss, +$500 per additional loss, max $3400
  const lossBonus = Math.min(1400 + (lossStreak - 1) * 500, 3400);
  
  // Win bonus
  const winBonus = 3250;
  
  // Base calculation
  // CS2 economy: money = previous money - spending + round bonus
  // We estimate spending based on typical patterns
  if (previousRoundWon) {
    // Won previous round: win bonus + previous money (minus spending)
    // After a win, players typically spent $2000-4000 on equipment
    if (previousRoundMoney !== undefined) {
      // Estimate they spent 60-80% of their money (typical for full buy)
      const estimatedSpending = previousRoundMoney * 0.7;
      return Math.max(0, previousRoundMoney - estimatedSpending) + winBonus;
    } else {
      // No previous data: estimate conservatively
      // After a win with full buy, players typically have $1000-2000 left + win bonus
      return winBonus + 1500;
    }
  } else {
    // Lost previous round: loss bonus + previous money (minus spending)
    // After a loss, players typically spent less (eco or force buy)
    if (previousRoundMoney !== undefined) {
      // Estimate they spent 40-60% of their money (typical for force buy or partial buy)
      const estimatedSpending = previousRoundMoney * 0.5;
      return Math.max(0, previousRoundMoney - estimatedSpending) + lossBonus;
    } else {
      // No previous data: estimate conservatively
      // After a loss, players typically have $500-1000 left + loss bonus
      return lossBonus + 750;
    }
  }
}



/**
 * Extract economy state for all players in a round
 */
function extractRoundEconomy(
  round: Round,
  frames: MatchFrame[],
  events: GameEvent[],
  tickRate: number,
  previousRoundEconomy?: Map<number, PlayerRoundEconomy>,
  previousRound?: Round,
  allRounds?: Round[]
): Map<number, PlayerRoundEconomy> {
  const playerEconomies = new Map<number, PlayerRoundEconomy>();
  const freezeEndTick = round.freezeEndTick || round.startTick || 0;
  const roundEndTick = round.endTick || (frames.length > 0 ? frames[frames.length - 1].tick : freezeEndTick);
  
  // Find freeze end frame and a frame ~10 seconds after (for "after buy" state)
  const freezeEndFrame = frames.find(f => f.tick >= freezeEndTick && f.tick <= freezeEndTick + tickRate * 2);
  const afterBuyFrame = frames.find(f => 
    f.tick >= freezeEndTick + tickRate * 5 && 
    f.tick <= freezeEndTick + tickRate * 15 &&
    f.tick <= roundEndTick
  );
  
  // Get player states at freeze end
  const freezeEndPlayers = new Map<number, PlayerState>();
  if (freezeEndFrame) {
    for (const player of freezeEndFrame.players) {
      if (player.team !== Team.SPECTATOR) {
        freezeEndPlayers.set(player.id, player);
      }
    }
  }
  
  // Get player states after buy period
  const afterBuyPlayers = new Map<number, PlayerState>();
  if (afterBuyFrame) {
    for (const player of afterBuyFrame.players) {
      if (player.team !== Team.SPECTATOR) {
        afterBuyPlayers.set(player.id, player);
      }
    }
  }
  
  // Track damage and kills per player
  const damageByPlayer = new Map<number, number>();
  const killsByPlayer = new Map<number, number>();
  const deathTicks = new Map<number, number>();
  
  for (const event of events) {
    if (event.type === 'damage' && event.attackerName && event.damage) {
      const attacker = Array.from(freezeEndPlayers.values()).find(p => p.name === event.attackerName);
      if (attacker) {
        damageByPlayer.set(attacker.id, (damageByPlayer.get(attacker.id) || 0) + event.damage);
      }
    }
    if (event.type === 'kill' && event.attackerName) {
      const attacker = Array.from(freezeEndPlayers.values()).find(p => p.name === event.attackerName);
      if (attacker) {
        killsByPlayer.set(attacker.id, (killsByPlayer.get(attacker.id) || 0) + 1);
      }
      if (event.victimName) {
        const victim = Array.from(freezeEndPlayers.values()).find(p => p.name === event.victimName);
        if (victim && event.tick) {
          deathTicks.set(victim.id, event.tick);
        }
      }
    }
  }
  
  // Calculate carried over value (weapon from previous round)
  const carriedOverValues = new Map<number, number>();
  if (previousRoundEconomy) {
    for (const [playerId, prevEco] of previousRoundEconomy.entries()) {
      const currentPlayer = freezeEndPlayers.get(playerId);
      if (currentPlayer && prevEco.primaryWeapon) {
        // Check if player still has the same primary weapon
        if (currentPlayer.equipment?.primary === prevEco.primaryWeapon) {
          carriedOverValues.set(playerId, getWeaponPrice(prevEco.primaryWeapon));
        }
      }
    }
  }
  
  // Calculate team loss streaks for money calculation
  const ctLossStreak = allRounds ? calculateLossStreak(round.number, allRounds, Team.CT) : 0;
  const tLossStreak = allRounds ? calculateLossStreak(round.number, allRounds, Team.T) : 0;
  
  // Build economy state for each player
  for (const [playerId, player] of freezeEndPlayers.entries()) {
    const equipValue = calculateEquipmentValue(player);
    const afterBuyPlayer = afterBuyPlayers.get(playerId);
    const equipValueAfterBuy = afterBuyPlayer ? calculateEquipmentValue(afterBuyPlayer) : equipValue;
    
    // Calculate money using CS2 economy rules
    const previousEco = previousRoundEconomy?.get(playerId);
    const previousRoundWon = previousRound?.winner === player.team;
    const lossStreak = player.team === Team.CT ? ctLossStreak : tLossStreak;
    
    // Calculate starting money
    const previousRoundMoney = previousEco?.moneyAfterBuy;
    const calculatedMoneyStart = calculateStartingMoney(
      round.number,
      player.team,
      previousRoundWon || false,
      lossStreak,
      previousRoundMoney
    );
    
    // Get money from events (kills, bomb plant/defuse)
    // Use kills already tracked from events above
    const playerKills = killsByPlayer.get(playerId) || 0;
    const killMoney = playerKills * 300; // $300 per kill
    
    // Check for bomb plant/defuse in events
    const roundStartTick = round.startTick || 0;
    const roundEndTick = round.endTick || Infinity;
    let bombBonus = 0;
    for (const event of events) {
      if (event.tick < roundStartTick || event.tick > roundEndTick) continue;
      if (event.type === 'plant' && player.team === Team.T) {
        bombBonus = 300;
        break;
      }
      if (event.type === 'defuse' && player.team === Team.CT) {
        bombBonus = 300;
        break;
      }
    }
    
    // Calculate money after buy period
    // Start with calculated money, add event bonuses, subtract estimated spending
    // Note: Event bonuses (kills, bomb) happen during the round, not at start
    // So moneyStart is just the calculated starting money
    // moneyAfterBuy should account for spending during buy period
    const estimatedSpending = Math.max(0, equipValueAfterBuy - equipValue);
    const moneyStart = calculatedMoneyStart;
    // After buy: starting money minus spending (event bonuses come later in round)
    // Cap moneyAfterBuy to be reasonable (players rarely have >$10000)
    const moneyAfterBuy = Math.min(10000, Math.max(0, calculatedMoneyStart - estimatedSpending));
    
    // Calculate spent (money difference)
    // When weapons aren't tracked, this will be low (just armor changes)
    // So we also estimate from equipment value changes as a fallback
    const spentFromMoney = Math.max(0, moneyStart - moneyAfterBuy);
    const spentFromEquip = Math.max(0, equipValueAfterBuy - equipValue);
    // Use the higher of the two to get a better estimate
    const spent = Math.max(spentFromMoney, spentFromEquip);
    const carriedOverValue = carriedOverValues.get(playerId) || 0;
    
    const damageDealt = damageByPlayer.get(playerId) || 0;
    const kills = killsByPlayer.get(playerId) || 0;
    
    const deathTick = deathTicks.get(playerId);
    const timeToDeath = deathTick ? (deathTick - freezeEndTick) / tickRate : undefined;
    const timeAlive = timeToDeath ?? ((roundEndTick - freezeEndTick) / tickRate);
    
    const config = DEFAULT_ECONOMY_CONFIG;
    const diedEarly = timeToDeath !== undefined && timeToDeath < config.earlyDeathSeconds;
    const lowImpact = damageDealt < config.lowDamageThreshold;
    
    // Debug logging for all rounds - show calculated money
    console.log(`[Economy Debug] Round ${round.number}, Player: ${player.name}, Team: ${player.team}, CalculatedMoney: $${calculatedMoneyStart}, MoneyStart: $${moneyStart}, EquipValue: $${equipValue}, EquipValueAfterBuy: $${equipValueAfterBuy}, Spent: $${spent}, Primary: ${player.equipment?.primary || 'NONE'}, HasHelmet: ${player.hasHelmet}, HasDefuser: ${player.hasDefuser}, PreviousRoundMoney: ${previousRoundMoney || 'N/A'}, PreviousRoundWon: ${previousRoundWon}, LossStreak: ${lossStreak}`);
    
    playerEconomies.set(playerId, {
      round: round.number,
      playerId,
      playerName: player.name,
      team: player.team,
      moneyStart,
      moneyAfterBuy,
      equipValue,
      equipValueAfterBuy,
      spent,
      carriedOverValue,
      damageDealt,
      kills,
      timeToDeath,
      timeAlive,
      diedEarly,
      lowImpact,
      hasDefuser: player.hasDefuser || false,
      hasHelmet: player.hasHelmet || false,
      primaryWeapon: player.equipment?.primary,
      grenades: player.equipment?.grenades || [],
    });
  }
  
  return playerEconomies;
}

/**
 * Infer team buy state from player economies
 * Uses both equipment value and money to determine buy state
 * When weapons aren't tracked, equipment values are low, so money is the primary signal
 */
function inferTeamBuyState(playerEconomies: Map<number, PlayerRoundEconomy>, team: Team, config: EconomyConfig): 'fullBuy' | 'force' | 'eco' {
  const teamEconomies = Array.from(playerEconomies.values()).filter(e => e.team === team);
  if (teamEconomies.length === 0) return 'eco';
  
  const equipValues = teamEconomies.map(e => e.equipValue).sort((a, b) => a - b);
  const medianEquip = equipValues[Math.floor(equipValues.length / 2)];
  const avgMoney = teamEconomies.reduce((sum, e) => sum + e.moneyStart, 0) / teamEconomies.length;
  const medianMoney = teamEconomies.map(e => e.moneyStart).sort((a, b) => a - b)[Math.floor(teamEconomies.length / 2)];
  
  // If weapons aren't being tracked, equipment values will be artificially low (just armor ~$650-1000)
  // Use money as the primary signal in this case
  const weaponsNotTracked = medianEquip < 1500; // If median equipment is very low, weapons likely not tracked
  
  if (weaponsNotTracked) {
    // Use money as primary signal
    // Full buy: most players have >= $3000 (enough for rifle + armor)
    // Force buy: most players have $2000-3000 (can buy SMG/cheap rifle)
    // Eco: most players have < $2000
    
    const playersWithFullBuyMoney = teamEconomies.filter(e => e.moneyStart >= 3000).length;
    const playersWithForceBuyMoney = teamEconomies.filter(e => e.moneyStart >= 2000 && e.moneyStart < 3000).length;
    const fullBuyRatio = playersWithFullBuyMoney / teamEconomies.length;
    const forceBuyRatio = playersWithForceBuyMoney / teamEconomies.length;
    
    if (fullBuyRatio >= 0.6 || medianMoney >= 3500) {
      // Most players have money for full buy
      return 'fullBuy';
    } else if (forceBuyRatio >= 0.5 || (medianMoney >= 2000 && medianMoney < 3500)) {
      // Most players have money for force buy
      return 'force';
    } else {
      // Most players don't have money
      return 'eco';
    }
  }
  
  // Standard inference based on equipment value (when weapons are tracked)
  if (medianEquip >= config.fullBuyEquipValue) return 'fullBuy';
  if (medianEquip >= config.forceBuyEquipValue) return 'force';
  return 'eco';
}

/**
 * Detector A: RefuseToBuyWithMoney
 */
function detectRefuseToBuy(
  playerEco: PlayerRoundEconomy,
  teamEco: TeamRoundEconomy,
  config: EconomyConfig
): EconomyEvent | null {
  if (playerEco.team !== teamEco.team) return null;
  
  // Check conditions
  if (playerEco.moneyStart < config.minMoneyToBuy) {
    console.log(`[RefuseToBuy] ${playerEco.playerName} R${playerEco.round}: Money $${playerEco.moneyStart} < minMoneyToBuy $${config.minMoneyToBuy} - SKIP`);
    return null;
  }
  
  // If team buy state is eco, check if it's actually eco or just weapons not tracked
  // If team has high money but low equipment, they likely bought but weapons aren't tracked
  const teamActuallyEco = teamEco.buyState === 'eco' && teamEco.avgMoney < 2000;
  if (teamActuallyEco) {
    console.log(`[RefuseToBuy] ${playerEco.playerName} R${playerEco.round}: Team actually eco (avgMoney $${teamEco.avgMoney.toFixed(0)}) - SKIP`);
    return null; // Team is actually eco, not suspicious
  }
  
  const equipRatio = teamEco.medianEquipValue > 0 
    ? playerEco.equipValue / teamEco.medianEquipValue 
    : 1.0;
  
  if (equipRatio >= config.lowEquipValueRatio) {
    console.log(`[RefuseToBuy] ${playerEco.playerName} R${playerEco.round}: EquipRatio ${equipRatio.toFixed(2)} >= ${config.lowEquipValueRatio} - SKIP`);
    return null; // Player bought appropriately
  }
  if (playerEco.carriedOverValue > 2000) {
    console.log(`[RefuseToBuy] ${playerEco.playerName} R${playerEco.round}: Has saved rifle ($${playerEco.carriedOverValue}) - SKIP`);
    return null; // Has saved rifle, legit
  }
  
  // Additional check: if player has enough money for force buy/rifle but only has pistol-tier equipment
  // This catches cases like buying only Tec-9 when team is buying
  const minForceBuy = 2400; // Galil/FAMAS + armor (~$2450-2700)
  const minRifleBuy = 3000; // AK/M4 + armor (~$3350-3400)
  
  // Check if player has pistol-tier equipment (no primary OR primary is pistol)
  const isPistolOnly = !playerEco.primaryWeapon || 
    (playerEco.primaryWeapon && getWeaponPrice(playerEco.primaryWeapon) < 1000); // Pistols are < $1000
  
  // Check by equipment value - if equip value is very low, likely pistol-only
  // Pistol + armor = ~$1150, force buy (Galil) + armor = ~$2450, rifle + armor = ~$4000+
  // If weapons aren't tracked, equipment values will be low (just armor ~$650)
  const lowEquipValue = playerEco.equipValue < 2000; // Less than force buy value
  const veryLowEquipValue = playerEco.equipValue < 1500; // Likely just pistol + armor or just armor
  
  // Check if team is actually buying (has money) even if equipment values are low (weapons not tracked)
  const teamHasMoney = teamEco.avgMoney >= 2500; // Team average money suggests they can force buy
  const teamHasFullBuyMoney = teamEco.avgMoney >= 3500; // Team average money suggests they can full buy
  const isBuyContext = teamEco.buyState === 'fullBuy' || teamEco.buyState === 'force' ||
    (teamEco.buyState === 'eco' && (teamHasMoney || teamHasFullBuyMoney) && teamEco.medianEquipValue < 1500);
  
  // Key detection: player has money for force buy/rifle, team is buying, but player has low equipment
  // This catches the Tec-9 case: player has $2500+ but only $650-1150 equipment (just armor or pistol+armor)
  const hasMoneyForForceBuy = playerEco.moneyStart >= minForceBuy;
  const hasMoneyForRifle = playerEco.moneyStart >= minRifleBuy;
  
  // Additional guard: Check if player actually spent money
  // If they spent a reasonable amount, they likely bought something even if not tracked
  // But if weapons aren't tracked, spending might be underestimated
  // So we check: if they have money but equipment is very low AND they didn't spend much, it's suspicious
  const spentVeryLittle = playerEco.spent < 1000; // Less than $1000 spent suggests minimal buy
  const weaponsNotTracked = teamEco.medianEquipValue < 1500; // Team equipment is low, weapons likely not tracked
  
  // Simplified detection logic:
  // Flag if: team is buying, player has money, but player has very low equipment
  // When weapons aren't tracked, we can't rely on spending - use equipment value as primary signal
  // When weapons are tracked, we can use spending as additional confirmation
  
  // Core condition: player has money for force buy but low equipment
  const hasMoneyButLowEquip = hasMoneyForForceBuy && (isPistolOnly || veryLowEquipValue);
  
  // Additional confirmation: if weapons are tracked, also check spending
  const spendingConfirms = weaponsNotTracked || spentVeryLittle;
  
  const shouldFlag = isBuyContext && hasMoneyButLowEquip && spendingConfirms;
  
  // Debug logging for all checks
  console.log(`[RefuseToBuy] ${playerEco.playerName} R${playerEco.round}: Money=$${playerEco.moneyStart}, Equip=$${playerEco.equipValue}, Spent=$${playerEco.spent}, Primary=${playerEco.primaryWeapon || 'NONE'}, TeamState=${teamEco.buyState}, TeamAvgMoney=$${teamEco.avgMoney.toFixed(0)}, TeamMedian=$${teamEco.medianEquipValue}, isBuyContext=${isBuyContext}, hasMoneyForForceBuy=${hasMoneyForForceBuy}, isPistolOnly=${isPistolOnly}, veryLowEquipValue=${veryLowEquipValue}, weaponsNotTracked=${weaponsNotTracked}, spentVeryLittle=${spentVeryLittle}, shouldFlag=${shouldFlag}`);
  
  if (shouldFlag) {
    // Debug logging
    console.log(`[Economy Griefing] Detected RefuseToBuy: ${playerEco.playerName}, Round ${playerEco.round}, Money: $${playerEco.moneyStart}, EquipValue: $${playerEco.equipValue}, Spent: $${playerEco.spent}, Primary: ${playerEco.primaryWeapon || 'NONE'}, TeamMedian: $${teamEco.medianEquipValue}, TeamAvgMoney: $${teamEco.avgMoney.toFixed(0)}, TeamBuyState: ${teamEco.buyState}, EquipRatio: ${equipRatio.toFixed(2)}`);
    
    // Boost score based on how much money they had vs what they bought
    // If they had money for rifle but only bought pistol, it's more suspicious
    const moneyRatio = hasMoneyForRifle ? 1.5 : 1.2; // Higher multiplier if they had rifle money
    const equipMultiplier = veryLowEquipValue ? 1.3 : 1.0; // Higher if equipment is very low
    
    const score = config.weights.refuseToBuy * moneyRatio * equipMultiplier;
    const confidence = Math.min(1.0, score * 2.5);
    
    return {
      round: playerEco.round,
      time: 0,
      actorId: playerEco.playerId,
      actorName: playerEco.playerName,
      type: 'RefuseToBuyWithMoney',
      score,
      confidence,
      featureSummary: {
        moneyStart: playerEco.moneyStart,
        moneyAfterBuy: playerEco.moneyAfterBuy,
        equipValue: playerEco.equipValue,
        teamMedianEquip: teamEco.medianEquipValue,
        teamBuyState: teamEco.buyState,
        spent: playerEco.spent,
        carriedOverValue: playerEco.carriedOverValue,
        primaryWeapon: playerEco.primaryWeapon,
      },
      humanReason: `Had $${playerEco.moneyStart.toLocaleString()} (enough for ${hasMoneyForRifle ? 'rifle' : 'force buy'}), team ${teamEco.buyState === 'fullBuy' ? 'full bought' : teamEco.buyState === 'force' ? 'force bought' : 'bought'}, but only bought ${playerEco.primaryWeapon || 'pistol'} ($${playerEco.equipValue.toLocaleString()} total) (round ${playerEco.round}).`,
    };
  }
  
  // Check if saving for AWP (weak guard, but helps)
  if (playerEco.moneyStart >= config.awpSaveMoneyThreshold && 
      playerEco.moneyAfterBuy && playerEco.moneyAfterBuy >= config.awpSaveMoneyThreshold) {
    // Might be saving for AWP - reduce confidence
    // (We don't have AWP usage history here, so this is a weak guard)
  }
  
  const score = config.weights.refuseToBuy * (1.0 - equipRatio);
  const confidence = Math.min(1.0, score * 2.0);
  
  return {
    round: playerEco.round,
    time: 0, // Will be set by caller
    actorId: playerEco.playerId,
    actorName: playerEco.playerName,
    type: 'RefuseToBuyWithMoney',
    score,
    confidence,
    featureSummary: {
      moneyStart: playerEco.moneyStart,
      moneyAfterBuy: playerEco.moneyAfterBuy,
      equipValue: playerEco.equipValue,
      teamMedianEquip: teamEco.medianEquipValue,
      teamBuyState: teamEco.buyState,
      spent: playerEco.spent,
      carriedOverValue: playerEco.carriedOverValue,
    },
    humanReason: `Had $${playerEco.moneyStart.toLocaleString()}, team ${teamEco.buyState === 'fullBuy' ? 'full bought' : 'force bought'}, but bought only $${playerEco.equipValue.toLocaleString()} worth (round ${playerEco.round}).`,
  };
}

/**
 * Detector B: PermaForceBuyAgainstTeamEconomy
 */
function detectPermaForceBuy(
  playerEco: PlayerRoundEconomy,
  teamEco: TeamRoundEconomy,
  config: EconomyConfig
): EconomyEvent | null {
  if (playerEco.team !== teamEco.team) return null;
  
  if (teamEco.buyState !== 'eco') return null; // Team is buying, not suspicious
  
  if (playerEco.spent < config.forceBuyEquipValue) return null; // Didn't spend enough
  
  // Check for low impact
  if (!playerEco.lowImpact && !playerEco.diedEarly) return null; // Had impact, might be legit
  
  const score = config.weights.permaForceBuy * (playerEco.spent / 5000); // Normalize by max spend
  const confidence = Math.min(1.0, score * 1.5);
  
  return {
    round: playerEco.round,
    time: 0,
    actorId: playerEco.playerId,
    actorName: playerEco.playerName,
    type: 'PermaForceBuyAgainstTeamEconomy',
    score,
    confidence,
    featureSummary: {
      moneyStart: playerEco.moneyStart,
      spent: playerEco.spent,
      teamBuyState: teamEco.buyState,
      damageDealt: playerEco.damageDealt,
      timeToDeath: playerEco.timeToDeath,
    },
    humanReason: `Team eco, but spent $${playerEco.spent.toLocaleString()} and ${playerEco.diedEarly ? 'died early' : 'dealt low damage'} (round ${playerEco.round}).`,
  };
}

/**
 * Detector C: TrollBuys / Non-sense loadouts
 */
function detectTrollBuys(
  playerEco: PlayerRoundEconomy,
  teamEco: TeamRoundEconomy,
  config: EconomyConfig
): EconomyEvent | null {
  if (playerEco.team !== teamEco.team) return null;
  
  let suspicious = false;
  let reason = '';
  
  // Check for no armor with money
  if (playerEco.moneyStart >= config.minMoneyToBuy && !playerEco.hasHelmet && playerEco.equipValue > 1000) {
    suspicious = true;
    reason = `Bought weapon but no armor/helmet`;
  }
  
  // Check for no defuser on CT with money (in full buy context)
  if (playerEco.team === Team.CT && 
      teamEco.buyState === 'fullBuy' && 
      playerEco.moneyStart >= config.minMoneyToBuy && 
      !playerEco.hasDefuser) {
    suspicious = true;
    reason = `CT full buy but no defuser kit`;
  }
  
  // Check for excessive grenades without primary (weak signal)
  if (playerEco.grenades.length >= 4 && !playerEco.primaryWeapon && playerEco.equipValue > 1000) {
    suspicious = true;
    reason = `Bought many grenades but no primary weapon`;
  }
  
  if (!suspicious) return null;
  
  const score = config.weights.trollBuys * 0.5; // Lower weight for single-round
  const confidence = Math.min(1.0, score * 1.2);
  
  return {
    round: playerEco.round,
    time: 0,
    actorId: playerEco.playerId,
    actorName: playerEco.playerName,
    type: 'TrollBuys',
    score,
    confidence,
    featureSummary: {
      moneyStart: playerEco.moneyStart,
      equipValue: playerEco.equipValue,
      hasHelmet: playerEco.hasHelmet,
      hasDefuser: playerEco.hasDefuser,
      primaryWeapon: playerEco.primaryWeapon,
      grenades: playerEco.grenades,
    },
    humanReason: `${reason} (round ${playerEco.round}).`,
  };
}

/**
 * Detector D: WeaponDonationToEnemy
 */
function detectWeaponDonation(
  playerEco: PlayerRoundEconomy,
  teamEco: TeamRoundEconomy,
  config: EconomyConfig
): EconomyEvent | null {
  if (playerEco.team !== teamEco.team) return null;
  
  if (playerEco.equipValue < config.highEquipValueThreshold) return null;
  if (!playerEco.diedEarly) return null;
  if (!playerEco.lowImpact) return null;
  
  const score = config.weights.weaponDonation * (playerEco.equipValue / 5000);
  const confidence = Math.min(1.0, score * 2.0);
  
  return {
    round: playerEco.round,
    time: 0,
    actorId: playerEco.playerId,
    actorName: playerEco.playerName,
    type: 'WeaponDonationToEnemy',
    score,
    confidence,
    featureSummary: {
      equipValue: playerEco.equipValue,
      damageDealt: playerEco.damageDealt,
      timeToDeath: playerEco.timeToDeath,
      primaryWeapon: playerEco.primaryWeapon,
    },
    humanReason: `Had $${playerEco.equipValue.toLocaleString()} worth of equipment, died in ${playerEco.timeToDeath?.toFixed(1)}s with ${playerEco.damageDealt} damage (round ${playerEco.round}).`,
  };
}

/**
 * Detector E: HoardMoneyWhileTeamNeedsBuy
 */
function detectHoardMoney(
  playerEco: PlayerRoundEconomy,
  teamEco: TeamRoundEconomy,
  config: EconomyConfig
): EconomyEvent | null {
  if (playerEco.team !== teamEco.team) return null;
  
  const moneyAfter = playerEco.moneyAfterBuy ?? playerEco.moneyStart;
  if (moneyAfter < config.hoardMoneyThreshold) return null;
  
  if (teamEco.buyState === 'eco') return null; // Team is eco, hoarding is less suspicious
  
  // Check if player has saved carry (high value weapon)
  if (playerEco.carriedOverValue > 2000) return null; // Has saved rifle, legit
  
  // Check if player has high equip value (might have bought)
  if (playerEco.equipValue >= config.forceBuyEquipValue) return null; // Bought appropriately
  
  // If weapons aren't tracked, equipment values are low - check if player actually spent money
  // If player spent significant money (>= $2000), they likely bought something even if not tracked
  const spent = playerEco.spent || 0;
  if (spent >= 2000) return null; // Player spent money, likely bought weapon (just not tracked)
  
  // Additional check: if player's money decreased significantly, they likely bought
  const moneyDecrease = (playerEco.moneyStart - moneyAfter);
  if (moneyDecrease >= 2000) return null; // Player spent money, likely bought something
  
  // Only flag if:
  // 1. Player kept high money after buy
  // 2. Equipment value is low (weapons not tracked OR didn't buy)
  // 3. Player didn't spend much money (didn't buy)
  // 4. Team is buying (not eco)
  
  // Be more strict: require very high money AND very low equipment AND no spending
  const weaponsNotTracked = teamEco.medianEquipValue < 1500; // Team equipment is low, weapons likely not tracked
  if (weaponsNotTracked) {
    // If weapons aren't tracked, only flag if money is VERY high and player clearly didn't spend
    if (moneyAfter < 5000) return null; // Need very high money to be suspicious
    if (moneyDecrease >= 1000) return null; // If they spent money, they likely bought something
    if (spent >= 1000) return null; // If equipment value increased, they likely bought
  }
  
  const score = config.weights.hoardMoney * (moneyAfter / 10000); // Normalize
  const confidence = Math.min(1.0, score * 1.5);
  
  return {
    round: playerEco.round,
    time: 0,
    actorId: playerEco.playerId,
    actorName: playerEco.playerName,
    type: 'HoardMoneyWhileTeamNeedsBuy',
    score,
    confidence,
    featureSummary: {
      moneyAfterBuy: moneyAfter,
      equipValue: playerEco.equipValue,
      teamBuyState: teamEco.buyState,
      teamMedianEquip: teamEco.medianEquipValue,
      carriedOverValue: playerEco.carriedOverValue,
      spent: spent,
    },
    humanReason: `Kept $${moneyAfter.toLocaleString()} after buy while team ${teamEco.buyState === 'fullBuy' ? 'full bought' : 'force bought'} (round ${playerEco.round}).`,
  };
}

/**
 * Detector F/G: BuyThenSuicidePeek (economy-focused)
 */
function detectBuyThenSuicide(
  playerEco: PlayerRoundEconomy,
  teamEco: TeamRoundEconomy,
  config: EconomyConfig
): EconomyEvent | null {
  if (playerEco.team !== teamEco.team) return null;
  
  if (playerEco.spent < config.forceBuyEquipValue) return null; // Didn't spend enough
  if (!playerEco.diedEarly) return null;
  if (!playerEco.lowImpact) return null;
  
  const score = config.weights.buyThenSuicide * (playerEco.spent / 5000);
  const confidence = Math.min(1.0, score * 1.8);
  
  return {
    round: playerEco.round,
    time: 0,
    actorId: playerEco.playerId,
    actorName: playerEco.playerName,
    type: 'BuyThenSuicidePeek',
    score,
    confidence,
    featureSummary: {
      spent: playerEco.spent,
      damageDealt: playerEco.damageDealt,
      timeToDeath: playerEco.timeToDeath,
    },
    humanReason: `Spent $${playerEco.spent.toLocaleString()}, died in ${playerEco.timeToDeath?.toFixed(1)}s with ${playerEco.damageDealt} damage (round ${playerEco.round}).`,
  };
}

/**
 * Main detection function
 */
export function detectEconomyGriefing(
  rounds: Round[],
  frames: MatchFrame[],
  events: GameEvent[],
  tickRate: number,
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG
): EconomyResult {
  console.log('[Economy Griefing] Starting detection...', { rounds: rounds.length, frames: frames.length, events: events.length, tickRate });
  const byPlayer = new Map<number, EconomyPlayerResult>();
  const allEvents: EconomyEvent[] = [];
  const allPlayerEconomies = new Map<number, PlayerRoundEconomy>(); // Track all player economies for team lookup
  
  // Track previous round economy for carried-over value calculation
  let previousRoundEconomy: Map<number, PlayerRoundEconomy> | undefined;
  
  // Process each round
  for (const round of rounds) {
    if (!round.startTick) continue;
    console.log(`[Economy Griefing] Processing round ${round.number}...`);
    
    // Extract economy state for this round
    const playerEconomies = extractRoundEconomy(round, frames, events, tickRate, previousRoundEconomy);
    previousRoundEconomy = playerEconomies;
    
    console.log(`[Economy Griefing] Round ${round.number}: Extracted ${playerEconomies.size} player economies`);
    
    // Store player economies for later lookup
    for (const [playerId, eco] of playerEconomies.entries()) {
      allPlayerEconomies.set(playerId, eco);
    }
    
    // Group by team and infer team buy states
    const ctEconomies = new Map<number, PlayerRoundEconomy>();
    const tEconomies = new Map<number, PlayerRoundEconomy>();
    
    for (const [playerId, eco] of playerEconomies.entries()) {
      if (eco.team === Team.CT) {
        ctEconomies.set(playerId, eco);
      } else if (eco.team === Team.T) {
        tEconomies.set(playerId, eco);
      }
    }
    
    const ctEquipValues = Array.from(ctEconomies.values()).map(e => e.equipValue);
    const tEquipValues = Array.from(tEconomies.values()).map(e => e.equipValue);
    
    const ctTeamEco: TeamRoundEconomy = {
      round: round.number,
      team: Team.CT,
      avgEquipValue: ctEquipValues.length > 0 ? ctEquipValues.reduce((a, b) => a + b, 0) / ctEquipValues.length : 0,
      medianEquipValue: ctEquipValues.length > 0 
        ? ctEquipValues.sort((a, b) => a - b)[Math.floor(ctEquipValues.length / 2)]
        : 0,
      avgMoney: Array.from(ctEconomies.values()).reduce((sum, e) => sum + (e.moneyStart || 0), 0) / Math.max(1, ctEconomies.size),
      buyState: inferTeamBuyState(playerEconomies, Team.CT, config),
      playerEconomies: ctEconomies,
    };
    
    const tTeamEco: TeamRoundEconomy = {
      round: round.number,
      team: Team.T,
      avgEquipValue: tEquipValues.length > 0 ? tEquipValues.reduce((a, b) => a + b, 0) / tEquipValues.length : 0,
      medianEquipValue: tEquipValues.length > 0
        ? tEquipValues.sort((a, b) => a - b)[Math.floor(tEquipValues.length / 2)]
        : 0,
      avgMoney: Array.from(tEconomies.values()).reduce((sum, e) => sum + (e.moneyStart || 0), 0) / Math.max(1, tEconomies.size),
      buyState: inferTeamBuyState(playerEconomies, Team.T, config),
      playerEconomies: tEconomies,
    };
    
    // Find freeze end time for event timing
    const freezeEndTick = round.freezeEndTick || round.startTick;
    const freezeEndFrame = frames.find(f => f.tick >= freezeEndTick && f.tick <= freezeEndTick + tickRate * 2);
    const eventTime = freezeEndFrame?.time || 0;
    
    // Run detectors for each player
    for (const [playerId, playerEco] of playerEconomies.entries()) {
      const teamEco = playerEco.team === Team.CT ? ctTeamEco : tTeamEco;
      
      // Log all player economies for debugging
      console.log(`[Economy Griefing] Round ${round.number}, Player: ${playerEco.playerName}, Money: $${playerEco.moneyStart}, EquipValue: $${playerEco.equipValue}, Spent: $${playerEco.spent}, TeamMedian: $${teamEco.medianEquipValue}, TeamBuyState: ${teamEco.buyState}, Primary: ${playerEco.primaryWeapon || 'NONE'}, TeamAvgMoney: $${teamEco.avgMoney.toFixed(0)}`);
      
      // Run all detectors
      const detectors = [
        () => detectRefuseToBuy(playerEco, teamEco, config),
        () => detectPermaForceBuy(playerEco, teamEco, config),
        () => detectTrollBuys(playerEco, teamEco, config),
        () => detectWeaponDonation(playerEco, teamEco, config),
        () => detectHoardMoney(playerEco, teamEco, config),
        () => detectBuyThenSuicide(playerEco, teamEco, config),
      ];
      
      for (const detector of detectors) {
        const event = detector();
        if (event) {
          event.time = eventTime;
          allEvents.push(event);
          console.log(`[Economy Griefing] Event detected: ${event.type} for ${event.actorName} in round ${event.round}, confidence: ${(event.confidence * 100).toFixed(1)}%`);
        }
      }
    }
  }
  
  // Group events by player and calculate scores
  const eventsByPlayer = new Map<number, EconomyEvent[]>();
  for (const event of allEvents) {
    if (!eventsByPlayer.has(event.actorId)) {
      eventsByPlayer.set(event.actorId, []);
    }
    eventsByPlayer.get(event.actorId)!.push(event);
  }
  
  // Build results per player
  for (const [playerId, playerEvents] of eventsByPlayer.entries()) {
    if (playerEvents.length === 0) continue;
    
    // Count repeats per event type
    const typeCounts = new Map<EconomyEventType, number>();
    for (const event of playerEvents) {
      typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
    }
    
    // Apply repeat multipliers
    const adjustedEvents = playerEvents.map(event => {
      const repeatCount = typeCounts.get(event.type) || 1;
      if (repeatCount >= config.minRepeatCount) {
        const multiplier = 1.0 + config.repeatMultiplier * (repeatCount - 1);
        return {
          ...event,
          confidence: Math.min(1.0, event.confidence * multiplier),
          score: event.score * multiplier,
        };
      }
      return event;
    });
    
    // Calculate per-round scores
    const perRoundScore = new Map<number, number>();
    for (const event of adjustedEvents) {
      const current = perRoundScore.get(event.round) || 0;
      perRoundScore.set(event.round, current + event.score);
    }
    
    // Calculate match score
    const ecoScoreMatch = adjustedEvents.reduce((sum, e) => sum + e.score, 0);
    const confidenceMatch = Math.min(1.0, adjustedEvents.reduce((sum, e) => sum + e.confidence, 0) / Math.max(1, adjustedEvents.length));
    const flaggedMatch = ecoScoreMatch >= 0.5; // Threshold for flagging
    
    const firstEvent = adjustedEvents[0];
    // Get team from player economy data (will be fixed below if needed)
    const playerEco = allPlayerEconomies.get(playerId);
    byPlayer.set(playerId, {
      playerId,
      playerName: firstEvent.actorName,
      team: playerEco?.team || Team.SPECTATOR, // Will be fixed by caller if needed
      events: adjustedEvents,
      ecoScoreMatch,
      flaggedMatch,
      confidenceMatch,
      perRoundScore,
    });
  }
  
  // Fix team assignment (get from first frame)
  for (const [playerId, result] of byPlayer.entries()) {
    const player = frames.find(f => f.players.some(p => p.id === playerId))?.players.find(p => p.id === playerId);
    if (player) {
      result.team = player.team;
    }
  }
  
  console.log(`[Economy Griefing] Detection complete. Found ${allEvents.length} events across ${byPlayer.size} players`);
  
  return { byPlayer };
}

