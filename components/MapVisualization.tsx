import React, { useState, useEffect, useMemo } from 'react';
import { getMapConfig, TEAM_COLORS } from '../constants';
import { Image as ImageIcon, Bomb, WifiOff } from 'lucide-react';
import { useDemoStore } from '../store/useDemoStore';
import { Team, MatchFrame, PlayerState } from '../types';

const MapVisualization: React.FC = () => {
  const { demoFile, selectedPlayerId, currentTick, targetTick, isPlaying } = useDemoStore();
  const mapName = demoFile?.mapName || 'de_unknown';
  
  // Generate intermediate frame during playback for smooth movement
  const generateIntermediateFrame = (targetTick: number, frames: MatchFrame[], tickRate: number): MatchFrame | null => {
    if (frames.length === 0) return null;
    
    // Find the two frames to interpolate between
    let frameA: MatchFrame | null = null;
    let frameB: MatchFrame | null = null;
    
    // Binary search to find the frame with tick <= targetTick
    let left = 0;
    let right = frames.length - 1;
    let closestIndex = 0;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (frames[mid].tick <= targetTick) {
        closestIndex = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    frameA = frames[closestIndex];
    
    // Find frame B (the next frame after targetTick)
    if (closestIndex < frames.length - 1) {
      frameB = frames[closestIndex + 1];
    } else {
      // We're at or past the last frame
      return frameA;
    }
    
    // If targetTick is exactly at frameA, return it
    if (targetTick <= frameA.tick) {
      return frameA;
    }
    
    // If targetTick is at or past frameB, return frameB
    if (targetTick >= frameB.tick) {
      return frameB;
    }
    
    // Calculate interpolation factor
    const tickDiff = frameB.tick - frameA.tick;
    if (tickDiff === 0) return frameA;
    
    const interpolationFactor = (targetTick - frameA.tick) / tickDiff;
    
    // Create a map of all players from both frames to handle players that might appear/disappear
    const allPlayerIds = new Set<number>();
    frameA.players.forEach(p => allPlayerIds.add(p.id));
    frameB.players.forEach(p => allPlayerIds.add(p.id));
    
    // Create intermediate frame with interpolated players
    const interpolatedPlayers: PlayerState[] = [];
    
    for (const playerId of allPlayerIds) {
      const playerA = frameA.players.find(p => p.id === playerId);
      const playerB = frameB.players.find(p => p.id === playerId);
      
      // If player only exists in one frame, use that frame's data
      if (!playerA && playerB) {
        interpolatedPlayers.push(playerB);
        continue;
      }
      if (playerA && !playerB) {
        interpolatedPlayers.push(playerA);
        continue;
      }
      
      // Both players exist - interpolate
      if (playerA && playerB) {
        // Interpolate position
        const interpolatedX = playerA.position.x + 
          (playerB.position.x - playerA.position.x) * interpolationFactor;
        const interpolatedY = playerA.position.y + 
          (playerB.position.y - playerA.position.y) * interpolationFactor;
        const interpolatedZ = playerA.position.z !== undefined && playerB.position.z !== undefined
          ? playerA.position.z + (playerB.position.z - playerA.position.z) * interpolationFactor
          : playerB.position.z;
        
        // Interpolate view angle (handle 360° wrap-around)
        let angleDiff = playerB.viewAngle - playerA.viewAngle;
        if (angleDiff > 180) angleDiff -= 360;
        if (angleDiff < -180) angleDiff += 360;
        const interpolatedAngle = (playerA.viewAngle + angleDiff * interpolationFactor + 360) % 360;
        
        // Interpolate HP (round to nearest integer)
        const interpolatedHp = Math.round(playerA.hp + (playerB.hp - playerA.hp) * interpolationFactor);
        
        // Use playerB's properties but with interpolated values
        // Keep shotsFired from playerB (most recent value) for accurate muzzle flash detection
        interpolatedPlayers.push({
          ...playerB,
          hp: interpolatedHp,
          position: {
            x: interpolatedX,
            y: interpolatedY,
            ...(interpolatedZ !== undefined && { z: interpolatedZ })
          },
          viewAngle: interpolatedAngle,
          shotsFired: playerB.shotsFired // Keep most recent shotsFired value
        });
      }
    }
    
    // Get events from the closest frame (frameA)
    const events = frameA.events;
    
    return {
      tick: targetTick,
      time: targetTick / tickRate,
      players: interpolatedPlayers,
      events
    };
  };
  
  // Track animation frame for smooth 60fps updates (must be defined before currentFrame)
  const [animationFrame, setAnimationFrame] = React.useState(0);
  
  // Get the interpolated frame for current targetTick
  // Recalculate every frame (animationFrame dependency) for smooth 60fps updates
  const currentFrame = useMemo(() => {
    if (!demoFile || demoFile.frames.length === 0) return null;
    
    // Ensure targetTick is valid
    if (targetTick === undefined || targetTick === null || isNaN(targetTick)) {
      // Fallback to frame index
      const frameIndex = Math.min(currentTick, demoFile.frames.length - 1);
      return demoFile.frames[frameIndex] || null;
    }
    
    // Generate intermediate frame - this will be called every frame for smooth movement
    return generateIntermediateFrame(targetTick, demoFile.frames, demoFile.tickRate);
  }, [demoFile, currentTick, targetTick, animationFrame]);
  
  // Force re-render at 60fps for smooth playback - ALWAYS run when demoFile exists
  React.useEffect(() => {
    if (!demoFile) return;
    
    let animationFrameId: number;
    
    const animate = () => {
      // Update every frame to ensure smooth intermediate frame generation
      setAnimationFrame(prev => prev + 1);
      animationFrameId = requestAnimationFrame(animate);
    };
    
    animationFrameId = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [demoFile]);
  
  // Get players from the interpolated frame (already interpolated in generateIntermediateFrame)
  const players = useMemo(() => {
    if (!currentFrame) return [];
    return currentFrame.players;
  }, [currentFrame]);
  
  // Track if we've logged coordinates for debugging (only once per player)
  const loggedCoordinatesRef = React.useRef<Set<number>>(new Set());
  
  // Get recent kill events (last 5 kills)
  const recentKills = useMemo(() => {
    if (!currentFrame) return [];
    return currentFrame.events
      .filter(e => e.type === 'kill')
      .slice(-5)
      .reverse(); // Most recent first
  }, [currentFrame]);
  
  // Get recent chat messages (last 5 messages)
  const recentChat = useMemo(() => {
    if (!currentFrame) return [];
    return currentFrame.events
      .filter(e => e.type === 'chat')
      .slice(-5)
      .reverse(); // Most recent first
  }, [currentFrame]);
  
  // Track previous frame and active muzzle flashes
  const previousFrameRef = React.useRef<MatchFrame | null>(null);
  const activeMuzzleFlashesRef = React.useRef<Map<number, number>>(new Map()); // playerId -> tick when fired
  
  // Detect players who just fired (shots_fired increased) and maintain active flashes
  const playersWhoFired = useMemo(() => {
    if (!currentFrame) {
      return new Set<number>();
    }
    
    const firedPlayerIds = new Set<number>();
    const currentTick = currentFrame.tick;
    
    // Compare current frame with previous frame to detect shots_fired increases
    if (previousFrameRef.current) {
      currentFrame.players.forEach(currentPlayer => {
        const prevPlayer = previousFrameRef.current!.players.find(p => p.id === currentPlayer.id);
        
        if (prevPlayer && 
            currentPlayer.shotsFired !== undefined && 
            prevPlayer.shotsFired !== undefined &&
            currentPlayer.shotsFired > prevPlayer.shotsFired) {
          // Player fired a shot (shots_fired increased)
          firedPlayerIds.add(currentPlayer.id);
          // Track when this player fired (for persistent flash)
          activeMuzzleFlashesRef.current.set(currentPlayer.id, currentTick);
        }
      });
    }
    
    // Keep muzzle flashes active for a few ticks (about 0.1 seconds at 64 tick rate = ~6 ticks)
    const flashDurationTicks = 6;
    for (const [playerId, fireTick] of activeMuzzleFlashesRef.current.entries()) {
      if (currentTick - fireTick <= flashDurationTicks) {
        firedPlayerIds.add(playerId);
      } else {
        // Remove old flashes
        activeMuzzleFlashesRef.current.delete(playerId);
      }
    }
    
    // Update previous frame reference
    previousFrameRef.current = currentFrame;
    
    return firedPlayerIds;
  }, [currentFrame]);
  
  // Use useMemo to resolve the map config only when mapName changes
  const mapConfig = useMemo(() => getMapConfig(mapName), [mapName]);
  
  // Allow overriding the image URL via upload for this session
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);
  
  // Reset custom image when map changes
  useEffect(() => {
    setCustomImageUrl(null);
  }, [mapName]);

  // Check if this map has multiple floors (like Vertigo)
  const hasMultipleFloors = mapConfig.imageUrls && mapConfig.imageUrls.length > 1;
  const imageUrls = hasMultipleFloors ? mapConfig.imageUrls! : [customImageUrl || mapConfig.imageUrl];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCustomImageUrl(url);
    }
  };

  // Determine which floor a player is on based on Z coordinate
  // For Vertigo, typically Z > ~200 is upper floor, Z < ~200 is lower floor
  const getPlayerFloor = (playerZ?: number): number => {
    if (!hasMultipleFloors || playerZ === undefined) return 0;
    // Vertigo: upper floor is typically around Z > 200, lower floor is Z < 200
    // Adjust threshold as needed based on actual map data
    return playerZ > 200 ? 0 : 1; // 0 = upper, 1 = lower
  };
  
  // Convert world coordinates to SVG coordinates
  // Note: In CS2, Y increases upward, but in SVG/images, Y increases downward
  // For multi-floor maps, we need to transform coordinates relative to each floor's viewport
  const worldToSvg = (worldX: number, worldY: number, playerZ?: number) => {
    // Determine which floor this player is on
    const floorIndex = getPlayerFloor(playerZ);
    
    // Calculate map dimensions
    const mapWidth = mapConfig.maxX - mapConfig.minX;
    const mapHeight = mapConfig.maxY - mapConfig.minY;
    
    // Calculate X position as percentage of map width (0-100%)
    // Normalize: (worldX - minX) / mapWidth gives us 0-1, then * 100 for percentage
    let svgX = ((worldX - mapConfig.minX) / mapWidth) * 100;
    
    // For multi-floor maps, adjust X position to account for side-by-side display
    if (hasMultipleFloors && imageUrls.length > 1) {
      // Each floor image takes up equal portion of the total width
      const floorWidth = 100 / imageUrls.length; // 50% for 2 floors
      // Scale the X coordinate to fit within the floor's viewport
      svgX = (svgX / 100) * floorWidth + (floorIndex * floorWidth);
    }
    
    // Calculate Y position (invert Y axis: world Y increases up, SVG Y increases down)
    // Normalize: (worldY - minY) / mapHeight gives us 0-1
    // Invert: 1 - normalized gives us flipped (since world Y goes up, SVG Y goes down)
    const svgY = 100 - ((worldY - mapConfig.minY) / mapHeight) * 100;
    
    // Clamp values to valid range (0-100%)
    return { 
      x: Math.max(0, Math.min(100, svgX)), 
      y: Math.max(0, Math.min(100, svgY)) 
    };
  };

  const handlePlayerClick = (playerId: number) => {
    useDemoStore.setState({ selectedPlayerId: playerId });
  };

  return (
    <div className="relative w-full h-full bg-slate-950 rounded-lg overflow-hidden border border-slate-800">
      {/* Map Images - Side by side for multi-floor maps */}
      <div className="absolute inset-0 flex">
        {imageUrls.map((imageUrl, floorIndex) => (
          <img 
            key={floorIndex}
            src={imageUrl} 
            alt={`${mapName} ${floorIndex === 0 ? 'Upper' : 'Lower'}`}
            className={`object-contain opacity-90 ${hasMultipleFloors ? 'w-1/2' : 'w-full'}`}
            style={{ height: '100%' }}
            draggable={false}
          />
        ))}
      </div>
      
      {/* Floor Labels for multi-floor maps */}
      {hasMultipleFloors && (
        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-10 flex gap-4">
          <div className="px-3 py-1 bg-slate-900/90 rounded border border-slate-700 backdrop-blur-sm text-xs text-slate-300">
            Upper Floor
          </div>
          <div className="px-3 py-1 bg-slate-900/90 rounded border border-slate-700 backdrop-blur-sm text-xs text-slate-300">
            Lower Floor
          </div>
        </div>
      )}

      {/* SVG Overlay for Players */}
      <svg 
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {players
          .filter((player) => {
            // Filter out players with invalid positions (0,0 or outside map bounds)
            // Players at origin (0,0) haven't spawned yet or are invalid
            const { x, y } = player.position;
            if (x === 0 && y === 0) return false; // Skip players at origin
            
            // Check if position is within reasonable map bounds (with some padding)
            const padding = 500; // Allow some padding outside map bounds
            if (x < mapConfig.minX - padding || x > mapConfig.maxX + padding) return false;
            if (y < mapConfig.minY - padding || y > mapConfig.maxY + padding) return false;
            
            return true;
          })
          .map((player) => {
          // Transform world coordinates to SVG coordinates (handles multi-floor automatically)
          // Use the interpolated position from the intermediate frame
          const svgCoords = worldToSvg(player.position.x, player.position.y, player.position.z);
          const x = svgCoords.x;
          const y = svgCoords.y;
          const teamColor = TEAM_COLORS[player.team];
          const isSelected = player.id === selectedPlayerId;
          const isDead = !player.isAlive;
          const isDisconnected = player.isConnected === false;
          
          // Debug: Log coordinate transformation once per player when selected
          if (isSelected && !loggedCoordinatesRef.current.has(player.id)) {
            loggedCoordinatesRef.current.add(player.id);
            console.log(`[DEBUG] Player ${player.name} coordinates:`, {
              world: { x: player.position.x, y: player.position.y, z: player.position.z },
              svg: { x, y },
              mapConfig: { minX: mapConfig.minX, maxX: mapConfig.maxX, minY: mapConfig.minY, maxY: mapConfig.maxY },
              mapWidth: mapConfig.maxX - mapConfig.minX,
              mapHeight: mapConfig.maxY - mapConfig.minY,
              floor: getPlayerFloor(player.position.z),
              hasBomb: player.hasBomb
            });
          }

          return (
            <g key={player.id}>
              {/* Player Trail / Path (simplified) */}
              {isSelected && (
                <circle
                  cx={x}
                  cy={y}
                  r="1.5"
                  fill={teamColor}
                  opacity="0.3"
                  className="animate-pulse"
              />
              )}
              
              {/* Player Circle */}
              <circle
                cx={x}
                cy={y}
                r={isSelected ? "1.8" : "1.2"}
                fill={isDead ? "#64748b" : (isDisconnected ? "#94a3b8" : teamColor)}
                stroke={player.hasBomb ? "#ef4444" : (isSelected ? "#ffffff" : "#000000")}
                strokeWidth={player.hasBomb ? "0.4" : (isSelected ? "0.3" : "0.2")}
                opacity={isDead ? 0.5 : (isDisconnected ? 0.4 : 1)}
                className={`cursor-pointer transition-all ${isDisconnected ? 'grayscale' : ''}`}
                onClick={() => handlePlayerClick(player.id)}
                style={{
                  filter: player.hasBomb 
                    ? 'drop-shadow(0 0 6px rgba(239,68,68,0.8))' 
                    : (isSelected ? 'drop-shadow(0 0 4px rgba(255,255,255,0.8))' : undefined)
                }}
              />

              {/* Disconnected Indicator */}
              {isDisconnected && !isDead && (
                <g transform={`translate(${x}, ${y})`}>
                    <circle
                    cx="0"
                    cy="0"
                    r="1.5"
                    fill="#64748b"
                    opacity="0.9"
                    />
                  <text
                    x="0"
                    y="0.4"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="1.2"
                    fontWeight="bold"
                    className="pointer-events-none select-none"
                  >
                    📶
                  </text>
                </g>
              )}

              {/* Bomb Icon Indicator */}
              {player.hasBomb && !isDead && (
                <g transform={`translate(${x}, ${y - 2.5})`}>
                  <circle
                    cx="0"
                    cy="0"
                    r="1.2"
                    fill="#ef4444"
                    opacity="0.9"
                  />
                <text
                    x="0"
                    y="0.4"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="1.2"
                    fontWeight="bold"
                    className="pointer-events-none select-none"
                  >
                    💣
                  </text>
                </g>
              )}

              {/* Player Name Label (only for selected player) */}
              {isSelected && (
                <text
                  x={x}
                  y={y - 2.5}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="2"
                  fontWeight="bold"
                  className="pointer-events-none select-none"
                  style={{
                    textShadow: '0 0 3px rgba(0,0,0,0.8), 0 0 3px rgba(0,0,0,0.8)'
                  }}
                >
                    {player.name}
                </text>
              )}

              {/* View Angle Indicator (line showing where player is looking) */}
              {!isDead && (() => {
                // Calculate position-based rotation adjustment if map config provides it
                // This allows different areas of the map to have different rotation corrections
                let positionRotationAdjustment = 0;
                if (mapConfig.positionBasedRotation) {
                  // Normalize position to 0-1 range
                  const mapWidth = mapConfig.maxX - mapConfig.minX;
                  const mapHeight = mapConfig.maxY - mapConfig.minY;
                  const normalizedX = (player.position.x - mapConfig.minX) / mapWidth;
                  const normalizedY = (player.position.y - mapConfig.minY) / mapHeight;
                  
                  // Call the map-specific position-based rotation function
                  positionRotationAdjustment = mapConfig.positionBasedRotation(normalizedX, normalizedY);
                }
                
                // Apply map-specific rotation offset
                const baseRotationOffset = mapConfig.rotationOffset ?? 180; // Default to 180° if not specified
                
                // Combine base rotation offset with position-based adjustment
                const rotationOffset = baseRotationOffset + positionRotationAdjustment;
                
                // Ensure viewAngle is valid (should be interpolated in generateIntermediateFrame)
                const playerViewAngle = player.viewAngle !== undefined && !isNaN(player.viewAngle) 
                  ? player.viewAngle 
                  : 0;
                
                // Apply combined rotation offset
                const adjustedAngle = (playerViewAngle + rotationOffset) % 360;
                if (adjustedAngle < 0) adjustedAngle += 360;
                const angleRad = adjustedAngle * Math.PI / 180;
                
                // Calculate line length (longer line for better visibility)
                const lineLength = 3; // SVG units
                
                // Calculate end point of the line
                const endX = x + Math.cos(angleRad) * lineLength;
                const endY = y + Math.sin(angleRad) * lineLength;
                
                return (
                  <line
                    x1={x}
                    y1={y}
                    x2={endX}
                    y2={endY}
                    stroke={teamColor}
                    strokeWidth="0.2"
                    opacity="0.7"
                    className="pointer-events-none"
                  />
                );
              })()}
              
              {/* Muzzle Flash Indicator */}
              {!isDead && playersWhoFired.has(player.id) && (() => {
                const rotationOffset = mapConfig.rotationOffset ?? 180;
                const playerViewAngle = player.viewAngle !== undefined && !isNaN(player.viewAngle) 
                  ? player.viewAngle 
                  : 0;
                const adjustedAngle = (playerViewAngle + rotationOffset) % 360;
                const angleRad = adjustedAngle * Math.PI / 180;
                
                // Position muzzle flash slightly in front of player in the direction they're looking
                const flashDistance = 1.5; // SVG units
                const flashX = x + Math.cos(angleRad) * flashDistance;
                const flashY = y + Math.sin(angleRad) * flashDistance;
                
                return (
                  <g>
                    {/* Muzzle flash circle */}
                    <circle
                      cx={flashX}
                      cy={flashY}
                      r="0.8"
                      fill="#ffaa00"
                      opacity="0.9"
                      className="pointer-events-none"
                    >
                      <animate
                        attributeName="opacity"
                        values="0.9;0.3;0.9"
                        dur="0.1s"
                        repeatCount="3"
                      />
                      <animate
                        attributeName="r"
                        values="0.8;1.2;0.8"
                        dur="0.1s"
                        repeatCount="3"
                      />
                    </circle>
                    {/* Outer glow */}
                    <circle
                      cx={flashX}
                      cy={flashY}
                      r="1.2"
                      fill="#ff6600"
                      opacity="0.5"
                      className="pointer-events-none"
                    >
                      <animate
                        attributeName="opacity"
                        values="0.5;0;0.5"
                        dur="0.1s"
                        repeatCount="3"
                      />
                    </circle>
                  </g>
                );
              })()}
            </g>
          );
        })}
      </svg>
      
      {/* Upload Custom Map Image Button */}
      <div className="absolute top-2 right-2 z-10">
        <label className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-slate-900/80 hover:bg-slate-800 text-slate-300 rounded border border-slate-700 cursor-pointer transition-colors backdrop-blur-sm">
            <ImageIcon size={14} />
          <span>Custom Map</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </label>
      </div>

      {/* Map Name Badge */}
      <div className="absolute bottom-2 left-2 px-3 py-1.5 bg-slate-900/80 text-xs font-semibold text-slate-300 rounded border border-slate-700 backdrop-blur-sm">
        {mapName}
      </div>
      
      {/* Score Display - Calculate scores based on current round */}
      {demoFile?.rounds && (() => {
        // Find current round
        const currentRound = demoFile.rounds.find(r => 
          currentTick >= r.startTick && (r.endTick === undefined || currentTick < r.endTick)
        );
        
        // Calculate scores up to rounds that have ended before or at current tick
        // Get the actual tick from the current frame, not the frame index
        const actualTick = currentFrame?.tick || currentTick;
        
        let ctScore = 0;
        let tScore = 0;
        demoFile.rounds.forEach(round => {
          // Only count rounds that have ended (have a winner and we're past the round's end tick)
          if (round.winner && round.endTick !== undefined) {
            // A round has ended if we're past or at its end tick
            // Use >= to count the round as soon as it ends
            if (actualTick >= round.endTick) {
              if (round.winner === Team.CT) {
                ctScore++;
              } else if (round.winner === Team.T) {
                tScore++;
              }
            }
          }
        });
        
        return (
          <div className="absolute top-2 left-2 flex gap-2 z-10">
            <div className="px-4 py-2 bg-slate-900/90 rounded border border-slate-700 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: TEAM_COLORS[Team.CT] }} />
                <span className="text-sm font-semibold text-slate-200">Team A</span>
                <span className="text-lg font-bold text-white">{ctScore}</span>
              </div>
            </div>
            <div className="px-4 py-2 bg-slate-900/90 rounded border border-slate-700 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: TEAM_COLORS[Team.T] }} />
                <span className="text-sm font-semibold text-slate-200">Team B</span>
                <span className="text-lg font-bold text-white">{tScore}</span>
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* Kill Feed */}
      {recentKills.length > 0 && (
        <div className="absolute top-20 left-2 flex flex-col gap-1 z-10 max-w-xs">
          {recentKills.map((kill, index) => (
            <div
              key={`${kill.tick}-${index}`}
              className="px-3 py-1.5 bg-slate-900/90 rounded border border-slate-700 backdrop-blur-sm text-xs text-slate-200 animate-fade-in"
            >
              <span className="text-slate-300">{kill.description}</span>
            </div>
          ))}
        </div>
      )}
      
      {/* Chat Feed */}
      {recentChat.length > 0 && (
        <div className="absolute bottom-20 left-2 flex flex-col gap-1 z-10 max-w-xs">
          {recentChat.map((chat, index) => (
            <div
              key={`${chat.tick}-${index}`}
              className="px-3 py-1.5 bg-blue-900/90 rounded border border-blue-700 backdrop-blur-sm text-xs text-slate-200 animate-fade-in"
            >
              <span className="text-blue-300 font-semibold">{chat.playerName}:</span>
              <span className="text-slate-200 ml-1">{chat.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MapVisualization;
