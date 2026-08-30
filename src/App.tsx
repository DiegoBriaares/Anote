import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock3, Eye, Loader2, LogOut, Settings, Shield, User, Users } from 'lucide-react';

import { Login } from './components/Auth/Login';
import { CalendarView } from './components/Calendar/CalendarView';
import { interpolateText } from './i18n/appText';
import { useTranslation } from './i18n/languageContext';
import { useCalendarStore } from './store/calendarStore';
import { resolveConfigurationText } from './utils/configurationText';
import { resolveOwnPreferences } from './utils/preferences';

const lazyNamed = <T extends Record<string, unknown>, K extends keyof T>(
    loader: () => Promise<T>,
    name: K
) => lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));

const AdminPanel = lazyNamed(() => import('./components/Admin/AdminPanel'), 'AdminPanel');
const DayEventsAdministrationPage = lazyNamed(
    () => import('./components/Calendar/DayEventsAdministrationPage'),
    'DayEventsAdministrationPage'
);
const PostponedEventsView = lazyNamed(
    () => import('./components/Calendar/PostponedEventsView'),
    'PostponedEventsView'
);
const SocialPanel = lazyNamed(() => import('./components/Friends/SocialPanel'), 'SocialPanel');
const ProfilePanel = lazyNamed(() => import('./components/Profile/ProfilePanel'), 'ProfilePanel');
const ProgramsPanel = lazyNamed(() => import('./components/Programs/ProgramsPanel'), 'ProgramsPanel');
const RolesPanel = lazyNamed(() => import('./components/Roles/RolesPanel'), 'RolesPanel');

const STORED_DEFAULT_SUBTITLE = 'Mark progress, move plans, and keep your calendar notes in one place.';
const STORED_DEFAULT_CONSOLE_TITLE = 'Anote Console';

const RouteLoading = () => {
    const { text } = useTranslation();
    return (
        <div className="flex min-h-48 items-center justify-center gap-3 text-stone-500" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span>{text.common.loading}</span>
        </div>
    );
};

function App() {
    const {
        user,
        sessionStatus,
        restoreSession,
        logout,
        viewMode,
        viewingUsername,
        profile,
        viewingPreferences,
        localPreferences,
        currentView,
        navigateToProfile,
        navigateToFriends,
        navigateToRoles,
        navigateToPrograms,
        viewOwnCalendar,
        navigateToAdmin,
        appConfig,
        socialError,
        bootstrap,
        fetchAppConfig,
        pollProgramRunNotifications
    } = useCalendarStore();
    const { language, setLanguage, text } = useTranslation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        restoreSession();
    }, [restoreSession]);

    useEffect(() => {
        fetchAppConfig();
        const handleFocus = () => {
            if (currentView !== 'admin') fetchAppConfig();
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [fetchAppConfig, currentView]);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        let interval: number | null = null;
        void bootstrap().then(() => {
            if (cancelled || useCalendarStore.getState().user?.id !== user.id) return;
            void pollProgramRunNotifications();
            interval = window.setInterval(pollProgramRunNotifications, 30_000);
        });
        return () => {
            cancelled = true;
            if (interval !== null) window.clearInterval(interval);
        };
    }, [bootstrap, pollProgramRunNotifications, user]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isMenuOpen) {
                setIsMenuOpen(false);
                menuButtonRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isMenuOpen]);

    const userPreferences = resolveOwnPreferences(profile?.preferences, null, localPreferences);
    const friendPreferences = viewMode === 'friend' ? viewingPreferences || {} : {};
    const theme = userPreferences.theme === 'dark' ? 'dark' : 'light';
    const accentColor = userPreferences.accentColor || '#f97316';
    const backgroundUrl = friendPreferences.backgroundUrl || userPreferences.backgroundUrl;

    useEffect(() => {
        if (userPreferences.language && userPreferences.language !== language) {
            setLanguage(userPreferences.language);
        }
    }, [language, setLanguage, userPreferences.language]);

    useEffect(() => {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light');
        document.body.style.setProperty('--accent', accentColor);
        document.body.style.setProperty('--accent-orange', accentColor);
    }, [theme, accentColor]);

    if (sessionStatus === 'loading') return <RouteLoading />;
    if (!user) return <Login />;

    const appTitle = appConfig?.app_title || text.common.anote;
    const appSubtitle = resolveConfigurationText(
        appConfig?.app_subtitle,
        STORED_DEFAULT_SUBTITLE,
        text.shell.defaultSubtitle
    );
    const consoleTitle = resolveConfigurationText(
        appConfig?.console_title,
        STORED_DEFAULT_CONSOLE_TITLE,
        text.shell.defaultConsoleTitle
    );
    const backgroundStyle = backgroundUrl
        ? { backgroundImage: `url("${backgroundUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : {};
    const glowNorthwest = theme === 'dark'
        ? 'bg-gradient-to-br from-sky-500/20 to-indigo-500/10'
        : 'bg-gradient-to-br from-orange-400/30 to-amber-300/20';
    const glowSoutheast = theme === 'dark'
        ? 'bg-gradient-to-tl from-indigo-500/18 to-emerald-400/10'
        : 'bg-gradient-to-tl from-amber-200/40 to-orange-300/20';
    const glowCenter = theme === 'dark'
        ? 'bg-gradient-radial from-sky-400/18 to-transparent'
        : 'bg-gradient-radial from-orange-100/30 to-transparent';

    const navigateFromMenu = (navigate: () => void) => {
        navigate();
        setIsMenuOpen(false);
    };

    return (
        <div
            className={`min-h-screen ${theme === 'dark' ? 'text-slate-100' : 'text-stone-800'} selection:bg-orange-500/30 relative transition-all duration-1000`}
            style={{ ...backgroundStyle, ['--accent' as string]: accentColor }}
        >
            {backgroundUrl && (
                <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-slate-950/70' : 'bg-white/80'} pointer-events-none`} />
            )}
            <div className={`pointer-events-none fixed -top-20 -left-20 w-96 h-96 ${glowNorthwest} blur-3xl rounded-full`} />
            <div className={`pointer-events-none fixed bottom-0 right-0 w-[500px] h-[500px] ${glowSoutheast} blur-3xl rounded-full`} />
            <div className={`pointer-events-none fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] ${glowCenter} blur-3xl rounded-full`} />

            <div className="fixed top-4 right-4 z-50" ref={menuRef}>
                <button
                    ref={menuButtonRef}
                    type="button"
                    className="user-menu-toggle flex items-center gap-2 bg-white/90 backdrop-blur-xl p-2 rounded-full border border-orange-200 pr-4 hover:bg-orange-50 hover:border-orange-300 transition-all duration-300 select-none shadow-lg shadow-orange-100/50"
                    aria-label={text.shell.openUserMenu}
                    aria-haspopup="menu"
                    aria-controls="anote-user-menu"
                    aria-expanded={isMenuOpen}
                    onClick={() => setIsMenuOpen((open) => !open)}
                >
                    <span
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold font-mono shadow-md"
                        style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}CC)` }}
                    >
                        {user.username[0].toUpperCase()}
                    </span>
                    <span className="text-sm font-medium tracking-wide" style={{ color: accentColor }}>{user.username}</span>
                    <ChevronDown aria-hidden="true" className={`w-4 h-4 transition-transform duration-300 ${isMenuOpen ? 'rotate-180' : ''}`} style={{ color: accentColor }} />
                </button>

                {isMenuOpen && (
                    <div id="anote-user-menu" role="menu" className="user-menu-panel absolute top-full right-0 mt-2 w-52 bg-white/95 border border-orange-200 rounded-2xl shadow-2xl shadow-orange-200/50 overflow-hidden backdrop-blur-xl z-50">
                        <MenuAction icon={User} label={text.shell.profile} onClick={() => navigateFromMenu(navigateToProfile)} />
                        <MenuAction icon={Shield} label={text.shell.roles} onClick={() => navigateFromMenu(navigateToRoles)} />
                        <MenuAction icon={Users} label={text.shell.friends} onClick={() => navigateFromMenu(navigateToFriends)} />
                        <MenuAction icon={Clock3} label={text.shell.programs} onClick={() => navigateFromMenu(navigateToPrograms)} />
                        {user.isAdmin && <MenuAction icon={Settings} label={text.shell.administration} onClick={() => navigateFromMenu(navigateToAdmin)} />}
                        <MenuAction icon={LogOut} label={text.shell.signOut} destructive onClick={() => navigateFromMenu(() => { void logout(); })} />
                    </div>
                )}
            </div>

            <main className="relative z-10 py-10">
                <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-8">
                    <div className="console-banner board-panel rounded-2xl px-6 py-6 min-h-[130px] flex flex-col justify-between">
                        <div className="h-5 overflow-hidden">
                            <div className="text-[11px] font-mono tracking-[0.4em] text-orange-500/80 uppercase truncate font-medium" title={consoleTitle}>{consoleTitle}</div>
                        </div>
                        <div className="h-12 flex items-center overflow-hidden">
                            <div className="text-3xl sm:text-4xl text-stone-800 tracking-[0.15em] truncate max-w-full font-light" title={appTitle}>{appTitle}</div>
                        </div>
                        <div className="min-h-[32px] max-h-[40px] overflow-hidden">
                            <div className="text-sm text-stone-500 leading-5 line-clamp-2" title={appSubtitle}>{appSubtitle}</div>
                        </div>
                        <div className="h-[2px] mt-3 bg-gradient-to-r from-transparent via-orange-400 to-transparent opacity-70 rounded-full" />
                    </div>
                </div>

                <Suspense fallback={<RouteLoading />}>
                    {currentView === 'profile' ? <ProfilePanel />
                        : currentView === 'roles' ? <RolesPanel />
                            : currentView === 'programs' ? <ProgramsPanel />
                                : currentView === 'friends' ? <SocialPanel />
                                    : currentView === 'admin' ? <AdminPanel />
                                        : currentView === 'postponed' ? <PostponedEventsView />
                                            : currentView === 'day-administration' ? <DayEventsAdministrationPage />
                                                : (
                                                    <>
                                                        {socialError && (
                                                            <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-4">
                                                                <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-lg" role="alert">{socialError}</div>
                                                            </div>
                                                        )}
                                                        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-6">
                                                            {viewMode === 'friend' ? (
                                                                <div className="flex flex-col gap-2">
                                                                    <div className="flex items-center justify-between flex-wrap gap-4">
                                                                        <div className="text-2xl sm:text-3xl text-stone-800 tracking-[0.15em] flex items-center gap-3">
                                                                            <Eye className="w-6 h-6 text-orange-500" aria-hidden="true" />
                                                                            {viewingUsername || text.shell.friendFallback}
                                                                            <span className="text-xs text-stone-400 font-mono tracking-normal">{text.common.readOnly}</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-3">
                                                                            <button type="button" onClick={navigateToFriends} className="px-4 py-2.5 bg-white/80 border border-orange-200 hover:bg-orange-50 hover:border-orange-400 transition-all rounded-xl shadow-sm">{text.shell.backToFriends}</button>
                                                                            <button type="button" onClick={() => { void viewOwnCalendar(); }} className="flex items-center gap-2 px-5 py-2.5 bg-white/80 border border-orange-200 hover:bg-orange-50 hover:border-orange-400 transition-all rounded-xl shadow-sm">
                                                                                {text.shell.backToCalendar}
                                                                                <LogOut className="w-4 h-4 rotate-180" aria-hidden="true" />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-xs text-stone-500 uppercase tracking-widest">
                                                                        {interpolateText(text.shell.viewingFriend, { name: viewingUsername || text.shell.friendFallback })}
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="text-xs text-orange-600 uppercase tracking-[0.3em] font-medium">{text.shell.viewingOwn}</div>
                                                            )}
                                                        </div>
                                                        <CalendarView />
                                                    </>
                                                )}
                </Suspense>
            </main>
        </div>
    );
}

type MenuActionProps = {
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    label: string;
    onClick: () => void;
    destructive?: boolean;
};

const MenuAction = ({ icon: Icon, label, onClick, destructive = false }: MenuActionProps) => (
    <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className={`menu-item w-full text-left px-4 py-3 text-sm font-medium flex items-center gap-3 transition-all border-t border-orange-100 first:border-t-0 ${destructive ? 'text-red-600 hover:bg-red-50 hover:text-red-700' : 'text-stone-700 hover:bg-orange-50 hover:text-orange-700'}`}
    >
        <Icon className="w-4 h-4" aria-hidden={true} />
        {label}
    </button>
);

export default App;
