import { useEffect } from 'react';
import { useCalendarStore } from '../../store/calendarStore';
import { normalizeApiAssetUrl } from '../../utils/api';

interface UserAvatarBadgeProps {
    size?: number;
}

export const UserAvatarBadge: React.FC<UserAvatarBadgeProps> = ({ size = 36 }) => {
    const { user, profile, fetchProfile } = useCalendarStore();
    const avatarUrl = normalizeApiAssetUrl(profile?.avatar_url || user?.avatar_url) || '/default-avatar.svg';

    useEffect(() => {
        if (user && !profile?.avatar_url) {
            fetchProfile();
        }
    }, [fetchProfile, profile?.avatar_url, user]);

    const dimensionStyle = { width: size, height: size };
    return (
        <div
            className="rounded-full flex items-center justify-center text-white font-bold font-mono shadow-md overflow-hidden bg-white"
            style={dimensionStyle}
        >
            <img
                src={avatarUrl}
                alt={user?.username || 'User'}
                className="w-full h-full rounded-full object-cover"
            />
        </div>
    );
};
