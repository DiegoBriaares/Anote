import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useCalendarStore } from '../../store/calendarStore';
import { normalizeApiAssetUrl } from '../../utils/api';
import { useTranslation } from '../../i18n/languageContext';

interface UserAvatarBadgeProps {
    size?: number;
}

export const UserAvatarBadge: React.FC<UserAvatarBadgeProps> = ({ size = 36 }) => {
    const { user, profile, fetchProfile } = useCalendarStore(useShallow((state) => ({
        user: state.user,
        profile: state.profile,
        fetchProfile: state.fetchProfile
    })));
    const avatarUrl = normalizeApiAssetUrl(profile?.avatar_url || user?.avatar_url) || '/default-avatar.svg';
    const { text } = useTranslation();

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
                alt={user?.username || text.common.user}
                className="w-full h-full rounded-full object-cover"
            />
        </div>
    );
};
