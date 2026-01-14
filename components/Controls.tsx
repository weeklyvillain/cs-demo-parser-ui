import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize2 } from 'lucide-react';
import { useDemoStore } from '../store/useDemoStore';

const Controls: React.FC = () => {
  const { 
    isPlaying, 
    currentTick, 
    demoFile, 
    setIsPlaying, 
    seekToTick 
  } = useDemoStore();
  
  // Calculate max tick from frames (last frame's tick) or use duration
  const maxTick = demoFile?.frames.length > 0 
    ? demoFile.frames[demoFile.frames.length - 1].tick 
    : (demoFile?.duration || 0) * (demoFile?.tickRate || 64);
  const tickRate = demoFile?.tickRate || 64;
  
  // Get actual tick from current frame (currentTick is frame index)
  const currentFrameIndex = Math.min(currentTick, (demoFile?.frames.length || 1) - 1);
  const actualTick = demoFile?.frames[currentFrameIndex]?.tick || 0;
  const progress = maxTick > 0 ? (actualTick / maxTick) * 100 : 0;

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const targetTick = Math.floor(percentage * maxTick);
    
    // Find the frame index that corresponds to this tick
    // Binary search for the frame with tick <= targetTick
    if (demoFile && demoFile.frames.length > 0) {
      const frames = demoFile.frames;
      let left = 0;
      let right = frames.length - 1;
      let frameIndex = 0;
      
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (frames[mid].tick <= targetTick) {
          frameIndex = mid;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }
      
      seekToTick(frameIndex);
    }
  };

  const formatTime = (ticks: number) => {
    const seconds = Math.floor(ticks / tickRate);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-16 bg-slate-900 border-t border-slate-800 flex items-center px-6 gap-6 z-20">
      <button 
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20"
      >
        {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
      </button>

      <div className="flex flex-col flex-1 gap-1">
        <div className="flex justify-between text-xs text-slate-400 font-mono">
          <span>{formatTime(actualTick)}</span>
          <span>Tick: {actualTick} / {maxTick}</span>
          <span>{formatTime(maxTick)}</span>
        </div>
        
        {/* Interactive Timeline */}
        <div 
          className="relative h-2 bg-slate-800 rounded-full cursor-pointer group"
          onClick={handleTimelineClick}
        >
          {/* Round Markers */}
          {demoFile?.rounds && demoFile.rounds.length > 0 && demoFile.rounds.map((round) => {
            const roundProgress = (round.startTick / maxTick) * 100;
            return (
              <div
                key={round.number}
                className="absolute top-0 h-full w-0.5 bg-blue-500/60 pointer-events-none"
                style={{ left: `${roundProgress}%` }}
                title={`Round ${round.number}`}
              />
            );
          })}
          
          {/* Progress Bar */}
          <div 
            className="absolute top-0 left-0 h-full bg-orange-500 rounded-full transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
          
          {/* Hover Handle */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `${progress}%`, transform: 'translate(-50%, -50%)' }}
          />
        </div>
        
        {/* Round Info */}
        {demoFile?.rounds && demoFile.rounds.length > 0 && (() => {
          const currentRound = demoFile.rounds.find(r => 
            actualTick >= r.startTick && (r.endTick === undefined || actualTick < r.endTick)
          ) || demoFile.rounds[demoFile.rounds.length - 1];
          return currentRound ? (
            <div className="text-xs text-slate-500 font-mono">
              Round {currentRound.number} / {demoFile.rounds.length}
            </div>
          ) : null;
        })()}
      </div>

      <div className="flex items-center gap-2 border-l border-slate-800 pl-6">
        <button 
          onClick={() => {
            // Find frame index closest to actualTick - 5 seconds
            const targetTick = Math.max(0, actualTick - tickRate * 5);
            if (demoFile && demoFile.frames.length > 0) {
              // Binary search for the frame with tick <= targetTick
              const frames = demoFile.frames;
              let left = 0;
              let right = frames.length - 1;
              let frameIndex = 0;
              
              while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (frames[mid].tick <= targetTick) {
                  frameIndex = mid;
                  left = mid + 1;
                } else {
                  right = mid - 1;
                }
              }
              
              seekToTick(Math.max(0, frameIndex));
            }
          }}
          className="p-2 text-slate-400 hover:text-white transition-colors"
          title="Skip back 5 seconds"
        >
          <SkipBack size={18} />
        </button>
        <button 
          onClick={() => {
            // Find frame index closest to actualTick + 5 seconds
            const targetTick = Math.min(maxTick, actualTick + tickRate * 5);
            if (demoFile && demoFile.frames.length > 0) {
              // Binary search for the frame with tick <= targetTick
              const frames = demoFile.frames;
              let left = 0;
              let right = frames.length - 1;
              let frameIndex = frames.length - 1;
              
              while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (frames[mid].tick <= targetTick) {
                  frameIndex = mid;
                  left = mid + 1;
                } else {
                  right = mid - 1;
                }
              }
              
              seekToTick(Math.min(frames.length - 1, frameIndex));
            }
          }}
          className="p-2 text-slate-400 hover:text-white transition-colors"
          title="Skip forward 5 seconds"
        >
          <SkipForward size={18} />
        </button>
         <button className="p-2 text-slate-400 hover:text-white transition-colors">
          <Maximize2 size={18} />
        </button>
      </div>
    </div>
  );
};

export default Controls;
