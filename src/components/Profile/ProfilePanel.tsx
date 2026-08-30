import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Image as ImageIcon, Palette, RefreshCcw } from 'lucide-react';
import { useTranslation } from '../../i18n/languageContext';
import { useCalendarStore, type UserPreferences } from '../../store/calendarStore';

type ProfileDraft = {
    username: string;
    backgroundUrl: string;
    accentColor: string;
    noiseOverlay: boolean;
    theme: 'light' | 'dark';
};

const applyAppearance = (prefs: Partial<UserPreferences>) => {
    const themeClass = prefs.theme === 'dark' ? 'theme-dark' : 'theme-light';
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(themeClass);
    if (prefs.accentColor) {
        document.body.style.setProperty('--accent', prefs.accentColor);
        document.body.style.setProperty('--accent-orange', prefs.accentColor);
    }
};

const ProfileEditor = ({ initial }: { initial: ProfileDraft }) => {
    const { updateProfile, setLocalPreferences, navigateToCalendar } = useCalendarStore();
    const { text } = useTranslation();
    const [draft, setDraft] = useState(initial);
    const [isSaving, setIsSaving] = useState(false);
    const savedRef = useRef(false);
    const isDirty = JSON.stringify(draft) !== JSON.stringify(initial);

    useEffect(() => () => {
        if (!savedRef.current) applyAppearance(initial);
    }, [initial]);

    const updateDraft = <Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) => {
        setDraft((current) => ({ ...current, [key]: value }));
    };

    const handleSave = async () => {
        if (isSaving || !isDirty) return;
        setIsSaving(true);
        const nextPreferences: UserPreferences = {
            backgroundUrl: draft.backgroundUrl || undefined,
            accentColor: draft.accentColor,
            noiseOverlay: draft.noiseOverlay,
            theme: draft.theme
        };
        const saved = await updateProfile({ ...nextPreferences, username: draft.username });
        if (!saved) {
            setIsSaving(false);
            return;
        }
        setLocalPreferences({ ...nextPreferences, _updatedAt: Date.now() });
        applyAppearance(nextPreferences);
        savedRef.current = true;
        setIsSaving(false);
        navigateToCalendar();
    };

    return (
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 mb-8">
            <button type="button" onClick={navigateToCalendar} className="mb-6 flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {text.common.backToCalendar}
            </button>

            <div className="border border-orange-200 bg-white/80 backdrop-blur-xl p-6 relative overflow-hidden rounded-2xl shadow-xl shadow-orange-100/50">
                <div className="absolute top-0 left-0 w-20 h-20 border-r border-b border-orange-200" aria-hidden="true" />
                <div className="absolute bottom-0 right-0 w-20 h-20 border-l border-t border-orange-200" aria-hidden="true" />

                <div className="flex items-start justify-between gap-8 relative z-10 flex-col lg:flex-row">
                    <div className="flex items-center gap-4">
                        <div className="p-3 border-2 border-orange-400 rounded-full bg-gradient-to-br from-orange-50 to-amber-50">
                            <Palette className="w-6 h-6 text-orange-500" aria-hidden="true" />
                        </div>
                        <div>
                            <div className="text-[10px] font-mono text-stone-500 tracking-[0.3em] mb-1">{text.profile.eyebrow}</div>
                            <h2 className="text-2xl text-stone-800 tracking-widest">{text.profile.title}</h2>
                        </div>
                    </div>
                    <p className="text-sm text-stone-500 max-w-xl">{text.profile.description}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                    <div className="col-span-1 md:col-span-3 flex flex-col gap-3">
                        <label htmlFor="profile-username" className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">{text.profile.username}</label>
                        <input id="profile-username" type="text" value={draft.username} onChange={(event) => updateDraft('username', event.target.value)} className="w-full bg-white border-2 border-orange-200 text-sm text-stone-800 px-4 py-3 rounded-xl focus:outline-none focus:border-orange-400 hover:border-orange-300 transition-colors" />
                    </div>

                    <div className="col-span-1 md:col-span-2 flex flex-col gap-3">
                        <label htmlFor="profile-background" className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">{text.profile.backgroundImageUrl}</label>
                        <div className="flex gap-2">
                            <div className="p-3 border-2 border-orange-200 bg-orange-50 flex items-center justify-center rounded-xl" aria-hidden="true">
                                <ImageIcon className="w-5 h-5 text-orange-500" />
                            </div>
                            <input id="profile-background" type="url" value={draft.backgroundUrl} onChange={(event) => updateDraft('backgroundUrl', event.target.value)} placeholder={text.calendar.backgroundUrlPlaceholder} className="flex-1 bg-white border-2 border-orange-200 text-sm text-stone-800 px-4 py-3 rounded-xl focus:outline-none focus:border-orange-400 hover:border-orange-300 transition-colors placeholder:text-stone-400" />
                        </div>
                        <p className="text-sm text-stone-500">{text.profile.backgroundHelp}</p>
                    </div>

                    <fieldset className="flex flex-col gap-3">
                        <legend className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">{text.profile.accent}</legend>
                        <div className="flex items-center gap-3">
                            <label className="sr-only" htmlFor="profile-accent-picker">{text.profile.accent}</label>
                            <input id="profile-accent-picker" type="color" value={draft.accentColor} onChange={(event) => {
                                updateDraft('accentColor', event.target.value);
                                applyAppearance({ accentColor: event.target.value, theme: draft.theme });
                            }} className="w-12 h-12 border-2 border-orange-200 bg-white cursor-pointer rounded-xl" />
                            <label className="sr-only" htmlFor="profile-accent-text">{text.profile.accentText}</label>
                            <input id="profile-accent-text" type="text" value={draft.accentColor} onChange={(event) => {
                                updateDraft('accentColor', event.target.value);
                                applyAppearance({ accentColor: event.target.value, theme: draft.theme });
                            }} className="flex-1 bg-white border-2 border-orange-200 text-sm text-stone-800 px-4 py-3 rounded-xl focus:outline-none focus:border-orange-400 hover:border-orange-300 transition-colors" />
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
                            <input type="checkbox" checked={draft.noiseOverlay} onChange={(event) => {
                                updateDraft('noiseOverlay', event.target.checked);
                            }} className="accent-orange-500 w-4 h-4 rounded" />
                            {text.profile.noiseOverlay}
                        </label>
                    </fieldset>

                    <div className="flex flex-col gap-3">
                        <label htmlFor="profile-theme" className="text-xs font-mono text-orange-600 tracking-[0.2em] uppercase font-medium">{text.profile.theme}</label>
                        <select id="profile-theme" value={draft.theme} onChange={(event) => {
                            const theme = event.target.value as ProfileDraft['theme'];
                            updateDraft('theme', theme);
                            applyAppearance({ theme, accentColor: draft.accentColor });
                        }} className="w-full bg-white border-2 border-orange-200 text-sm text-stone-800 px-4 py-3 rounded-xl focus:outline-none focus:border-orange-400 hover:border-orange-300 transition-colors">
                            <option value="light">{text.profile.light}</option>
                            <option value="dark">{text.profile.dark}</option>
                        </select>
                        <p className="text-sm text-stone-500">{text.profile.themeHelp}</p>
                    </div>
                </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={() => setDraft(initial)} disabled={!isDirty || isSaving} className="px-5 py-2.5 text-sm font-medium text-stone-600 hover:text-stone-800 border border-stone-300 hover:border-stone-400 transition-all flex items-center gap-2 rounded-xl disabled:opacity-50">
                    <RefreshCcw className="w-4 h-4" aria-hidden="true" /> {text.profile.reset}
                </button>
                <button type="button" onClick={() => { void handleSave(); }} disabled={!isDirty || isSaving} className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-sm font-medium hover:from-orange-600 hover:to-amber-600 transition-all rounded-xl shadow-lg shadow-orange-300/50 disabled:opacity-50">
                    {isSaving ? text.common.saving : text.profile.save}
                </button>
            </div>
        </div>
    );
};

export const ProfilePanel: React.FC = () => {
    const { profile, fetchProfile } = useCalendarStore();
    const cachedPreferences = useMemo<UserPreferences | null>(() => {
        try {
            return JSON.parse(localStorage.getItem('preferences') || 'null') as UserPreferences | null;
        } catch {
            return null;
        }
    }, []);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    const preferences = (profile?.preferences as UserPreferences | undefined) || cachedPreferences || {};
    const initial: ProfileDraft = {
        username: profile?.username || '',
        backgroundUrl: preferences.backgroundUrl || '',
        accentColor: preferences.accentColor || '#d4af37',
        noiseOverlay: preferences.noiseOverlay ?? true,
        theme: preferences.theme === 'dark' ? 'dark' : 'light'
    };
    const editorKey = `${profile?.username || ''}:${JSON.stringify(preferences)}`;

    return <ProfileEditor key={editorKey} initial={initial} />;
};
