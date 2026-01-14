import { create } from 'zustand';
import { DemoFile, PlayerState, Team } from '../types';
import { DemoParser } from '../services/demoParser';

interface DemoStore {
  // Demo data
  demoFile: DemoFile | null;
  demoParser: DemoParser | null;
  
  // Playback state
  currentTick: number; // Frame index
  targetTick: number; // Actual game tick for interpolation
  isPlaying: boolean;
  
  // UI state
  selectedPlayerId: number | null;
  mutedPlayerIds: Set<number>;
  isParsing: boolean;
  parsingProgress: {
    percentage: number;
    currentStep: string;
    estimatedTimeRemaining: number; // in seconds
  } | null;
  error: string | null;
  isParserLoaded: boolean;
  isVoiceExtractionModalOpen: boolean;
  
  // Actions
  setDemoFile: (file: DemoFile | null) => void;
  setDemoParser: (parser: DemoParser | null) => void;
  setCurrentTick: (tick: number | ((prev: number) => number)) => void;
  setTargetTick: (tick: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSelectedPlayerId: (id: number | null) => void;
  setMutedPlayerIds: (ids: Set<number>) => void;
  setIsParsing: (parsing: boolean) => void;
  setParsingProgress: (progress: { percentage: number; currentStep: string; estimatedTimeRemaining: number } | null) => void;
  setError: (error: string | null) => void;
  setIsParserLoaded: (loaded: boolean) => void;
  setIsVoiceExtractionModalOpen: (open: boolean) => void;
  
  // Helper actions
  toggleMute: (playerId: number) => void;
  toggleTeamMute: (team: Team) => void;
  seekToTick: (tick: number) => void;
  reset: () => void;
  
  // Computed/derived state (getters)
  getCurrentFrame: () => import('../types').MatchFrame | null;
  getActivePlayers: () => PlayerState[];
}

export const useDemoStore = create<DemoStore>((set, get) => ({
  // Initial state
  demoFile: null,
  demoParser: null,
  currentTick: 0,
  targetTick: 0,
  isPlaying: false,
  selectedPlayerId: null,
  mutedPlayerIds: new Set(),
  isParsing: false,
  parsingProgress: null,
  error: null,
  isParserLoaded: false,
  isVoiceExtractionModalOpen: false,
  
  // Actions
  setDemoFile: (file) => set({ demoFile: file }),
  setDemoParser: (parser) => set({ demoParser: parser }),
  setCurrentTick: (tick) => {
    if (typeof tick === 'function') {
      set((state) => ({ currentTick: tick(state.currentTick) }));
    } else {
      set({ currentTick: tick });
    }
  },
  setTargetTick: (tick) => set({ targetTick: tick }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setSelectedPlayerId: (id) => set({ selectedPlayerId: id }),
  setMutedPlayerIds: (ids) => set({ mutedPlayerIds: ids }),
  setIsParsing: (parsing) => set({ isParsing: parsing }),
  setParsingProgress: (progress) => set({ parsingProgress: progress }),
  setError: (error) => set({ error }),
  setIsParserLoaded: (loaded) => set({ isParserLoaded: loaded }),
  setIsVoiceExtractionModalOpen: (open) => set({ isVoiceExtractionModalOpen: open }),
  
  // Helper actions
  toggleMute: (playerId) => {
    const { mutedPlayerIds } = get();
    const newMuted = new Set(mutedPlayerIds);
    if (newMuted.has(playerId)) {
      newMuted.delete(playerId);
    } else {
      newMuted.add(playerId);
    }
    set({ mutedPlayerIds: newMuted });
  },
  
  toggleTeamMute: (team) => {
    const { mutedPlayerIds, getActivePlayers } = get();
    const teamPlayers = getActivePlayers().filter(p => p.team === team);
    const allTeamMuted = teamPlayers.length > 0 && teamPlayers.every(p => mutedPlayerIds.has(p.id));
    
    const newMuted = new Set(mutedPlayerIds);
    teamPlayers.forEach(p => {
      if (allTeamMuted) {
        newMuted.delete(p.id);
      } else {
        newMuted.add(p.id);
      }
    });
    set({ mutedPlayerIds: newMuted });
  },
  
  seekToTick: (tick) => {
    const { demoFile } = get();
    if (demoFile) {
      const clampedTick = Math.max(0, Math.min(tick, demoFile.frames.length - 1));
      set({ currentTick: clampedTick, isPlaying: false });
    }
  },
  
  reset: () => set({
    demoFile: null,
    demoParser: null,
    currentTick: 0,
    targetTick: 0,
    isPlaying: false,
    selectedPlayerId: null,
    mutedPlayerIds: new Set(),
    isParsing: false,
    parsingProgress: null,
    error: null,
  }),
  
  // Computed getters
  getCurrentFrame: () => {
    const { demoFile, currentTick } = get();
    if (!demoFile || demoFile.frames.length === 0) return null;
    
    // Since frames are sparse (only ticks with data), find the closest frame
    // Binary search for the frame with tick <= currentTick
    const frames = demoFile.frames;
    let left = 0;
    let right = frames.length - 1;
    let closestFrame = frames[0];
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (frames[mid].tick <= currentTick) {
        closestFrame = frames[mid];
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    return closestFrame;
  },
  
  getActivePlayers: () => {
    const { getCurrentFrame } = get();
    const frame = getCurrentFrame();
    return frame?.players || [];
  },
}));

