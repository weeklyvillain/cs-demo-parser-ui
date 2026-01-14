import React, { useMemo, useState } from 'react';
import { X, Filter, Clock, MessageSquare } from 'lucide-react';
import { useDemoStore } from '../store/useDemoStore';
import { GameEvent, Team } from '../types';
import { TEAM_COLORS } from '../constants';

interface AllChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AllChatModal: React.FC<AllChatModalProps> = ({ isOpen, onClose }) => {
  const { demoFile, currentTick } = useDemoStore();
  const [showFullChat, setShowFullChat] = useState(false);
  const [filteredPlayer, setFilteredPlayer] = useState<string | null>(null);

  // Get all chat messages from both teams
  const allChatMessages = useMemo(() => {
    if (!demoFile) return [];
    
    const messages: Array<GameEvent & { time: number; team: Team }> = [];
    const teamPlayerNames = new Map<Team, Set<string>>();
    teamPlayerNames.set(Team.CT, new Set());
    teamPlayerNames.set(Team.T, new Set());
    
    // Determine the frame range to search
    const maxFrameIndex = showFullChat 
      ? demoFile.frames.length - 1 
      : Math.min(currentTick, demoFile.frames.length - 1);
    
    // First, collect all player names for each team
    for (let i = 0; i <= maxFrameIndex; i++) {
      const frame = demoFile.frames[i];
      if (!frame) continue;
      
      frame.players.forEach(player => {
        if (player.team === Team.CT || player.team === Team.T) {
          teamPlayerNames.get(player.team)!.add(player.name);
        }
      });
    }
    
    // Now collect all chat messages
    for (let i = 0; i <= maxFrameIndex; i++) {
      const frame = demoFile.frames[i];
      if (!frame) continue;
      
      frame.events
        .filter(e => e.type === 'chat' && e.playerName && e.message)
        .forEach(chatEvent => {
          // Determine which team this player belongs to
          let playerTeam: Team | null = null;
          for (const [team, names] of teamPlayerNames.entries()) {
            if (names.has(chatEvent.playerName!)) {
              playerTeam = team;
              break;
            }
          }
          
          if (playerTeam) {
            messages.push({
              ...chatEvent,
              time: frame.time,
              team: playerTeam
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
  }, [demoFile, currentTick, showFullChat, filteredPlayer]);

  // Get unique player names from all chat messages
  const allPlayerNames = useMemo(() => {
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
          names.add(chatEvent.playerName!);
        });
    }
    
    return Array.from(names).sort();
  }, [demoFile, currentTick, showFullChat]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-orange-400" />
            <h2 className="text-lg font-bold text-white">All Chat</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0 gap-4">
          <div className="flex items-center gap-2 flex-1">
            <Filter size={14} className="text-slate-500" />
            <select
              value={filteredPlayer || ''}
              onChange={(e) => setFilteredPlayer(e.target.value || null)}
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-300 hover:bg-slate-700 transition-colors"
              title="Filter by player"
            >
              <option value="">All Players</option>
              {allPlayerNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {filteredPlayer && (
              <button
                onClick={() => setFilteredPlayer(null)}
                className="p-2 rounded hover:bg-slate-800 transition-colors text-slate-500 hover:text-slate-300"
                title="Clear filter"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFullChat(!showFullChat)}
            className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              showFullChat 
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
            }`}
            title={showFullChat ? "Show chat up to current time" : "Show full chat"}
          >
            <Clock size={14} />
            {showFullChat ? 'Current Time' : 'Full Chat'}
          </button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {allChatMessages.length === 0 ? (
            <div className="text-center text-slate-500 py-8">
              {filteredPlayer ? `No messages from ${filteredPlayer}` : 'No chat messages'}
            </div>
          ) : (
            allChatMessages.map((chat, index) => {
              const teamColor = TEAM_COLORS[chat.team];
              const isTeamA = chat.team === Team.CT;
              
              return (
                <div
                  key={`${chat.tick}-${index}`}
                  className="px-4 py-3 rounded-lg bg-slate-800/50 hover:bg-slate-800/70 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div 
                      className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0"
                      style={{ 
                        backgroundColor: `${teamColor}20`,
                        color: teamColor
                      }}
                    >
                      {isTeamA ? 'Team A' : 'Team B'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 mb-1">
                        <span 
                          className="font-semibold text-sm shrink-0"
                          style={{ color: teamColor }}
                        >
                          {chat.playerName}:
                        </span>
                        <span className="text-slate-300 text-sm flex-1 break-words">
                          {chat.message}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {Math.floor(chat.time / 60)}:{(Math.floor(chat.time % 60)).toString().padStart(2, '0')}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default AllChatModal;

