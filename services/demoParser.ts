import { DemoFile, MatchFrame, Team, PlayerState, GameEvent, Round } from '../types';
import { generateMockFrames } from './mockDemoService';
import { loadDemoparser2, isParserAvailable, getParser } from './demoparser2Loader';
import { decodeOpusAudio, pcmToWav, removeSilence, downloadBlob, VoiceData } from './voiceExtractor';
import { useDemoStore } from '../store/useDemoStore';

// Source 2 Demo Magic: PBDEMS2\0
const DEMO_MAGIC = "PBDEMS2";

enum DemoCommand {
  DEM_FileHeader = 1,
  DEM_FileInfo = 2,
  DEM_Packet = 7,
  DEM_SignonPacket = 8,
}

export interface ParsingProgress {
  percentage: number;
  currentStep: string;
  estimatedTimeRemaining: number; // in seconds
}

export class DemoParser {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number = 0;
  private progressCallback?: (progress: ParsingProgress) => void;
  private startTime: number = 0;

  constructor(buffer: ArrayBuffer, progressCallback?: (progress: ParsingProgress) => void) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.progressCallback = progressCallback;
  }

  private lastProgressUpdate = 0;
  private progressThrottleMs = 50; // Update UI at most every 50ms
  
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
    
    // Call directly - Zustand will handle batching
    this.progressCallback({
      percentage: Math.min(100, Math.max(0, percentage)),
      currentStep,
      estimatedTimeRemaining: estimatedRemaining
    });
  }

  public async parse(): Promise<DemoFile> {
    this.startTime = Date.now();
    this.reportProgress(0, 'Initializing parser...');
    
    // Load and use demoparser2
    this.reportProgress(5, 'Loading WASM parser...');
    const parser = await loadDemoparser2();
    
    if (!parser || !isParserAvailable()) {
      throw new Error("demoparser2 not found. Please place demoparser2.js and demoparser2_bg.wasm in public/pkg/ directory.");
    }
    
    console.log("Using demoparser2 WASM parser...");
    try {
      this.reportProgress(10, 'Parsing with WASM...');
      return await this.parseWithWasm(parser);
    } catch (e: any) {
      // Check if it's a WASM panic
      if (e.message === 'WASM_PANIC' || e.name === 'RuntimeError' || e.message?.includes('panic') || e.message?.includes('unreachable')) {
        throw new Error("Failed to parse demo file. The demo may be corrupted or incompatible.");
      } else {
        throw new Error(`Failed to parse demo file: ${e.message || e}`);
      }
    }
  }

  /**
   * Parse using demoparser2 WASM
   * Based on: https://github.com/LaihoE/demoparser-wasm-demo
   */
  private async parseWithWasm(parser: any): Promise<DemoFile> {
    // Convert ArrayBuffer to Uint8Array (demoparser2 expects Uint8Array)
    const buffer: Uint8Array = this.buffer instanceof Uint8Array 
      ? this.buffer 
      : new Uint8Array(this.buffer);
    
    // Validate buffer size
    if (buffer.length < 16) {
      throw new Error('Demo file too small');
    }
    
    console.log('Parsing with demoparser2 WASM...');
    console.log('Buffer type:', buffer.constructor.name, 'length:', buffer.length, 'bytes');
    
    // Extract header info if available
    let mapName = "de_unknown";
    let tickRate = 64;
    let duration = 0;
    
    if (parser.parseHeader) {
      try {
        const headerInfo = parser.parseHeader(buffer);
        console.log('✓ parseHeader successful:', headerInfo);
        if (headerInfo) {
          // headerInfo is a Map, so use .get() to access values
          if (headerInfo instanceof Map) {
            mapName = headerInfo.get('map_name') || headerInfo.get('mapName') || mapName;
            tickRate = headerInfo.get('tick_rate') || headerInfo.get('tickRate') || tickRate;
            duration = headerInfo.get('playback_time') || headerInfo.get('playbackTime') || headerInfo.get('duration') || duration;
          } else {
            // Fallback for plain object
            mapName = headerInfo.map_name || headerInfo.mapName || mapName;
            tickRate = headerInfo.tick_rate || headerInfo.tickRate || tickRate;
            duration = headerInfo.playback_time || headerInfo.playbackTime || headerInfo.duration || duration;
          }
          console.log(`Extracted from header: mapName=${mapName}, tickRate=${tickRate}, duration=${duration}`);
        }
      } catch (e) {
        console.warn('parseHeader failed, will try manual parsing:', e);
      }
    }
    
    // If we didn't get header info, try manual parsing
    if (mapName === "de_unknown" || duration === 0) {
      this.offset = 0;
      try {
        const magic = this.readString(8);
        if (magic === DEMO_MAGIC) {
          this.offset += 8;
      while (this.offset < this.view.byteLength) {
        const cmdRaw = this.readVarInt32();
        const cmdId = cmdRaw & ~64; 
        const isCompressed = (cmdRaw & 64) === 64;
        const tick = this.readVarInt32();
        const size = this.readVarInt32();

        if (this.offset + size > this.view.byteLength) break;

        if (cmdId === DemoCommand.DEM_FileInfo && !isCompressed) {
             const info = this.parseFileInfoProto(size);
              if (info.mapName && mapName === "de_unknown") mapName = info.mapName;
              if (info.playbackTime && duration === 0) duration = info.playbackTime;
              break;
            }
        this.offset += size;
          }
      }
    } catch (e) {
        console.warn('Manual header parsing failed:', e);
      }
    }
    
    // Extract events (deaths, round starts, round ends/wins)
    // Based on: https://github.com/LaihoE/demoparser/blob/main/examples/efficiently_parse_multi_events_and_ticks/index.js
    this.reportProgress(20, 'Extracting game events...');
    let deathEvents: any[] = [];
    let roundStartEvents: any[] = [];
    let roundEndEvents: any[] = [];
    let roundFreezeEndEvents: any[] = [];
    const allEventTicks = new Set<number>(); // Collect all ticks that have events for efficient parsing
    
    // Declare weaponFireEvents, damageEvents, playerBlindEvents, disconnectEvents, and connectEvents in outer scope so they're accessible later
    let weaponFireEvents: any[] = [];
    let damageEvents: any[] = [];
    let playerBlindEvents: any[] = [];
    let disconnectEvents: any[] = [];
    let connectEvents: any[] = [];
    
    try {
      console.log('Extracting events...');
      const allEvents = parser.parseEvents(buffer, ["player_death", "round_start", "round_begin", "round_end", "round_officially_ended", "cs_round_start", "round_freeze_end", "weapon_fire", "player_hurt", "damage", "player_blind", "player_disconnect", "player_connect"]);
      console.log(`✓ Extracted events, type: ${Array.isArray(allEvents) ? 'Array' : allEvents instanceof Map ? 'Map' : typeof allEvents}, length/size: ${Array.isArray(allEvents) ? allEvents.length : allEvents instanceof Map ? allEvents.size : 'N/A'}`);
      
      // Helper function to extract tick from event
      const getEventTick = (event: any): number => {
        if (event instanceof Map) {
          return event.get('tick') || event.get('tick_num') || event.get('t') || 0;
        } else {
          return event.tick || event.tick_num || event.t || 0;
        }
      };
      
      // Separate events by type and collect ticks
      if (Array.isArray(allEvents)) {
        allEvents.forEach((event: any) => {
          // Handle both Map and object structures
          let eventName = '';
          if (event instanceof Map) {
            eventName = event.get('event_name') || event.get('name') || '';
          } else {
            eventName = event.event_name || event.name || '';
          }
          
          const eventTick = getEventTick(event);
          if (eventTick > 0) {
            allEventTicks.add(eventTick);
          }
          
          if (eventName === 'player_death' || eventName === 'death') {
            deathEvents.push(event);
          } else if (eventName === 'round_start' || eventName === 'round_begin' || eventName === 'round_started' || eventName === 'cs_round_start') {
            roundStartEvents.push(event);
          } else if (eventName === 'round_end' || eventName === 'round_officially_ended') {
            roundEndEvents.push(event);
          } else if (eventName === 'round_freeze_end') {
            roundFreezeEndEvents.push(event);
          } else if (eventName === 'weapon_fire') {
            weaponFireEvents.push(event);
          }
        });
      } else if (allEvents instanceof Map) {
        // Handle Map structure - events might be grouped by event name
        for (const [key, value] of allEvents.entries()) {
          const eventName = String(key).toLowerCase();
          const processEvent = (event: any) => {
            const eventTick = getEventTick(event);
            if (eventTick > 0) {
              allEventTicks.add(eventTick);
            }
          };
          
          if (eventName.includes('death')) {
            if (Array.isArray(value)) {
              value.forEach(processEvent);
              deathEvents.push(...value);
    } else {
              processEvent(value);
              deathEvents.push(value);
            }
          } else if (eventName.includes('round_start') || eventName.includes('round_begin') || eventName.includes('cs_round_start')) {
            if (Array.isArray(value)) {
              value.forEach(processEvent);
              roundStartEvents.push(...value);
            } else {
              processEvent(value);
              roundStartEvents.push(value);
            }
          } else if (eventName.includes('round_end') || eventName.includes('round_officially_ended')) {
            if (Array.isArray(value)) {
              value.forEach(processEvent);
              roundEndEvents.push(...value);
            } else {
              processEvent(value);
              roundEndEvents.push(value);
            }
          }
        }
      }
      
      // Extract weapon fire events, damage events, player blind events, disconnect events, and connect events (assign to outer scope variable)
      weaponFireEvents = [];
      damageEvents = [];
      playerBlindEvents = [];
      disconnectEvents = [];
      connectEvents = [];
      if (Array.isArray(allEvents)) {
        allEvents.forEach((event: any) => {
          let eventName = '';
          if (event instanceof Map) {
            eventName = event.get('event_name') || event.get('name') || '';
          } else {
            eventName = event.event_name || event.name || '';
          }
          
          if (eventName === 'weapon_fire') {
            weaponFireEvents.push(event);
          } else if (eventName === 'player_hurt' || eventName === 'damage') {
            damageEvents.push(event);
          } else if (eventName === 'player_blind') {
            playerBlindEvents.push(event);
          } else if (eventName === 'player_disconnect') {
            disconnectEvents.push(event);
          } else if (eventName === 'player_connect') {
            connectEvents.push(event);
          }
        });
      } else if (allEvents instanceof Map) {
        for (const [key, value] of allEvents.entries()) {
          const eventName = String(key).toLowerCase();
          if (eventName.includes('weapon_fire') || eventName.includes('weaponfire')) {
            if (Array.isArray(value)) {
              weaponFireEvents.push(...value);
            } else {
              weaponFireEvents.push(value);
            }
          } else if (eventName.includes('player_hurt') || eventName.includes('damage')) {
            if (Array.isArray(value)) {
              damageEvents.push(...value);
            } else {
              damageEvents.push(value);
            }
          } else if (eventName.includes('player_blind')) {
            if (Array.isArray(value)) {
              playerBlindEvents.push(...value);
            } else {
              playerBlindEvents.push(value);
            }
          } else if (eventName.includes('player_disconnect')) {
            if (Array.isArray(value)) {
              disconnectEvents.push(...value);
            } else {
              disconnectEvents.push(value);
            }
          } else if (eventName.includes('player_connect')) {
            if (Array.isArray(value)) {
              connectEvents.push(...value);
            } else {
              connectEvents.push(value);
            }
          }
        }
      }
      
      console.log(`✓ Extracted ${deathEvents.length} death events, ${roundStartEvents.length} round start events, ${roundEndEvents.length} round end events, ${weaponFireEvents.length} weapon fire events, ${damageEvents.length} damage events, ${playerBlindEvents.length} player blind events`);
      
      // Log sample events to debug
      if (roundStartEvents.length > 0) {
        console.log('Sample round start event:', roundStartEvents[0]);
      }
      if (roundEndEvents.length > 0) {
        console.log('Sample round end event:', roundEndEvents[0]);
        console.log('First 5 round end events:', roundEndEvents.slice(0, 5));
      }
      
      // Deduplicate round end events - keep only one per tick (prefer round_officially_ended over round_end)
      const roundEndByTick = new Map<number, any>();
      roundEndEvents.forEach((event: any) => {
        let eventTick = 0;
        let eventName = '';
        
        if (event instanceof Map) {
          eventTick = event.get('tick') || event.get('tick_num') || event.get('t') || 0;
          eventName = event.get('event_name') || event.get('name') || '';
        } else {
          eventTick = event.tick || event.tick_num || event.t || 0;
          eventName = event.event_name || event.name || '';
        }
        
        if (eventTick > 0) {
          // If we already have an event for this tick, prefer round_officially_ended
          const existing = roundEndByTick.get(eventTick);
          if (!existing || eventName === 'round_officially_ended') {
            roundEndByTick.set(eventTick, event);
          }
        }
      });
      
      // Convert back to array
      roundEndEvents = Array.from(roundEndByTick.values());
      console.log(`✓ Deduplicated round end events: ${roundEndEvents.length} unique round ends`);
    } catch (e: any) {
      console.warn('Failed to extract events:', e.message || e);
      if (e.name === 'RuntimeError' || e.message?.includes('unreachable') || e.message?.includes('panic')) {
        throw new Error('WASM_PANIC');
      }
    }
    
    // Extract player positions using parseTicks
    // Include weapon, grenade, and money fields
    this.reportProgress(30, 'Extracting player data...');
    let rawData: any[] = [];
    let grenadeData: any[] = []; // Declare outside try block so it's accessible at return statement
    
    try {
      // First, let's list available fields to see what we can actually get
      this.reportProgress(25, 'Listing available fields...');
      let availableFields: any = null;
      try {
        if (parser.listUpdatedFields) {
          availableFields = parser.listUpdatedFields(buffer);
          console.log('Available fields from parser:', availableFields);
        }
      } catch (e) {
        console.warn('Could not list available fields:', e);
      }
      
      // Parse grenades separately using parseGrenades if available
      // This gives us better grenade data than trying to extract from inventory
      if (parser.parseGrenades) {
        try {
          console.log('Parsing grenades separately...');
          this.reportProgress(26, 'Parsing grenade data...');
          grenadeData = parser.parseGrenades(buffer, null, true); // true = include all grenades
          console.log(`✓ Extracted ${grenadeData.length} grenade events`);
          if (grenadeData.length > 0 && grenadeData.length <= 10) {
            console.log('Sample grenade data:', grenadeData[0]);
          }
        } catch (e: any) {
          console.warn('Failed to parse grenades separately:', e.message || e);
        }
      }
      
      const wantedFields = [
        "X", "Y", "Z", 
        "health", 
        "team_num", 
        "player_name",
        "shots_fired",
        "flash_duration",
      ];
      console.log('Extracting player data with fields:', wantedFields);
      
      // Optimize: Collect ticks we want to parse
      // Only parse ticks that have events (not every single tick - that would be too slow)
      const wantedTicksSet = new Set<number>(allEventTicks);
      
      // Convert to sorted Int32Array for parseTicks
      const wantedTicksArray = new Int32Array(Array.from(wantedTicksSet).sort((a, b) => a - b));
      
      console.log(`✓ Will parse ${wantedTicksArray.length} ticks (${allEventTicks.size} event ticks + ${wantedTicksArray.length - allEventTicks.size} additional ticks)`);
      
      // Report progress before the potentially long-running parseTicks operation
      this.reportProgress(28, `Extracting player tick data for ${wantedTicksArray.length.toLocaleString()} ticks...`);
      
      // Yield to event loop to allow UI to update
      await new Promise(resolve => setTimeout(resolve, 0));
      
      console.time('parseTicks');
      // Use wantedTicks parameter to only parse specific ticks (much faster!)
      rawData = parser.parseTicks(buffer, wantedFields, wantedTicksArray);
      console.timeEnd('parseTicks');
      console.log(`✓ Extracted ${rawData.length} tick data points`);
      
      // Report progress immediately after parseTicks completes
      this.reportProgress(35, `Extracted ${rawData.length.toLocaleString()} tick data points`);
      
      // Validate data size to prevent stack overflow
      const MAX_ROWS = 500000; // Limit to 500k rows to prevent stack overflow
      if (rawData.length > MAX_ROWS) {
        console.warn(`⚠ Dataset too large (${rawData.length} rows). Limiting to ${MAX_ROWS} rows to prevent stack overflow.`);
        rawData = rawData.slice(0, MAX_ROWS);
      }
      
      // Log sample data to see structure
      if (rawData.length > 0) {
        const firstRow = rawData[0];
        console.log('Sample player data (first row):', firstRow);
        if (firstRow instanceof Map) {
          console.log('Sample data keys:', Array.from(firstRow.keys()));
          console.log('Sample tick value:', firstRow.get('tick'), 'type:', typeof firstRow.get('tick'));
          console.log('Sample tick_num value:', firstRow.get('tick_num'), 'type:', typeof firstRow.get('tick_num'));
        } else {
          console.log('Sample data keys:', Object.keys(firstRow));
        }
        console.log('Sample player data (row 100):', rawData[Math.min(100, rawData.length - 1)]);
        console.log('Sample player data (row 1000):', rawData[Math.min(1000, rawData.length - 1)]);
        
        // Check if player_name exists
        const hasPlayerName = rawData.some((r: any) => r.player_name);
        console.log('Has player_name field:', hasPlayerName);
        if (!hasPlayerName) {
          console.warn('⚠ player_name field not found! Checking for alternative player identifiers...');
          // Check for other possible player ID fields
          const sampleKeys = Object.keys(rawData[0]);
          const possiblePlayerIdFields = sampleKeys.filter(k => 
            k.toLowerCase().includes('player') || 
            k.toLowerCase().includes('id') || 
            k.toLowerCase().includes('steam') ||
            k.toLowerCase().includes('user')
          );
          console.log('Possible player ID fields:', possiblePlayerIdFields);
        }
      }
      
      // Warn if data is very large
      if (rawData.length > 100000) {
        console.warn(`⚠ Large dataset: ${rawData.length} rows. Processing may take a while...`);
      }
      
      // Track all unique items found in inventories across all players
      // Removed: allUniqueItems tracking (not needed for analysis)
      
    } catch (e: any) {
      console.warn('parseTicks failed, trying with minimal fields:', e.message || e);
      // Fallback to minimal fields if the extended fields cause issues
      try {
        const minimalFields = ["X", "Y", "Z", "health", "team_num", "player_name"];
        rawData = parser.parseTicks(buffer, minimalFields);
        console.log(`✓ Extracted ${rawData.length} tick data points (minimal fields)`);
      } catch (e2: any) {
        if (e2.name === 'RuntimeError' || e2.message?.includes('unreachable') || e2.message?.includes('panic')) {
          throw new Error('WASM_PANIC');
        }
        throw e2;
      }
    }
    
    // Transform data into MatchFrames
    // Use Map<tick, Map<playerId, PlayerState>> to deduplicate players per tick
    const framesMap = new Map<number, Map<number, PlayerState>>();
    let maxTick = 0;

    // Track all unique players across all ticks
    const allPlayerIds = new Set<number>();
    const playerIdMap = new Map<string, number>(); // Map player name to stable ID
    
    // Track all unique items found in inventories across all players
    // Removed: allUniqueItems tracking (not needed for analysis)
    
    // Process raw data - group by tick and deduplicate by player
    // Use regular for loop instead of forEach to avoid stack overflow with large arrays
    this.reportProgress(36, 'Processing player data...');
    console.time('Processing player data');
    const logInterval = Math.max(1000, Math.floor(rawData.length / 10)); // Log every 10% or every 1000 rows
    const yieldInterval = Math.max(100, Math.floor(rawData.length / 100)); // Yield every 1% or every 100 rows
    
    // Parse the data structure - each row is a Map with multiple key-value pairs
    // Structure: Map {'Z' => 11488, 'player_name' => 'DompaDaDompa', 'tick' => 0, ...}
    // Each Map represents one player at one tick
    
    for (let index = 0; index < rawData.length; index++) {
      const item = rawData[index];
      
      // Report progress and yield more frequently
      if (index % yieldInterval === 0 && index > 0) {
        const progress = 36 + (index / rawData.length) * 24; // 36-60% for processing player data
        this.reportProgress(progress, `Processing player data: ${Math.round(index / rawData.length * 100)}%`);
        // Yield to event loop to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      if (index % logInterval === 0 && index > 0) {
        console.log(`Processing: ${index}/${rawData.length} (${Math.round(index / rawData.length * 100)}%)`);
      }
      
      // Each item is a Map with multiple key-value pairs
      let playerData: Map<string, any>;
      
      if (item instanceof Map) {
        playerData = item;
      } else if (typeof item === 'object' && item !== null) {
        // Convert plain object to Map
        playerData = new Map(Object.entries(item));
      } else {
        continue; // Skip invalid items
      }
      
      // Extract tick and player name from the Map
      // Try multiple field names for tick
      let tick = playerData.get('tick');
      if (tick === undefined || tick === null) {
        tick = playerData.get('tick_num');
      }
      if (tick === undefined || tick === null) {
        tick = playerData.get('t');
      }
      
      const playerName = playerData.get('player_name') || playerData.get('name') || playerData.get('user_name');
      
      // Skip if no valid player name
      if (!playerName || playerName === 'null' || playerName === 'undefined' || playerName === '') {
        if (index === 0) {
          console.warn('Skipping rows due to missing player name. Sample row:', playerData);
          console.warn('Available keys in playerData:', Array.from(playerData.keys()));
        }
        continue;
      }
      
      // Skip if no valid tick (but allow tick 0 as it's valid)
      if (tick === undefined || tick === null) {
        if (index === 0) {
          console.warn('Skipping rows due to missing tick information. Sample row:', playerData);
          console.warn('Available keys in playerData:', Array.from(playerData.keys()));
        }
        continue;
      }
      
      // Parse tick - handle both number and string types
      let tickNum: number;
      if (typeof tick === 'number') {
        tickNum = tick;
      } else if (typeof tick === 'string') {
        const parsed = parseInt(tick, 10);
        if (isNaN(parsed)) {
          if (index === 0) {
            console.warn(`Invalid tick value: "${tick}" (type: ${typeof tick}). Sample row:`, playerData);
          }
          continue;
        }
        tickNum = parsed;
      } else {
        // Try to convert to number
        const parsed = Number(tick);
        if (isNaN(parsed)) {
          if (index === 0) {
            console.warn(`Invalid tick value: ${tick} (type: ${typeof tick}). Sample row:`, playerData);
          }
          continue;
        }
        tickNum = parsed;
      }
      
      // Validate tick is a valid number (allow 0, but check for NaN)
      if (isNaN(tickNum) || !isFinite(tickNum)) {
        if (index === 0) {
          console.warn(`Invalid tick number: ${tickNum}. Original value: ${tick} (type: ${typeof tick})`);
        }
        continue;
      }
      const playerNameStr = String(playerName);
      
      if (tickNum > maxTick) maxTick = tickNum;
      
      if (!framesMap.has(tickNum)) {
        framesMap.set(tickNum, new Map());
      }
      
      // Use player name as the player identifier
      const playerIdentifier = playerNameStr;
      
      let playerId: number;
      
      if (playerIdMap.has(playerIdentifier)) {
        playerId = playerIdMap.get(playerIdentifier)!;
      } else {
        // Generate new stable ID
        let hash = 0;
        for (let i = 0; i < Math.min(playerIdentifier.length, 32); i++) {
          hash = ((hash << 5) - hash) + playerIdentifier.charCodeAt(i);
          hash = hash & hash; // Convert to 32bit integer
        }
        playerId = Math.abs(hash) || (1000 + playerIdMap.size);
        playerIdMap.set(playerIdentifier, playerId);
        allPlayerIds.add(playerId);
        
        // Log new players (limit to first 20 to avoid spam)
        if (playerIdMap.size <= 20) {
          console.log(`New player found: "${playerIdentifier}" -> ID: ${playerId}`);
        }
      }
      
      // Extract values from playerData Map
      const teamVal = playerData.get('team_num');
        let team = Team.SPECTATOR;
        if (teamVal === 2) team = Team.T;
        if (teamVal === 3) team = Team.CT;
      
      // Determine if player is alive based on health
      const health = playerData.get('health') || 0;
      const isAlive = health > 0;
      
      // Extract player name (already extracted above, but ensure we have it)
      const finalPlayerName = playerNameStr;

        const player: PlayerState = {
        id: playerId,
        name: finalPlayerName,
            team: team,
        hp: health,
        isAlive: isAlive,
        position: { 
          x: playerData.get('X') || 0, 
          y: playerData.get('Y') || 0,
          z: playerData.get('Z') || undefined
        },
        viewAngle: 0, // Not needed for analysis
        hasBomb: false, // Not needed for analysis
        isTalking: false,
        flashDuration: (() => {
          const flashDurationValue = playerData.get('flash_duration');
          if (flashDurationValue !== undefined && flashDurationValue !== null) {
            const flash = typeof flashDurationValue === 'number' ? flashDurationValue : parseFloat(String(flashDurationValue));
            return !isNaN(flash) && flash >= 0 ? flash : 0;
          }
          return 0;
        })(),
        shotsFired: (() => {
          const shotsFiredValue = playerData.get('shots_fired');
          if (shotsFiredValue !== undefined && shotsFiredValue !== null) {
            const shots = typeof shotsFiredValue === 'number' ? shotsFiredValue : parseInt(String(shotsFiredValue), 10);
            return !isNaN(shots) && shots >= 0 ? shots : 0;
          }
          return 0;
        })(),
        equipment: {
          grenades: []
        }
      };
      
      
      // Store player for this tick (will overwrite if duplicate, keeping latest data)
      framesMap.get(tickNum)!.set(playerId, player);
    }
    
    console.timeEnd('Processing player data');
    console.log(`Processed ${rawData.length} data points into ${framesMap.size} unique ticks`);
    console.log(`Found ${allPlayerIds.size} unique players`);
    
    // Removed: inventory logging (not needed for analysis)
    
    // Log player names if reasonable number
    if (allPlayerIds.size <= 20 && playerIdMap.size > 0) {
      console.log('Player ID map:', Array.from(playerIdMap.entries()).slice(0, 20));
    } else if (allPlayerIds.size > 20) {
      console.warn(`⚠ Too many unique players (${allPlayerIds.size}). This suggests player identification is broken.`);
      console.warn('First 10 player identifiers:', Array.from(playerIdMap.keys()).slice(0, 10));
    }
    
    // Process round start events to create rounds
    const rounds: Round[] = [];
    const roundStartTicks = new Set<number>();
    
    // Extract all round start ticks
    roundStartEvents.forEach((roundEvent: any) => {
      // Handle both Map and object structures
      let eventTick = 0;
      
      if (roundEvent instanceof Map) {
        eventTick = roundEvent.get('tick') || roundEvent.get('tick_num') || roundEvent.get('t') || 0;
      } else {
        eventTick = roundEvent.tick || roundEvent.tick_num || roundEvent.t || 0;
      }
      
      if (eventTick > 0) {
        roundStartTicks.add(eventTick);
      }
    });
    
    // Sort round start ticks and create rounds starting from 1
    const sortedStartTicks = Array.from(roundStartTicks).sort((a, b) => a - b);
    sortedStartTicks.forEach((startTick, index) => {
      rounds.push({
        number: index + 1, // Always start from 1
        startTick: startTick,
        freezeEndTick: undefined // Will be set below if found
      });
    });
    
    // Process freeze end events and map them to rounds
    if (roundFreezeEndEvents.length > 0) {
      console.log(`Processing ${roundFreezeEndEvents.length} round_freeze_end events...`);
      roundFreezeEndEvents.forEach((freezeEvent: any) => {
        let eventTick = 0;
        if (freezeEvent instanceof Map) {
          eventTick = freezeEvent.get('tick') || freezeEvent.get('tick_num') || freezeEvent.get('t') || 0;
        } else {
          eventTick = freezeEvent.tick || freezeEvent.tick_num || freezeEvent.t || 0;
        }
        
        if (eventTick === 0) return;
        
        // Find the round this freeze end belongs to (the round that started before this tick)
        for (let i = rounds.length - 1; i >= 0; i--) {
          const round = rounds[i];
          if (round.startTick && eventTick >= round.startTick) {
            // Check if this is the first freeze end for this round (or if it's closer to round start)
            if (!round.freezeEndTick || Math.abs(eventTick - round.startTick) < Math.abs(round.freezeEndTick - round.startTick)) {
              round.freezeEndTick = eventTick;
            }
            break;
          }
        }
      });
      console.log(`✓ Mapped freeze end events to rounds`);
    }
    
    // Process round end events to extract winner information (but don't use them for end tick calculation)
    const roundWinners = new Map<number, Team>(); // round number -> winning team
    
    // Extract winner information from round end events if available
    roundEndEvents.forEach((roundEvent: any) => {
      let eventTick = 0;
      let winner = 0; // 2 = T, 3 = CT
      
      if (roundEvent instanceof Map) {
        eventTick = roundEvent.get('tick') || roundEvent.get('tick_num') || roundEvent.get('t') || 0;
        winner = roundEvent.get('winner') || roundEvent.get('winner_team') || roundEvent.get('team') || 0;
      } else {
        eventTick = roundEvent.tick || roundEvent.tick_num || roundEvent.t || 0;
        winner = roundEvent.winner || roundEvent.winner_team || roundEvent.team || 0;
      }
      
      if (eventTick === 0 || winner === 0) return;
      
      // Find which round this end event belongs to (must be after the round start, before next round start)
      for (let i = 0; i < rounds.length; i++) {
        const round = rounds[i];
        const nextRoundStart = i < rounds.length - 1 ? rounds[i + 1].startTick : undefined;
        
        // Check if this end event is after this round's start
        if (eventTick < round.startTick) continue;
        
        // Check if this end event is before the next round's start (if it exists)
        if (nextRoundStart !== undefined && eventTick >= nextRoundStart) continue;
        
        // This end event belongs to this round - store winner info
        // Only set if we don't already have a winner for this round (prefer first match)
        if (!roundWinners.has(round.number)) {
          if (winner === 2) {
            roundWinners.set(round.number, Team.T);
          } else if (winner === 3) {
            roundWinners.set(round.number, Team.CT);
          }
        }
        break;
      }
    });
    
    // Calculate round end ticks as a few seconds before the next round start
    // Use 2 seconds before next round start (or maxTick for last round)
    const ticksBeforeNextRound = Math.ceil(2 * tickRate); // 2 seconds worth of ticks
    
    // Set end tick for each round
    for (let i = 0; i < rounds.length; i++) {
      if (i < rounds.length - 1) {
        // Calculate end tick as next round start minus a few seconds
        const nextRoundStart = rounds[i + 1].startTick;
        rounds[i].endTick = Math.max(rounds[i].startTick, nextRoundStart - ticksBeforeNextRound);
      } else {
        // Last round: use maxTick
        rounds[i].endTick = maxTick;
      }
      
      // Set winner if we found one from round end events
      const winner = roundWinners.get(rounds[i].number);
      if (winner) {
        rounds[i].winner = winner;
      }
    }
    
    console.log(`✓ Calculated round end ticks (2s before next round start) for ${rounds.length} rounds`);
    
    // Calculate scores - count wins up to the current round
    let ctScore = 0;
    let tScore = 0;
    rounds.forEach(round => {
      if (round.winner === Team.CT) {
        ctScore++;
      } else if (round.winner === Team.T) {
        tScore++;
      }
    });
    
    console.log(`✓ Processed ${rounds.length} rounds`);
    console.log(`✓ Round winners: ${Array.from(roundWinners.entries()).map(([r, t]) => `R${r}:${t}`).join(', ')}`);
    console.log(`✓ Final scores: CT: ${ctScore}, T: ${tScore}`);
    
    // Process death events and chat messages
    const eventsByTick = new Map<number, GameEvent[]>();
    const deadPlayersByTick = new Map<number, Set<string>>();
    
    // Process weapon fire events
    if (weaponFireEvents && weaponFireEvents.length > 0) {
      weaponFireEvents.forEach((fireEvent: any) => {
        let eventTick = 0;
        let playerName = 'Unknown';
        let weapon = 'unknown';
        
        if (fireEvent instanceof Map) {
          eventTick = fireEvent.get('tick') || fireEvent.get('tick_num') || fireEvent.get('t') || 0;
          playerName = fireEvent.get('user_name') || fireEvent.get('player_name') || fireEvent.get('name') || 'Unknown';
          weapon = fireEvent.get('weapon') || fireEvent.get('weapon_name') || fireEvent.get('weapon_type') || 'unknown';
        } else {
          eventTick = fireEvent.tick || fireEvent.tick_num || fireEvent.t || 0;
          playerName = fireEvent.user_name || fireEvent.player_name || fireEvent.name || 'Unknown';
          weapon = fireEvent.weapon || fireEvent.weapon_name || fireEvent.weapon_type || 'unknown';
        }
        
        if (eventTick === 0) return;
        
        if (!eventsByTick.has(eventTick)) {
          eventsByTick.set(eventTick, []);
        }
        
        const fireGameEvent: GameEvent = {
          type: 'weapon_fire',
          tick: eventTick,
          description: `${playerName} fired ${weapon}`,
          playerName,
          weapon
        };
        
        eventsByTick.get(eventTick)!.push(fireGameEvent);
      });
      console.log(`✓ Processed ${weaponFireEvents.length} weapon fire events`);
    }
    
    deathEvents.forEach((deathEvent: any) => {
      // Handle both Map and object structures
      let eventTick = 0;
      let victimName = 'Unknown';
      let attackerName = 'Unknown';
      let weapon = 'unknown';
      let isHeadshot = false;
      
      if (deathEvent instanceof Map) {
        eventTick = deathEvent.get('tick') || deathEvent.get('tick_num') || deathEvent.get('t') || 0;
        victimName = deathEvent.get('user_name') || deathEvent.get('victim_name') || deathEvent.get('name') || 
                     deathEvent.get('victim') || 'Unknown';
        attackerName = deathEvent.get('attacker_name') || deathEvent.get('attacker') || 'Unknown';
        weapon = deathEvent.get('weapon') || deathEvent.get('weapon_name') || 'unknown';
        isHeadshot = deathEvent.get('headshot') || deathEvent.get('is_headshot') || false;
      } else {
        eventTick = deathEvent.tick || deathEvent.tick_num || deathEvent.t || 0;
        victimName = deathEvent.user_name || deathEvent.victim_name || deathEvent.name || 
                     deathEvent.victim || 'Unknown';
        attackerName = deathEvent.attacker_name || deathEvent.attacker || 'Unknown';
        weapon = deathEvent.weapon || deathEvent.weapon_name || 'unknown';
        isHeadshot = deathEvent.headshot || deathEvent.is_headshot || false;
      }
      
      if (eventTick === 0) return;
      
      if (!eventsByTick.has(eventTick)) {
        eventsByTick.set(eventTick, []);
      }
      
      const killEvent: GameEvent = {
        type: 'kill',
        tick: eventTick,
        description: `${attackerName} killed ${victimName} with ${weapon}${isHeadshot ? ' (headshot)' : ''}`
      };
      
      eventsByTick.get(eventTick)!.push(killEvent);
      
      // Track dead players
      if (!deadPlayersByTick.has(eventTick)) {
        deadPlayersByTick.set(eventTick, new Set());
      }
      deadPlayersByTick.get(eventTick)!.add(String(victimName));
    });
    
    // Process damage events
    if (damageEvents.length > 0) {
      console.log(`Processing ${damageEvents.length} damage events...`);
      damageEvents.forEach((damageEvent: any) => {
        let eventTick = 0;
        let victimName = 'Unknown';
        let attackerName = 'Unknown';
        let damage = 0;
        let weapon = 'unknown';
        
        if (damageEvent instanceof Map) {
          eventTick = damageEvent.get('tick') || damageEvent.get('tick_num') || damageEvent.get('t') || 0;
          victimName = damageEvent.get('user_name') || damageEvent.get('victim_name') || damageEvent.get('name') || 
                       damageEvent.get('victim') || 'Unknown';
          attackerName = damageEvent.get('attacker_name') || damageEvent.get('attacker') || 'Unknown';
          damage = damageEvent.get('dmg_health') || damageEvent.get('damage') || damageEvent.get('dmg') || 0;
          weapon = damageEvent.get('weapon') || damageEvent.get('weapon_name') || 'unknown';
        } else {
          eventTick = damageEvent.tick || damageEvent.tick_num || damageEvent.t || 0;
          victimName = damageEvent.user_name || damageEvent.victim_name || damageEvent.name || 
                       damageEvent.victim || 'Unknown';
          attackerName = damageEvent.attacker_name || damageEvent.attacker || 'Unknown';
          damage = damageEvent.dmg_health || damageEvent.damage || damageEvent.dmg || 0;
          weapon = damageEvent.weapon || damageEvent.weapon_name || 'unknown';
        }
        
        if (eventTick === 0 || attackerName === 'Unknown' || victimName === 'Unknown') return;
        
        if (!eventsByTick.has(eventTick)) {
          eventsByTick.set(eventTick, []);
        }
        
        const damageGameEvent: GameEvent = {
          type: 'damage',
          tick: eventTick,
          description: `${attackerName} damaged ${victimName} for ${damage} HP${weapon !== 'unknown' ? ` with ${weapon}` : ''}`,
          attackerName,
          victimName,
          damage,
          weapon: weapon !== 'unknown' ? weapon : undefined
        };
        
        eventsByTick.get(eventTick)!.push(damageGameEvent);
      });
      console.log(`✓ Processed ${damageEvents.length} damage events`);
    }
    
    // Calculate tick rate if we have duration
    if (duration > 0 && maxTick > 0) {
      tickRate = maxTick / duration;
    }
    
    // Create frames - ensure all players appear in every frame
    console.time('Creating frames');
    const frames: MatchFrame[] = [];
    const lastPlayersMap = new Map<number, PlayerState>(); // Track last known state of each player
    const deadPlayers = new Set<number>();
    
    // Initialize with all known players from the first frame that has data
    for (const [tick, playersMap] of framesMap.entries()) {
      if (playersMap.size > 0) {
        // Initialize lastPlayersMap with players from first frame
        for (const [playerId, player] of playersMap.entries()) {
          lastPlayersMap.set(playerId, { ...player });
        }
        break;
      }
    }
    
    // Only create frames for ticks that have data, not every tick from 0 to maxTick
    // This prevents creating millions of empty frames
    const ticksWithData = Array.from(framesMap.keys()).sort((a, b) => a - b);
    const actualMaxTick = ticksWithData.length > 0 ? Math.max(...ticksWithData) : 0;
    
    console.log(`Creating frames for ${ticksWithData.length} unique ticks (max tick: ${actualMaxTick})...`);
    console.log(`Total players tracked: ${lastPlayersMap.size}`);
    
    // Validate that we have data
    if (ticksWithData.length === 0) {
      throw new Error('No tick data found after processing parseTicks results. Data structure may be incorrect.');
    }
    
    // Process all ticks - no sampling
    const ticksToProcess = ticksWithData;
    
    const frameLogInterval = Math.max(1000, Math.floor(ticksToProcess.length / 10)); // Log every 10% or every 1k ticks
    const frameYieldInterval = Math.max(100, Math.floor(ticksToProcess.length / 100)); // Yield every 1% or every 100 ticks
    
    // Process only ticks that have data - don't fill gaps (we'll find closest frame when rendering)
    for (let tickIndex = 0; tickIndex < ticksToProcess.length; tickIndex++) {
      const i = ticksToProcess[tickIndex];
      
      // Report progress and yield more frequently
      if (tickIndex % frameYieldInterval === 0 && tickIndex > 0) {
        const progress = 60 + (tickIndex / ticksToProcess.length) * 35; // 60-95% for creating frames
        this.reportProgress(progress, `Creating frames: ${Math.round(tickIndex / ticksToProcess.length * 100)}%`);
        // Yield to event loop to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      if (tickIndex % frameLogInterval === 0 && tickIndex > 0) {
        console.log(`Creating frames: ${tickIndex}/${ticksToProcess.length} (${Math.round(tickIndex / ticksToProcess.length * 100)}%)`);
      }
      
      // Check if this is a round start - reset HP to 100 for all players BEFORE updating with new data
      const isRoundStart = roundStartTicks.has(i);
      if (isRoundStart) {
        // Reset all players to 100 HP and alive at round start
        for (const [playerId, player] of lastPlayersMap.entries()) {
          lastPlayersMap.set(playerId, { 
            ...player, 
            hp: 100, 
            isAlive: true 
          });
        }
        deadPlayers.clear(); // Clear dead players at round start
      }
      
      const tickPlayersMap = framesMap.get(i);
      
      // Update last known state for players that appear in this tick
      if (tickPlayersMap) {
        for (const [playerId, player] of tickPlayersMap.entries()) {
          // If this is a round start, ensure HP is 100 even if data says otherwise
          const updatedPlayer = isRoundStart ? { ...player, hp: 100, isAlive: true } : player;
          lastPlayersMap.set(playerId, updatedPlayer);
        }
      }
      
      // Mark players as dead
      const playersDiedThisTick = deadPlayersByTick.get(i);
      if (playersDiedThisTick) {
        playersDiedThisTick.forEach(playerName => {
          const deadPlayer = Array.from(lastPlayersMap.values()).find(
            p => p.name === playerName || p.name === String(playerName)
          );
          if (deadPlayer) {
            deadPlayers.add(deadPlayer.id);
          }
        });
      }
      
      // Build player array from last known states, updating alive status
      // Use for...of loop instead of map to avoid potential stack issues
      const currentPlayers: PlayerState[] = [];
      for (const p of lastPlayersMap.values()) {
        if (deadPlayers.has(p.id)) {
          currentPlayers.push({ ...p, isAlive: false, hp: 0 });
        } else {
          currentPlayers.push({ ...p });
        }
      }
      
      
      const frameEvents = eventsByTick.get(i) || [];
      
        frames.push({
            tick: i,
            time: i / tickRate,
        players: currentPlayers,
        events: frameEvents
      });
    }
    
    // Sort frames by tick to ensure correct order
    frames.sort((a, b) => a.tick - b.tick);
    
    // Track each player's initial view angle and normalize rotations relative to initial angle
    // This ensures all players maintain correct relative rotations while keeping their initial orientations
    const playerInitialViewAngles = new Map<number, number>(); // playerId -> initial view angle
    
    // First pass: Store each player's initial view angle (first frame they appear in)
    for (const frame of frames) {
      for (const player of frame.players) {
        // If we haven't seen this player's initial view angle yet, store it
        if (!playerInitialViewAngles.has(player.id) && 
            player.viewAngle !== undefined && 
            !isNaN(player.viewAngle)) {
          const initialAngle = player.viewAngle;
          playerInitialViewAngles.set(player.id, initialAngle);
        }
      }
    }
    
    // Debug: Log initial angles to see if there's a pattern
    if (playerInitialViewAngles.size > 0) {
      const initialAngles = Array.from(playerInitialViewAngles.entries()).slice(0, 10);
      console.log(`Tracked initial view angles for ${playerInitialViewAngles.size} players (first 10):`, 
        initialAngles.map(([id, angle]) => `P${id}:${angle.toFixed(1)}°`).join(', '));
      
      // Check if there's a wide spread in initial angles (might indicate inconsistent conversion)
      const angles = Array.from(playerInitialViewAngles.values());
      const minAngle = Math.min(...angles);
      const maxAngle = Math.max(...angles);
      const spread = maxAngle - minAngle;
      console.log(`Initial angle spread: ${spread.toFixed(1)}° (min: ${minAngle.toFixed(1)}°, max: ${maxAngle.toFixed(1)}°)`);
      
      if (spread > 180) {
        console.warn(`⚠ Large spread in initial angles (${spread.toFixed(1)}°) - some players may be facing wrong direction`);
        console.warn(`⚠ Consider normalizing each player's rotation relative to their initial angle`);
      }
    }
    
    // Optional: Normalize each player's rotation relative to their initial angle
    // This ensures all players maintain correct relative rotations while fixing orientation issues
    // Uncomment the code below if some players are facing the wrong way:
    /*
    const playerRotationOffsets = new Map<number, number>();
    for (const [playerId, initialAngle] of playerInitialViewAngles.entries()) {
      // Calculate offset to normalize initial angle to 0° (north)
      const offset = -initialAngle;
      playerRotationOffsets.set(playerId, offset);
    }
    
    // Apply offsets to all frames
    for (const frame of frames) {
      for (const player of frame.players) {
        const offset = playerRotationOffsets.get(player.id);
        if (offset !== undefined && 
            player.viewAngle !== undefined && 
            !isNaN(player.viewAngle)) {
          player.viewAngle = (player.viewAngle + offset) % 360;
          if (player.viewAngle < 0) player.viewAngle += 360;
        }
      }
    }
    console.log(`Applied individual rotation normalization for ${playerRotationOffsets.size} players`);
    */
    
    console.timeEnd('Creating frames');
    this.reportProgress(95, 'Finalizing...');
    console.log(`Parsed Demo (demoparser2): ${mapName}, ${duration.toFixed(2)}s, ${frames.length} frames`);
    
    this.reportProgress(100, 'Complete!');

    return {
        mapName,
        tickRate,
        duration,
      frames,
      rounds,
      scores: {
        ct: ctScore,
        t: tScore
      },
      grenades: grenadeData || [],
      playerBlindEvents: playerBlindEvents || [],
      disconnectEvents: disconnectEvents || [],
      connectEvents: connectEvents || []
    };
  }

  /**
   * Fallback parser that extracts basic info and generates mock frames
   */
  private parseWithHybrid(): DemoFile {
    this.reportProgress(20, 'Using hybrid parser...');
    this.offset = 0;

    // Bounds check
    if (this.buffer.byteLength < 16) {
      throw new Error("File too small to be a valid demo.");
    }

    // Validate Header
    const magic = this.readString(8);
    if (magic !== DEMO_MAGIC) {
      if (magic === "HL2DEMO") {
        throw new Error("Invalid Demo: This is a CS:GO (Source 1) demo. Only CS2 (Source 2) demos are supported.");
      }
      throw new Error(`Invalid CS2 Demo File: Missing PBDEMS2 signature. Found: '${magic}'`);
    }

    this.offset += 8;

    let mapName = "de_unknown";
    let duration = 0;
    let tickRate = 64;
    let clientName = "Unknown";

    // Scan commands for FileInfo
    try {
      while (this.offset < this.view.byteLength) {
        const cmdRaw = this.readVarInt32();
        const cmdId = cmdRaw & ~64;
        const isCompressed = (cmdRaw & 64) === 64;
        
        const tick = this.readVarInt32();
        const size = this.readVarInt32();

        if (this.offset + size > this.view.byteLength) break;

        if (cmdId === DemoCommand.DEM_FileInfo && !isCompressed) {
          const info = this.parseFileInfoProto(size);
          if (info.mapName) mapName = info.mapName;
          if (info.playbackTime) duration = info.playbackTime;
          if (info.clientName) clientName = info.clientName;
          break;
        }
        
        this.offset += size;
      }
    } catch (e) {
      console.warn("Parsing ended early or encountered error:", e);
    }

    // Generate Mock Frames
    this.reportProgress(50, 'Generating mock frames...');
    const frames = generateMockFrames(mapName, duration, tickRate);

    this.reportProgress(90, 'Finalizing...');
    console.log(`Parsed Demo (Hybrid): ${mapName}, ${duration.toFixed(2)}s, ${clientName}`);
    
    this.reportProgress(100, 'Complete!');

    return {
      mapName,
      tickRate,
      duration,
      frames,
      rounds: [], // Hybrid parser doesn't extract rounds
      scores: {
        ct: 0,
        t: 0
      },
      grenades: [] // Hybrid parser doesn't extract grenades
    };
  }

  // --- Binary Readers (Internal) ---

  private readString(length: number): string {
    if (this.offset + length > this.view.byteLength) {
        length = this.view.byteLength - this.offset;
    }
    const bytes = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    let str = new TextDecoder().decode(bytes);
    return str.replace(/\0/g, '');
  }

  private readVarInt32(): number {
    let result = 0;
    let count = 0;
    let b;
    do {
      if (count === 5) return result;
      if (this.offset >= this.view.byteLength) return result;
      b = this.view.getUint8(this.offset++);
      result |= (b & 0x7F) << (7 * count);
      count++;
    } while (b & 0x80);
    return result;
  }

  private parseFileInfoProto(size: number): { mapName?: string; playbackTime?: number; clientName?: string } {
    const end = this.offset + size;
    const result: any = {};
    
    while (this.offset < end) {
      try {
        const tag = this.readVarInt32();
        const fieldNumber = tag >>> 3;
        const wireType = tag & 7;

        if (wireType === 0) {
            this.readVarInt32();
        } else if (wireType === 1) {
            this.offset += 8;
        } else if (wireType === 2) {
            const len = this.readVarInt32();
            if (this.offset + len > end) { this.offset = end; break; }
            
            if (fieldNumber === 5) result.mapName = this.readString(len);
            else if (fieldNumber === 6) result.clientName = this.readString(len);
            else this.offset += len;
        } else if (wireType === 5) {
            if (fieldNumber === 1) result.playbackTime = this.view.getFloat32(this.offset, true);
            this.offset += 4;
        } else {
            break;
        }
      } catch (e) { break; }
    }
    this.offset = end;
    return result;
  }

  /**
   * Extract voice data from the demo file
   * Based on: https://github.com/LaihoE/demoparser/blob/main/examples/voice_to_wav/main.py
   * @param playerIds Array of player IDs to extract voice for
   * @param removeSilenceOption Whether to remove silence from the audio
   * @returns Promise that resolves when extraction is complete
   */
  async extractVoice(playerIds: number[], removeSilenceOption: boolean = true): Promise<void> {
    const parser = await getParser();
    if (!parser) {
      throw new Error('Parser not available');
    }

    if (!parser.parseVoice) {
      throw new Error('parseVoice function not available in demoparser2. Please ensure you have the latest version with voice support.');
    }

    console.log('Extracting voice data...', {
      playerIds,
      removeSilence: removeSilenceOption,
      bufferSize: this.buffer.byteLength
    });

    // Convert ArrayBuffer to Uint8Array
    const buffer: Uint8Array = this.buffer instanceof Uint8Array 
      ? this.buffer 
      : new Uint8Array(this.buffer);

    // Parse voice data from demo file
    // This returns an array of objects with steamid and bytes fields (similar to Python example)
    const voiceData: VoiceData[] = parser.parseVoice(buffer);
    
    if (!voiceData || voiceData.length === 0) {
      throw new Error('No voice data found in demo file');
    }

    console.log(`Found ${voiceData.length} voice packets`);

    // Get unique steamids from voice data
    const uniqueSteamIds = new Set<string>();
    voiceData.forEach(v => {
      if (v.steamid) {
        uniqueSteamIds.add(String(v.steamid));
      }
    });

    console.log(`Found ${uniqueSteamIds.size} unique players with voice data`);

    // Extract voice for each unique player
    const extractedFiles: string[] = [];
    
    for (const steamid of uniqueSteamIds) {
      // Get all voice packets for this player
      const playerVoicePackets = voiceData.filter(v => String(v.steamid) === steamid);
      
      if (playerVoicePackets.length === 0) continue;

      // Extract bytes from voice packets
      const opusBytes = playerVoicePackets.map(v => {
        // Convert bytes to Uint8Array if needed
        if (v.bytes instanceof Uint8Array) {
          return v.bytes;
        } else if (Array.isArray(v.bytes)) {
          return new Uint8Array(v.bytes);
        } else if (v.bytes && typeof v.bytes === 'object') {
          // Handle case where bytes might be in a different format
          return new Uint8Array(Object.values(v.bytes));
        } else {
          throw new Error(`Invalid bytes format for player ${steamid}`);
        }
      });

      try {
        // Decode Opus audio to PCM
        console.log(`Decoding voice for player ${steamid} (${opusBytes.length} packets)...`);
        let pcmData = await decodeOpusAudio(opusBytes, 48000, 1);

        // Remove silence if requested
        if (removeSilenceOption) {
          console.log(`Removing silence from audio for player ${steamid}...`);
          pcmData = removeSilence(pcmData);
        }

        // Convert PCM to WAV
        const wavBlob = pcmToWav(pcmData, 48000, 1);

        // Download the file
        const filename = `voice_${steamid}.wav`;
        downloadBlob(wavBlob, filename);
        extractedFiles.push(filename);

        console.log(`✓ Extracted voice for player ${steamid} -> ${filename}`);
      } catch (error: any) {
        console.error(`Failed to extract voice for player ${steamid}:`, error);
      }
    }

    if (extractedFiles.length === 0) {
      throw new Error('No voice files were extracted. Check console for errors.');
    }

    console.log(`✓ Voice extraction complete. Extracted ${extractedFiles.length} file(s):`, extractedFiles);
  }
}

