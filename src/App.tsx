import { useState, useEffect, useRef } from 'react';
import { CalendarView } from './components/Calendar/CalendarView';
import { Login } from './components/Auth/Login';
import { useCalendarStore, type UserPreferences } from './store/calendarStore';
import { resolveOwnPreferences } from './utils/preferences';
import { Clock3, LogOut, Eye, User, Users, ChevronDown, Settings, Shield } from 'lucide-react';
import { SocialPanel } from './components/Friends/SocialPanel';
import { ProfilePanel } from './components/Profile/ProfilePanel';
import { AdminPanel } from './components/Admin/AdminPanel';
import { RolesPanel } from './components/Roles/RolesPanel';
import { ProgramsPanel } from './components/Programs/ProgramsPanel';
import { PostponedEventsView } from './components/Calendar/PostponedEventsView';
import { DayEventsAdministrationPage } from './components/Calendar/DayEventsAdministrationPage';

function App() {
  const { user, logout, viewMode, viewingUsername, profile, viewingPreferences, localPreferences, currentView, navigateToProfile, navigateToFriends, navigateToRoles, navigateToPrograms, viewOwnCalendar, navigateToAdmin, appConfig, socialError, bootstrap, fetchAppConfig, checkAutomaticPrograms } = useCalendarStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAppConfig();

    // Auto-refresh config when window gains focus (for multi-tab/multi-user sync)
    // But NOT when on admin panel (to avoid overwriting edits)
    const handleFocus = () => {
      if (currentView !== 'admin') {
        fetchAppConfig();
      }
    };
    window.addEventListener('focus', handleFocus);

    // Periodic refresh every 3 seconds for real-time admin config sync
    // Paused when on admin panel to prevent overwriting user's edits
    const interval = setInterval(() => {
      if (currentView !== 'admin') {
        fetchAppConfig();
      }
    }, 3000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, [fetchAppConfig, currentView]);

  useEffect(() => {
    if (user) {
      bootstrap();
    }
  }, [bootstrap, user]);

  useEffect(() => {
    if (!user) return;

    checkAutomaticPrograms();
    const interval = setInterval(() => {
      checkAutomaticPrograms();
    }, 30_000);

    return () => clearInterval(interval);
  }, [checkAutomaticPrograms, user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  let storedPrefs: UserPreferences | null = null;
  try {
    storedPrefs = JSON.parse(localStorage.getItem('preferences') || 'null');
  } catch {
    storedPrefs = null;
  }
  const userPrefs = resolveOwnPreferences(profile?.preferences, storedPrefs, localPreferences);
  const friendPrefs = viewMode === 'friend' ? viewingPreferences || {} : {};

  // Never let friend views override user theme/accent
  const theme = userPrefs.theme === 'dark' ? 'dark' : 'light';
  const accentColor = userPrefs.accentColor || '#f97316';

  // Background/noise can borrow friend prefs if viewing a friend
  const bgUrl = friendPrefs.backgroundUrl || userPrefs.backgroundUrl;
  useEffect(() => {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark');
    body.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light');
    body.style.setProperty('--accent', accentColor);
    body.style.setProperty('--accent-orange', accentColor);
    return () => {
      // leave theme class as-is on unmount
    };
  }, [theme, accentColor]);

  if (!user) {
    return <Login />;
  }

  const bgStyle = bgUrl
    ? { backgroundImage: `url("${bgUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};

  const appTitle = appConfig?.app_title || 'Anote';
  const appSubtitle = appConfig?.app_subtitle || 'Mark progress, move plans, and keep your calendar notes in one place.';
  const consoleTitle = appConfig?.console_title || 'Anote Console';

  const glowNorthwest = theme === 'dark'
    ? 'bg-gradient-to-br from-sky-500/20 to-indigo-500/10'
    : 'bg-gradient-to-br from-orange-400/30 to-amber-300/20';
  const glowSoutheast = theme === 'dark'
    ? 'bg-gradient-to-tl from-indigo-500/18 to-emerald-400/10'
    : 'bg-gradient-to-tl from-amber-200/40 to-orange-300/20';
  const glowCenter = theme === 'dark'
    ? 'bg-gradient-radial from-sky-400/18 to-transparent'
    : 'bg-gradient-radial from-orange-100/30 to-transparent';

  return (
    <div
      className={`min-h-screen ${theme === 'dark' ? 'text-slate-100' : 'text-stone-800'} selection:bg-orange-500/30 relative transition-all duration-1000`}
      style={{
        ...bgStyle,
        ['--accent' as string]: accentColor
      }}
    >
      {/* Overlay for readability if bg image exists */}
      {bgUrl && (
        <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-slate-950/70' : 'bg-white/80'} pointer-events-none`} />
      )}

      {/* Warm ambient glows */}
      <div className={`pointer-events-none fixed -top-20 -left-20 w-96 h-96 ${glowNorthwest} blur-3xl rounded-full`} />
      <div className={`pointer-events-none fixed bottom-0 right-0 w-[500px] h-[500px] ${glowSoutheast} blur-3xl rounded-full`} />
      <div className={`pointer-events-none fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] ${glowCenter} blur-3xl rounded-full`} />

      {/* User Header */}
      <div className="fixed top-4 right-4 z-50" ref={menuRef}>
        <div
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="user-menu-toggle flex items-center gap-2 bg-white/90 backdrop-blur-xl p-2 rounded-full border border-orange-200 pr-4 cursor-pointer hover:bg-orange-50 hover:border-orange-300 transition-all duration-300 select-none shadow-lg shadow-orange-100/50"
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold font-mono shadow-md"
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}CC)` }}
          >
            {user.username[0].toUpperCase()}
          </div>
          <span className="text-sm font-medium tracking-wide" style={{ color: accentColor }}>{user.username}</span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isMenuOpen ? 'rotate-180' : ''}`} style={{ color: accentColor }} />
        </div>

        {isMenuOpen && (
          <div className="user-menu-panel absolute top-full right-0 mt-2 w-52 bg-white/95 border border-orange-200 rounded-2xl shadow-2xl shadow-orange-200/50 overflow-hidden backdrop-blur-xl z-50">
            <button
              onClick={() => { navigateToProfile(); setIsMenuOpen(false); }}
              className="menu-item w-full text-left px-4 py-3 text-sm font-medium text-stone-700 hover:bg-orange-50 hover:text-orange-700 flex items-center gap-3 transition-all"
            >
              <User className="w-4 h-4 text-orange-500" /> Profile
            </button>
            <button
              onClick={() => { navigateToRoles(); setIsMenuOpen(false); }}
              className="menu-item w-full text-left px-4 py-3 text-sm font-medium text-stone-700 hover:bg-orange-50 hover:text-orange-700 flex items-center gap-3 transition-all border-t border-orange-100"
            >
              <Shield className="w-4 h-4 text-orange-500" /> Roles
            </button>
            <button
              onClick={() => { navigateToFriends(); setIsMenuOpen(false); }}
              className="menu-item w-full text-left px-4 py-3 text-sm font-medium text-stone-700 hover:bg-orange-50 hover:text-orange-700 flex items-center gap-3 transition-all border-t border-orange-100"
            >
              <Users className="w-4 h-4 text-orange-500" /> Friends
            </button>
            <button
              onClick={() => { navigateToPrograms(); setIsMenuOpen(false); }}
              className="menu-item w-full text-left px-4 py-3 text-sm font-medium text-stone-700 hover:bg-orange-50 hover:text-orange-700 flex items-center gap-3 transition-all border-t border-orange-100"
            >
              <Clock3 className="w-4 h-4 text-orange-500" /> Programs
            </button>
            {user.isAdmin && (
              <button
                onClick={() => { navigateToAdmin(); setIsMenuOpen(false); }}
                className="menu-item w-full text-left px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-50 hover:text-amber-800 flex items-center gap-3 transition-all border-t border-orange-100"
              >
                <Settings className="w-4 h-4" /> Admin Panel
              </button>
            )}
            <button
              onClick={logout}
              className="menu-item w-full text-left px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center gap-3 transition-all border-t border-orange-100"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        )}
      </div>

      <main className="relative z-10 py-10">
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-8">
          <div className="console-banner board-panel rounded-2xl px-6 py-6 min-h-[130px] flex flex-col justify-between">
            {/* Console Title */}
            <div className="h-5 overflow-hidden">
              <div
                className="text-[11px] font-mono tracking-[0.4em] text-orange-500/80 uppercase truncate font-medium"
                title={consoleTitle}
              >
                {consoleTitle}
              </div>
            </div>

            {/* Main Title */}
            <div className="h-12 flex items-center overflow-hidden">
              <div
                className="text-3xl sm:text-4xl text-stone-800 tracking-[0.15em] truncate max-w-full font-light"
                title={appTitle}
              >
                {appTitle}
              </div>
            </div>

            {/* Subtitle */}
            <div className="min-h-[32px] max-h-[40px] overflow-hidden">
              <div
                className="text-sm text-stone-500 leading-5"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}
                title={appSubtitle}
              >
                {appSubtitle}
              </div>
            </div>

            {/* Accent Line */}
            <div className="h-[2px] mt-3 bg-gradient-to-r from-transparent via-orange-400 to-transparent opacity-70 rounded-full" />
          </div>
        </div>
        {currentView === 'profile' ? (
          <ProfilePanel />
        ) : currentView === 'roles' ? (
          <RolesPanel />
        ) : currentView === 'programs' ? (
          <ProgramsPanel />
        ) : currentView === 'friends' ? (
          <SocialPanel />
        ) : currentView === 'admin' ? (
          <AdminPanel />
        ) : currentView === 'postponed' ? (
          <PostponedEventsView />
        ) : currentView === 'day-administration' ? (
          <DayEventsAdministrationPage />
        ) : (
          <>
            {currentView === 'calendar' && socialError && (
              <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-4">
                <div className="text-xs font-mono text-red-500 bg-red-50 border border-red-200 px-4 py-3 rounded-lg">
                  {socialError}
                </div>
              </div>
            )}
            <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-6">
              {viewMode === 'friend' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="text-2xl sm:text-3xl text-stone-800 tracking-[0.15em] flex items-center gap-3">
                      <Eye className="w-6 h-6 text-orange-500" />
                      {viewingUsername || 'Friend'} <span className="text-xs text-stone-400 font-mono tracking-normal">// READ-ONLY</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={navigateToFriends}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white/80 border border-orange-200 hover:bg-orange-50 hover:border-orange-400 transition-all group rounded-xl shadow-sm"
                      >
                        <span className="text-sm font-medium text-stone-600 group-hover:text-orange-700 uppercase tracking-wider">Back to Friends</span>
                      </button>
                      <button
                        onClick={viewOwnCalendar}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white/80 border border-orange-200 hover:bg-orange-50 hover:border-orange-400 transition-all group rounded-xl shadow-sm"
                      >
                        <span className="text-sm font-medium text-stone-600 group-hover:text-orange-700 uppercase tracking-wider">Back to My Calendar</span>
                        <LogOut className="w-4 h-4 text-stone-400 group-hover:text-orange-500 rotate-180" />
                      </button>
                    </div>
                  </div>
                  <div className="text-xs font-mono text-stone-500 uppercase tracking-widest">
                    You are viewing a read-only version of {viewingUsername || 'friend'}'s calendar.
                  </div>
                </div>
              ) : (
                <div className="text-xs font-mono text-orange-500/80 uppercase tracking-[0.3em] font-medium">
                  ● Viewing: My Calendar
                </div>
              )}
            </div>
            <CalendarView />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
