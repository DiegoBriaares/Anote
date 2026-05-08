import React, { useState, useEffect, useMemo } from 'react';
import { useCalendarStore, type UserPreferences } from '../../store/calendarStore';
import { Palette, Image as ImageIcon, RefreshCcw, ArrowLeft } from 'lucide-react';
// import { format } from 'date-fns'; // Removed unused import

export const ProfilePanel: React.FC = () => {
    const {
        profile,
        updateProfile,
        fetchProfile,
        setLocalPreferences,
        navigateToCalendar
    } = useCalendarStore();
    const cachedPrefs = useMemo<UserPreferences | null>(() => {
        try {
            return JSON.parse(localStorage.getItem('preferences') || 'null');
        } catch {
            return null;
        }
    }, []);
    const [bgUrl, setBgUrl] = useState('');
    const [username, setUsername] = useState('');
    const [accentColor, setAccentColor] = useState('#d4af37');
    const [noiseOverlay, setNoiseOverlay] = useState(true);
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [isDirty, setIsDirty] = useState(false);

    const applyAppearance = (prefs: Partial<UserPreferences>) => {
        const t = prefs.theme === 'dark' ? 'theme-dark' : 'theme-light';
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(t);
        if (prefs.accentColor) {
            document.body.style.setProperty('--accent', prefs.accentColor);
            document.body.style.setProperty('--accent-orange', prefs.accentColor);
        }
    };

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    useEffect(() => {
        if (isDirty) return;
        const sourcePrefs = (profile?.preferences as UserPreferences | undefined) || cachedPrefs;
        if (sourcePrefs) {
            setBgUrl(sourcePrefs.backgroundUrl || '');
            setAccentColor(sourcePrefs.accentColor || '#d4af37');
            setNoiseOverlay(sourcePrefs.noiseOverlay ?? true);
            setTheme(sourcePrefs.theme === 'dark' ? 'dark' : 'light');
        }
        if (profile?.username) {
            setUsername(profile.username);
        }
    }, [profile, cachedPrefs, isDirty]);

    const handleSave = async () => {
        const nextPreferences = {
            backgroundUrl: bgUrl || undefined,
            accentColor,
            noiseOverlay,
            theme
        };
        await updateProfile({
            ...nextPreferences,
            username
        });
        setLocalPreferences({ ...nextPreferences, _updatedAt: Date.now() });
        applyAppearance({ theme, accentColor });
        setIsDirty(false);
        navigateToCalendar();
    };

    return (
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-8">
            <button
                onClick={navigateToCalendar}
                className="mb-6 flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> BACK TO CALENDAR
            </button>

            <div className="border border-orange-200 bg-white/80 backdrop-blur-xl p-6 relative overflow-hidden rounded-2xl shadow-xl shadow-orange-100/50">
                <div className="absolute top-0 left-0 w-20 h-20 border-r border-b border-orange-200" />
                <div className="absolute bottom-0 right-0 w-20 h-20 border-l border-t border-orange-200" />

                <div className="flex items-start justify-between gap-8 relative z-10 flex-col lg:flex-row">
                    <div className="flex items-center gap-4">
                        <div className="p-3 border-2 border-orange-400 rounded-full bg-gradient-to-br from-orange-50 to-amber-50">
                            <Palette className="w-6 h-6 text-orange-500" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] mb-1">PROFILE CONTROL</div>
                            <h2 className="text-2xl text-stone-800 tracking-widest">VISUAL PREFERENCES</h2>
                        </div>
                    </div>
                    <div className="text-sm text-stone-500 max-w-xl">
                        Configure your calendar shell. Backgrounds and accents apply only to your view. Friend views remain read-only.
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                    <div className="col-span-1 md:col-span-3 flex flex-col gap-3">
                        <label className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => {
                                setUsername(e.target.value);
                                setIsDirty(true);
                            }}
                            className="w-full bg-white border-2 border-orange-200 text-sm text-stone-800 px-4 py-3 rounded-xl focus:outline-none focus:border-orange-400 hover:border-orange-300 transition-colors"
                        />
                    </div>
                    <div className="col-span-1 md:col-span-2 flex flex-col gap-3">
                        <label className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">Background Image URL</label>
                        <div className="flex gap-2">
                            <div className="p-3 border-2 border-orange-200 bg-orange-50 flex items-center justify-center rounded-xl">
                                <ImageIcon className="w-5 h-5 text-orange-500" />
                            </div>
                            <input
                                type="url"
                                value={bgUrl}
                                onChange={(e) => {
                                    setBgUrl(e.target.value);
                                    setIsDirty(true);
                                }}
                                placeholder="https://images.example.com/background.jpg"
                                className="flex-1 bg-white border-2 border-orange-200 text-sm text-stone-800 px-4 py-3 rounded-xl focus:outline-none focus:border-orange-400 hover:border-orange-300 transition-colors placeholder:text-stone-400"
                            />
                        </div>
                        <p className="text-sm text-stone-500">Leave empty for default gradient.</p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <label className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">Accent (avatar & UI)</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={accentColor}
                                onChange={(e) => {
                                    setAccentColor(e.target.value);
                                    setLocalPreferences({ accentColor: e.target.value, _updatedAt: Date.now() });
                                    setIsDirty(true);
                                    applyAppearance({ accentColor: e.target.value, theme });
                                }}
                                className="w-12 h-12 border-2 border-orange-200 bg-white cursor-pointer rounded-xl"
                            />
                            <input
                                type="text"
                                value={accentColor}
                                onChange={(e) => {
                                    setAccentColor(e.target.value);
                                    setLocalPreferences({ accentColor: e.target.value });
                                    setIsDirty(true);
                                }}
                                className="flex-1 bg-white border-2 border-orange-200 text-sm text-stone-800 px-4 py-3 rounded-xl focus:outline-none focus:border-orange-400 hover:border-orange-300 transition-colors"
                            />
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
                            <input
                                type="checkbox"
                                checked={noiseOverlay}
                                onChange={(e) => {
                                    setNoiseOverlay(e.target.checked);
                                    setLocalPreferences({ noiseOverlay: e.target.checked });
                                    setIsDirty(true);
                                }}
                                className="accent-orange-500 w-4 h-4 rounded"
                            />
                            Add noise overlay
                        </label>
                    </div>

                    <div className="flex flex-col gap-3">
                        <label className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">Theme</label>
                        <select
                            value={theme}
                            onChange={(e) => {
                                const choice = e.target.value as 'light' | 'dark';
                                setTheme(choice);
                                setLocalPreferences({ theme: choice });
                                setIsDirty(true);
                                applyAppearance({ theme: choice, accentColor });
                            }}
                            className="w-full bg-white border-2 border-orange-200 text-sm text-stone-800 px-4 py-3 rounded-xl focus:outline-none focus:border-orange-400 hover:border-orange-300 transition-colors"
                        >
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                        </select>
                        <p className="text-sm text-stone-500">
                            Switch between warm daylight and a night-friendly interface. Preference is saved to your profile.
                        </p>
                    </div>

                </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
                <button
                    onClick={() => {
                        setBgUrl(profile?.preferences?.backgroundUrl || '');
                        setAccentColor(profile?.preferences?.accentColor || '#d4af37');
                        setNoiseOverlay(profile?.preferences?.noiseOverlay ?? true);
                        setUsername(profile?.username || '');
                        const storedPrefs = profile?.preferences as UserPreferences | undefined;
                        if (storedPrefs?.theme === 'dark' || storedPrefs?.theme === 'light') {
                            setTheme(storedPrefs.theme);
                            setLocalPreferences({ theme: storedPrefs.theme });
                        } else {
                            setTheme('light');
                            setLocalPreferences({ theme: 'light' });
                        }
                        setIsDirty(false);
                    }}
                    className="px-5 py-2.5 text-sm font-medium text-stone-600 hover:text-stone-800 border border-stone-300 hover:border-stone-400 transition-all flex items-center gap-2 rounded-xl"
                >
                    <RefreshCcw className="w-4 h-4" /> Reset
                </button>
                <button
                    onClick={handleSave}
                    className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-sm font-medium hover:from-orange-600 hover:to-amber-600 transition-all rounded-xl shadow-lg shadow-orange-300/50"
                >
                    Save Preferences
                </button>
            </div>
        </div>
    );
};
