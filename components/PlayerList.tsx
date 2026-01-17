import React, { useMemo, useState } from 'react';
import { Team, PlayerState, GameEvent } from '../types';
import { TEAM_COLORS } from '../constants';
import { Volume2, VolumeX, Crosshair, Skull, Bomb, Shield, HardHat, WifiOff, Clock, MessageSquare, Filter, X } from 'lucide-react';
import { useDemoStore } from '../store/useDemoStore';
import { useAudioMixer } from '../hooks/useAudioMixer';

// CS2 Player Color Palette (common colors used in CS2)
const PLAYER_COLORS: string[] = [
  '#ff0000', // Red
  '#00ff00', // Green
  '#0000ff', // Blue
  '#ffff00', // Yellow
  '#ff00ff', // Magenta
  '#00ffff', // Cyan
  '#ff8000', // Orange
  '#8000ff', // Purple
  '#ff0080', // Pink
  '#00ff80', // Light Green
];

// Color name to hex mapping
const COLOR_NAME_TO_HEX: Record<string, string> = {
  'red': '#ff0000',
  'green': '#00ff00',
  'blue': '#0000ff',
  'yellow': '#ffff00',
  'magenta': '#ff00ff',
  'cyan': '#00ffff',
  'orange': '#ff8000',
  'purple': '#8000ff',
  'pink': '#ff0080',
  'lightgreen': '#00ff80',
  'light green': '#00ff80',
  'lime': '#00ff00',
  'white': '#ffffff',
  'black': '#000000',
};

// Convert player color (name or ID) to RGB color with opacity
function getPlayerColorRgba(player: PlayerState, opacity: number = 0.08): string | undefined {
  if (player.playerColor === undefined || player.playerColor === null) {
    return undefined;
  }

  let colorHex: string | undefined;

  if (typeof player.playerColor === 'string') {
    // It's a color name, look it up
    const colorName = player.playerColor.toLowerCase().trim();
    colorHex = COLOR_NAME_TO_HEX[colorName];
    
    // If not found, try to parse as hex
    if (!colorHex && /^#[0-9a-f]{6}$/i.test(colorName)) {
      colorHex = colorName;
    }
  } else if (typeof player.playerColor === 'number') {
    // It's a numeric ID, use modulo to select from palette
    const colorIndex = player.playerColor % PLAYER_COLORS.length;
    colorHex = PLAYER_COLORS[colorIndex];
  }

  if (colorHex) {
    // Convert hex to RGB
    const r = parseInt(colorHex.slice(1, 3), 16);
    const g = parseInt(colorHex.slice(3, 5), 16);
    const b = parseInt(colorHex.slice(5, 7), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  return undefined;
}

interface PlayerListProps {
  team: Team;
}

const PlayerList: React.FC<PlayerListProps> = ({ team }) => {
  const { 
    getActivePlayers, 
  selectedPlayerId,
  mutedPlayerIds,
    toggleMute, 
    toggleTeamMute,
    setIsPlaying 
  } = useDemoStore();
  
  const activePlayers = getActivePlayers();
  const { isPlaying } = useDemoStore();
  const { talkingStates } = useAudioMixer(activePlayers, mutedPlayerIds, isPlaying);
  
  const { demoFile, currentTick } = useDemoStore();
  const teamPlayers = activePlayers.filter((p) => p.team === team);
  const teamColor = TEAM_COLORS[team];
  const [showFullChat, setShowFullChat] = useState(false);
  const [filteredPlayer, setFilteredPlayer] = useState<string | null>(null);

  // Determine if the entire team is muted
  const isTeamMuted = teamPlayers.length > 0 && teamPlayers.every(p => mutedPlayerIds.has(p.id));

  // Get all chat messages for this team
  const teamChatMessages = useMemo(() => {
    if (!demoFile) return [];
    
    const messages: Array<GameEvent & { time: number }> = [];
    // Collect all player names that have ever been on this team across all frames
    const teamPlayerNames = new Set<string>();
    
    // Determine the frame range to search
    const maxFrameIndex = showFullChat 
      ? demoFile.frames.length - 1 
      : Math.min(currentTick, demoFile.frames.length - 1);
    
    // First, collect all player names that have been on this team
    for (let i = 0; i <= maxFrameIndex; i++) {
      const frame = demoFile.frames[i];
      if (!frame) continue;
      
      frame.players
        .filter(p => p.team === team)
        .forEach(player => {
          teamPlayerNames.add(player.name);
        });
    }
    
    // Now collect all chat messages from players on this team
    for (let i = 0; i <= maxFrameIndex; i++) {
      const frame = demoFile.frames[i];
      if (!frame) continue;
      
      frame.events
        .filter(e => e.type === 'chat' && e.playerName && e.message)
        .forEach(chatEvent => {
          // Match chat message to team by player name
          if (teamPlayerNames.has(chatEvent.playerName!)) {
            messages.push({
              ...chatEvent,
              time: frame.time
            });
          }
        });
    }
    
    // Filter by player if selected
    const filtered = filteredPlayer 
      ? messages.filter(m => m.playerName === filteredPlayer)
      : messages;
    
    // Sort by tick (chronological order)
    return filtered.sort((a, b) => a.tick - b.tick);
  }, [demoFile, currentTick, team, showFullChat, filteredPlayer]);

  // Get unique player names from chat messages for filter dropdown
  const chatPlayerNames = useMemo(() => {
    if (!demoFile) return [];
    const names = new Set<string>();
    const maxFrameIndex = showFullChat 
      ? demoFile.frames.length - 1 
      : Math.min(currentTick, demoFile.frames.length - 1);
    
    for (let i = 0; i <= maxFrameIndex; i++) {
      const frame = demoFile.frames[i];
      if (!frame) continue;
      
      frame.events
        .filter(e => e.type === 'chat' && e.playerName)
        .forEach(chatEvent => {
          // Check if this player was ever on this team
          for (const f of demoFile.frames) {
            const player = f.players.find(p => p.name === chatEvent.playerName && p.team === team);
            if (player) {
              names.add(chatEvent.playerName!);
              break;
            }
          }
        });
    }
    
    return Array.from(names).sort();
  }, [demoFile, currentTick, team, showFullChat]);

  return (
    <div className="flex flex-col gap-1 w-full h-full flex-1 min-h-0">
      <div className="flex items-center justify-between mb-2 px-2 border-b border-slate-800 pb-1 shrink-0">
        <h3 
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: teamColor }}
        >
            {team === Team.CT ? 'Team A' : 'Team B'}
        </h3>
        <button 
            onClick={() => toggleTeamMute(team)}
            className={`p-1 rounded hover:bg-slate-800 transition-colors ${isTeamMuted ? 'text-red-400' : 'text-slate-500 hover:text-slate-300'}`}
            title={isTeamMuted ? "Unmute Team" : "Mute Team"}
        >
            {isTeamMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
      
      {/* Players List - scrollable */}
      <div className="flex flex-col gap-1 overflow-y-auto shrink-0" style={{ maxHeight: '40%' }}>
      
      {teamPlayers.map((player) => {
        const isSelected = player.id === selectedPlayerId;
        const isMuted = mutedPlayerIds.has(player.id);
        const isTalking = talkingStates[player.id];
        const isDead = !player.isAlive;
        const isDisconnected = player.isConnected === false;
        const playerBgColor = getPlayerColorRgba(player, 0.08); // 8% opacity for subtle background

        return (
          <div
            key={player.id}
            className={`
              group relative flex items-center justify-between p-2 rounded-md cursor-pointer transition-all duration-200
              ${isSelected ? 'bg-slate-800 ring-1 ring-slate-600' : 'hover:bg-slate-800/50'}
              ${isDead ? 'opacity-50 grayscale' : ''}
              ${isDisconnected ? 'opacity-40 grayscale' : ''}
            `}
            style={{
              backgroundColor: playerBgColor && !isSelected ? playerBgColor : undefined
            }}
            onClick={() => useDemoStore.setState({ selectedPlayerId: player.id })}
          >
            {/* Talking Indicator Background */}
            {isTalking && !isDead && (
              <div className="absolute inset-0 bg-green-500/10 rounded-md animate-pulse pointer-events-none" />
            )}

            <div className="flex items-center gap-3 z-10 flex-1 min-w-0">
              {/* Avatar / Health Circle */}
              <div className="relative w-10 h-10 flex items-center justify-center bg-slate-900 rounded-full border-2 flex-shrink-0" 
                   style={{ borderColor: isDead ? '#64748b' : teamColor }}>
                {isDead ? (
                  <Skull size={16} className="text-slate-500" />
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="text-xs font-bold leading-none" style={{ color: teamColor }}>
                    {player.hp}
                  </span>
                    <span className="text-[8px] text-slate-500 leading-none mt-0.5">HP</span>
                  </div>
                )}
                
                {/* Health Bar Ring */}
                {!isDead && (
                   <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none">
                     <circle
                       cx="20" cy="20" r="18"
                       fill="none"
                       stroke={player.hp > 50 ? '#22c55e' : player.hp > 25 ? '#eab308' : '#ef4444'}
                       strokeWidth="2.5"
                       strokeDasharray={`${(player.hp / 100) * 113} 113`}
                       className="opacity-90 transition-all"
                     />
                   </svg>
                )}
              </div>

              <div className="flex flex-col flex-1 min-w-0 gap-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-slate-300'} truncate`}>
                  {player.name}
                </span>
                  {isDisconnected && (
                    <WifiOff 
                      size={14} 
                      className="text-slate-500 flex-shrink-0" 
                      title="Disconnected"
                    />
                  )}
                  {player.hasBomb && (
                    <Bomb 
                      size={14} 
                      className="text-red-500 flex-shrink-0" 
                      title="Has C4 Bomb"
                    />
                  )}
                  {player.hasDefuser && (
                    <Shield 
                      size={14} 
                      className="text-blue-400 flex-shrink-0" 
                      title="Has Defuser Kit"
                    />
                  )}
                  {player.hasHelmet && (
                    <HardHat 
                      size={14} 
                      className="text-yellow-400 flex-shrink-0" 
                      title="Has Helmet"
                    />
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Weapon Display */}
                  {(player.equipment?.primary || player.equipment?.secondary) ? (
                    <span className="text-[10px] text-slate-300 uppercase font-medium">
                      {player.equipment.primary || player.equipment.secondary}
                    </span>
                  ) : (
                <span className="text-[10px] text-slate-500 uppercase">
                      Knife
                    </span>
                  )}
                  
                  {/* Money Display */}
                  {player.money !== undefined && player.money !== null && (
                    <span className="text-[10px] text-green-400 font-semibold whitespace-nowrap">
                      ${player.money.toLocaleString()}
                    </span>
                  )}
                  
                  {/* Utility/Grenades Display */}
                  {player.equipment?.grenades && Array.isArray(player.equipment.grenades) && player.equipment.grenades.length > 0 && (
                    <div className="flex items-center gap-1">
                      {player.equipment.grenades.slice(0, 4).map((grenade, idx) => {
                        // Clean up grenade names for display
                        const grenadeName = grenade.toLowerCase();
                        let displayName = grenade;
                        if (grenadeName.includes('hegrenade') || grenadeName.includes('he_grenade')) displayName = 'HE';
                        else if (grenadeName.includes('flashbang') || grenadeName.includes('flash')) displayName = 'FLASH';
                        else if (grenadeName.includes('smokegrenade') || grenadeName.includes('smoke')) displayName = 'SMOKE';
                        else if (grenadeName.includes('molotov') || grenadeName.includes('incendiary')) displayName = 'MOLO';
                        else if (grenadeName.includes('decoy')) displayName = 'DECOY';
                        else displayName = grenade.substring(0, 4).toUpperCase();
                        
                        return (
                          <span 
                            key={idx}
                            className="text-[9px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded uppercase font-medium"
                            title={grenade}
                          >
                            {displayName}
                          </span>
                        );
                      })}
                      {player.equipment.grenades.length > 4 && (
                        <span className="text-[9px] text-slate-500">
                          +{player.equipment.grenades.length - 4}
                </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 z-10">
              {/* Focus Button */}
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  useDemoStore.setState({ selectedPlayerId: player.id });
                }}
                className={`p-1.5 rounded hover:bg-slate-700 ${isSelected ? 'text-blue-400' : 'text-slate-600'}`}
                title="Focus Player"
              >
                <Crosshair size={14} />
              </button>

              {/* Voice Toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute(player.id);
                }}
                className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${
                  isTalking ? 'text-green-400' : isMuted ? 'text-red-400' : 'text-slate-600'
                }`}
                title={isMuted ? "Unmute Voice" : "Mute Voice"}
              >
                {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} className={isTalking ? "animate-pulse" : ""} />}
              </button>
            </div>
          </div>
        );
      })}
      </div>
      
      {/* Team Chat Section - takes remaining space */}
      {teamChatMessages.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0 mt-4 pt-3 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2 px-2 shrink-0 gap-2">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <MessageSquare size={12} />
              Team Chat
            </h4>
            <div className="flex items-center gap-1">
              {/* Player Filter Dropdown */}
              <div className="relative">
                <select
                  value={filteredPlayer || ''}
                  onChange={(e) => setFilteredPlayer(e.target.value || null)}
                  className="text-[10px] px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-300 hover:bg-slate-700 transition-colors appearance-none cursor-pointer pr-6"
                  title="Filter by player"
                >
                  <option value="">All Players</option>
                  {chatPlayerNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <Filter size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
              </div>
              {/* Clear Filter Button */}
              {filteredPlayer && (
                <button
                  onClick={() => setFilteredPlayer(null)}
                  className="p-1 rounded hover:bg-slate-800 transition-colors text-slate-500 hover:text-slate-300"
                  title="Clear filter"
                >
                  <X size={10} />
                </button>
              )}
              {/* Full Chat Toggle */}
              <button
                onClick={() => setShowFullChat(!showFullChat)}
                className={`p-1 rounded hover:bg-slate-800 transition-colors ${
                  showFullChat ? 'text-orange-400' : 'text-slate-500 hover:text-slate-300'
                }`}
                title={showFullChat ? "Show chat up to current time" : "Show full chat"}
              >
                <Clock size={12} />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-0">
            {teamChatMessages.length === 0 ? (
              <div className="text-xs text-slate-500 px-2 py-4 text-center">
                {filteredPlayer ? `No messages from ${filteredPlayer}` : 'No chat messages'}
              </div>
            ) : (
              teamChatMessages.map((chat, index) => (
                <div
                  key={`${chat.tick}-${index}`}
                  className="px-2 py-1.5 rounded text-xs bg-slate-900/50 hover:bg-slate-900/70 transition-colors"
                >
                  <div className="flex items-start gap-1.5">
                    <span 
                      className="font-semibold flex-shrink-0"
                      style={{ color: teamColor }}
                    >
                      {chat.playerName}:
                    </span>
                    <span className="text-slate-300 flex-1 break-words">
                      {chat.message}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 ml-1">
                    {Math.floor(chat.time / 60)}:{(Math.floor(chat.time % 60)).toString().padStart(2, '0')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayerList;
