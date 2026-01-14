import { useEffect, useRef } from 'react';
import { useDemoStore } from '../store/useDemoStore';

/**
 * Hook to handle audio playback during replay
 * This will play voice audio synchronized with the demo playback
 */
export const useAudioPlayer = () => {
  const { currentTick, isPlaying, demoFile, mutedPlayerIds, getActivePlayers } = useDemoStore();
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBuffersRef = useRef<Map<number, AudioBuffer>>(new Map());
  const sourceNodesRef = useRef<Map<number, AudioBufferSourceNode>>(new Map());

  // Initialize AudioContext
  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    return () => {
      // Cleanup: stop all audio sources
      sourceNodesRef.current.forEach(node => {
        try {
          node.stop();
        } catch (e) {
          // Ignore errors if already stopped
        }
      });
      sourceNodesRef.current.clear();
    };
  }, []);

  // Handle audio playback based on current tick and player states
  useEffect(() => {
    if (!isPlaying || !demoFile || !audioContextRef.current) return;

    const frame = useDemoStore.getState().getCurrentFrame();
    if (!frame) return;

    const activePlayers = getActivePlayers();

    // For each player, check if they should be playing audio
    activePlayers.forEach(player => {
      const isMuted = mutedPlayerIds.has(player.id);
      const shouldPlay = player.isTalking && !isMuted && isPlaying;

      // Stop existing audio for this player if they shouldn't be talking
      const existingSource = sourceNodesRef.current.get(player.id);
      if (existingSource && !shouldPlay) {
        try {
          existingSource.stop();
        } catch (e) {
          // Ignore errors
        }
        sourceNodesRef.current.delete(player.id);
      }

      // Start audio for this player if they should be talking
      if (shouldPlay && !existingSource) {
        // TODO: Load actual audio buffer from voice data
        // For now, this is a placeholder that would play audio if available
        // In a real implementation, you would:
        // 1. Extract voice data from demo file
        // 2. Decode CELT/Opus packets to AudioBuffer
        // 3. Play the audio synchronized with ticks
        
        // Placeholder: Create a silent buffer (will be replaced with actual voice data)
        const sampleRate = audioContextRef.current.sampleRate;
        const buffer = audioContextRef.current.createBuffer(1, sampleRate * 0.1, sampleRate); // 100ms buffer
        
        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        
        // Start playing
        try {
          source.start();
          sourceNodesRef.current.set(player.id, source);
          
          // Clean up when finished
          source.onended = () => {
            sourceNodesRef.current.delete(player.id);
          };
        } catch (e) {
          console.warn('Failed to play audio for player', player.id, e);
        }
      }
    });
  }, [currentTick, isPlaying, demoFile, mutedPlayerIds, getActivePlayers]);

  return {};
};

