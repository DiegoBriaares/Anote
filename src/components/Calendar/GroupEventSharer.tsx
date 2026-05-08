import React from 'react';
import { Send, Users } from 'lucide-react';
import type { CalendarEvent } from '../../store/calendarStore';
import clsx from 'clsx';

interface ShareFriend {
    id: string;
    username: string;
}

interface GroupEventSharerProps {
    selectedDateKeys: string[];
    eventsByDate: Record<string, CalendarEvent[]>;
    friends: ShareFriend[];
    selectedFriendIds: string[];
    isSubmitting: boolean;
    onToggleFriend: (friendId: string) => void;
    onShare: () => void;
}

export const GroupEventSharer: React.FC<GroupEventSharerProps> = ({
    selectedDateKeys,
    eventsByDate,
    friends,
    selectedFriendIds,
    isSubmitting,
    onToggleFriend,
    onShare
}) => {
    const totalEvents = selectedDateKeys.reduce((count, dateKey) => count + (eventsByDate[dateKey]?.length || 0), 0);
    const canShare = selectedFriendIds.length > 0 && selectedDateKeys.length > 0 && totalEvents > 0 && !isSubmitting;

    return (
        <div className="mb-8 board-panel rounded-2xl p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.25em]">Event Distribution</div>
                    <div className="text-lg text-stone-800 tracking-[0.16em]">Share Events</div>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono text-orange-600 uppercase tracking-[0.2em] flex-wrap">
                    <span>{selectedDateKeys.length} day{selectedDateKeys.length === 1 ? '' : 's'}</span>
                    <span>{totalEvents} event{totalEvents === 1 ? '' : 's'}</span>
                    <span>{selectedFriendIds.length} friend{selectedFriendIds.length === 1 ? '' : 's'}</span>
                </div>
            </div>

            {totalEvents === 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-mono text-amber-700">
                    Selected days do not have events to share.
                </div>
            )}

            <div className="rounded-xl border border-orange-100 bg-white/75 p-3">
                <div className="mb-3 flex items-center gap-2 border-b border-orange-100 pb-2">
                    <Users className="h-4 w-4 text-orange-500" />
                    <div className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-stone-700">Select Friends</div>
                </div>

                {friends.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-orange-100 px-3 py-6 text-center text-[11px] font-mono text-stone-400">
                        No friends available
                    </div>
                ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {friends.map((friend) => {
                            const isSelected = selectedFriendIds.includes(friend.id);

                            return (
                                <label
                                    key={friend.id}
                                    className={clsx(
                                        'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors',
                                        isSelected
                                            ? 'border-orange-300 bg-orange-50 text-orange-700'
                                            : 'border-stone-100 bg-white text-stone-700 hover:border-orange-200 hover:bg-orange-50/60',
                                        isSubmitting && 'cursor-not-allowed opacity-60'
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={isSubmitting}
                                        onChange={() => onToggleFriend(friend.id)}
                                        className="h-4 w-4 accent-orange-500"
                                    />
                                    <span className="min-w-0 truncate font-medium">{friend.username}</span>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={onShare}
                    disabled={!canShare}
                    className={clsx(
                        'min-h-[42px] rounded-xl bg-orange-500 px-5 py-2 text-xs font-mono font-bold uppercase tracking-[0.18em] text-white shadow-lg shadow-orange-300/40 transition-colors hover:bg-orange-600 flex items-center gap-2',
                        !canShare && 'cursor-not-allowed opacity-50 hover:bg-orange-500'
                    )}
                >
                    <Send className="h-4 w-4" />
                    {isSubmitting ? 'Sharing...' : 'Share Events'}
                </button>
            </div>
        </div>
    );
};
