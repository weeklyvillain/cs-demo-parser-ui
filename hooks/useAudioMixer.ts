import { useState, useEffect, useRef } from 'react';
import { PlayerState } from '../types';

export const useAudioMixer = (activePlayers: PlayerState[], mutedPlayerIds: Set<number>, isPlaying: boolean) => {
  // Track talking states for visualization
  // The actual audio playback is handled by useAudioPlayer hook

  const [talkingStates, setTalkingStates] = useState<Record<number, boolean>>({});
  const prevPlayersRef = useRef<string>('');

  useEffect(() => {
    // Create a stable key from players to avoid unnecessary updates
    const playersKey = JSON.stringify(activePlayers.map(p => ({ id: p.id, isTalking: p.isTalking })));
    
    // Only update if players actually changed
    if (playersKey === prevPlayersRef.current) {
      return;
    }
    
    prevPlayersRef.current = playersKey;
    
    const newStates: Record<number, boolean> = {};
    activePlayers.forEach(p => {
      // Show talking indicator if player is talking (regardless of mute status)
      // Mute status affects audio playback, not visualization
      newStates[p.id] = p.isTalking && isPlaying;
    });
    setTalkingStates(newStates);
  }, [activePlayers, isPlaying]);

  return { talkingStates };
};
