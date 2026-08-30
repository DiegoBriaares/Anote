import React, { useState, useEffect, useCallback } from 'react';
import { useCalendarStore, type AppConfig } from '../../store/calendarStore';
import { Save, RotateCcw, ArrowLeft, Check, AlertTriangle, Eye, Sparkles, Trash2, Calendar, Settings, User as UserIcon, Users, CheckSquare, Square, Tags } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from '../../i18n/languageContext';
import { interpolateText } from '../../i18n/appText';
import { ConfirmDialog } from '../Common/ConfirmDialog';

// Character limits
const LIMITS = {
    app_title: 40,
    console_title: 30,
    app_subtitle: 150
} as const;

type ToastState = {
    visible: boolean;
    type: 'success' | 'error';
    message: string;
};

type AdminTab = 'config' | 'events' | 'users' | 'database';
type AdminTable = 'roles' | 'event_notes';
type DeleteCandidate =
    | { kind: 'bulk'; count: number; itemType: 'events' | 'users' }
    | { kind: 'event'; id: string; label: string }
    | { kind: 'user'; id: string; label: string };

const isDatabaseRow = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const AdminPanel: React.FC = () => {
    const { text } = useTranslation();
    const {
        appConfig, updateAppConfig, fetchAppConfig, navigateToCalendar,
        adminEvents, fetchAdminEvents, adminDeleteEvents,
        adminUsers, fetchAdminUsers, adminDeleteUsers,
        fetchTableData
    } = useCalendarStore();

    const [activeTab, setActiveTab] = useState<AdminTab>('config');

    // Config State
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Filter Logic
    const [filterUserId, setFilterUserId] = useState<string>('');

    // Database Tab State
    const [dbTable, setDbTable] = useState<AdminTable>('roles');
    const [dbData, setDbData] = useState<Record<string, unknown>[]>([]);

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate | null>(null);

    const [toast, setToast] = useState<ToastState>({ visible: false, type: 'success', message: '' });

    // Initial Load
    useEffect(() => {
        fetchAppConfig();
    }, [fetchAppConfig]);

    // Data Fetching when tabs change
    useEffect(() => {
        if (activeTab === 'events') {
            fetchAdminEvents(filterUserId || undefined);
            // Ensure we have users for the dropdown
            if (adminUsers.length === 0) {
                fetchAdminUsers();
            }
        } else if (activeTab === 'users') {
            fetchAdminUsers();
        } else if (activeTab === 'database') {
            fetchTableData(dbTable).then((rows) => setDbData(rows.filter(isDatabaseRow)));
        }
    }, [activeTab, adminUsers.length, fetchAdminEvents, fetchAdminUsers, fetchTableData, dbTable, filterUserId]);

    // Toast Logic
    useEffect(() => {
        if (toast.visible) {
            const timer = setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast.visible]);

    const showToast = useCallback((type: 'success' | 'error', message: string) => {
        setToast({ visible: true, type, message });
    }, []);

    // --- Helper UI functions ---
    const getCharacterCountColor = (current: number, max: number) => {
        const ratio = current / max;
        if (ratio >= 1) return 'text-red-500';
        if (ratio >= 0.85) return 'text-amber-600';
        return 'text-stone-400';
    };

    const isOverLimit = (key: string) => {
        const effectiveConfig = config ?? appConfig;
        if (!effectiveConfig) return false;
        const limit = LIMITS[key as keyof typeof LIMITS];
        const value = typeof effectiveConfig[key] === 'string' ? effectiveConfig[key] : '';
        return limit && value.length >= limit;
    };

    // --- Actions ---
    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            if (activeTab === 'events') {
                setSelectedIds(new Set(adminEvents.map(e => e.id)));
            } else if (activeTab === 'users') {
                setSelectedIds(new Set(adminUsers.map(u => u.id)));
            }
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectOne = (id: string, checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) next.add(id);
        else next.delete(id);
        setSelectedIds(next);
    };

    const requestBulkDelete = () => {
        if (selectedIds.size === 0) return;
        setDeleteCandidate({ kind: 'bulk', count: selectedIds.size, itemType: activeTab === 'events' ? 'events' : 'users' });
    };

    const handleDelete = async () => {
        if (!deleteCandidate) return;

        setIsDeleting(true);
        const ids = deleteCandidate.kind === 'bulk' ? Array.from(selectedIds) : [deleteCandidate.id];
        let success = false;
        const itemType = deleteCandidate.kind === 'bulk'
            ? deleteCandidate.itemType
            : deleteCandidate.kind === 'event' ? 'events' : 'users';
        if (itemType === 'events') {
            success = await adminDeleteEvents(ids);
        } else {
            success = await adminDeleteUsers(ids);
        }
        setIsDeleting(false);
        setDeleteCandidate(null);

        if (success) {
            setSelectedIds(new Set());
            showToast('success', interpolateText(text.admin.bulkDeleteSuccess, { count: ids.length, items: itemType === 'events' ? text.admin.eventsLower : text.admin.usersLower }));
            if (activeTab === 'events') fetchAdminEvents(filterUserId || undefined);
            if (activeTab === 'users') fetchAdminUsers();
        } else {
            showToast('error', interpolateText(text.admin.bulkDeleteFailed, { items: itemType === 'events' ? text.admin.eventsLower : text.admin.usersLower }));
        }
    };

    const handleChange = (key: string, value: string) => {
        const effectiveConfig = config ?? appConfig;
        if (effectiveConfig) {
            const limit = LIMITS[key as keyof typeof LIMITS];
            const trimmedValue = limit ? value.slice(0, limit) : value;
            setConfig({ ...effectiveConfig, [key]: trimmedValue });
        }
    };

    const handleSave = async () => {
        const effectiveConfig = config ?? appConfig;
        if (!effectiveConfig || !effectiveConfig.app_title?.trim()) {
            showToast('error', text.admin.applicationTitleRequired);
            return;
        }
        setIsSaving(true);
        const success = await updateAppConfig(effectiveConfig);
        setIsSaving(false);
        if (success) {
            setConfig(null);
            showToast('success', text.admin.configurationSaved);
        } else {
            showToast('error', text.admin.configurationSaveFailed);
        }
    };

    const handleReset = () => {
        setConfig(null);
        showToast('success', text.admin.configurationReset);
    };

    // Render Logic
    const effectiveConfig = config ?? appConfig;
    if (!effectiveConfig && activeTab === 'config') {
        return (
            <div className="min-h-[80vh] flex items-center justify-center">
                <div className="flex items-center gap-3 text-orange-600">
                    <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                    <span className="font-mono text-sm tracking-wider text-stone-600">{text.common.loading}</span>
                </div>
            </div>
        );
    }

    const appTitle = effectiveConfig?.app_title || '';
    const consoleTitle = effectiveConfig?.console_title || '';
    const appSubtitle = effectiveConfig?.app_subtitle || '';

    return (
        <div className="min-h-[calc(100vh-200px)] w-full max-w-[1600px] mx-auto px-4 sm:px-8 pb-32">
            {/* Toast */}
            <div role="status" aria-live="polite" className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ${toast.visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'}`}>
                <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl backdrop-blur-xl border ${toast.type === 'success' ? 'bg-gradient-to-r from-emerald-100 to-green-100 border-emerald-300 text-emerald-800' : 'bg-gradient-to-r from-red-100 to-orange-100 border-red-300 text-red-800'}`}>
                    {toast.type === 'success' ? <Check className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    <span className="font-mono text-sm font-medium">{toast.message}</span>
                </div>
            </div>

            {/* Header */}
            <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
                <button type="button" onClick={navigateToCalendar} className="flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700 transition-all duration-300 group">
                    <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" aria-hidden="true" />
                    <span className="tracking-wider">{text.common.backToCalendar}</span>
                </button>

                <div className="flex items-center gap-2 bg-white/50 backdrop-blur-sm p-1 rounded-xl border border-orange-100">
                    {([
                        { id: 'config', label: text.admin.configuration, icon: Settings },
                        { id: 'events', label: text.common.events, icon: Calendar },
                        { id: 'users', label: text.common.users, icon: Users },
                        { id: 'database', label: text.admin.rawData, icon: Tags }
                    ] satisfies { id: AdminTab; label: string; icon: typeof Settings }[]).map((tab) => (
                        <button
                            type="button"
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id);
                                setSelectedIds(new Set());
                            }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${activeTab === tab.id
                                ? 'bg-white text-orange-600 shadow-sm border border-orange-100'
                                : 'text-stone-500 hover:text-stone-700'}`}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* DATABASE TAB */}
            {activeTab === 'database' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between bg-white/80 backdrop-blur-xl p-6 rounded-2xl border border-orange-200 shadow-lg shadow-orange-100/50">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-200">
                                <Tags className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-xl font-light text-stone-800 tracking-wide">{text.admin.rawData}</h2>
                                <p className="text-stone-500 text-xs">{text.admin.rawDataDescription}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <select
                                value={dbTable}
                                aria-label={text.admin.rawData}
                                onChange={(e) => setDbTable(e.target.value as AdminTable)}
                                className="bg-white border text-stone-700 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5 outline-none px-4"
                            >
                                <option value="roles">{text.admin.rolesTable}</option>
                                <option value="event_notes">{text.admin.notesTable}</option>
                            </select>
                            <div className="text-xs font-mono text-stone-400">
                                {dbData.length} {text.admin.records}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-orange-200 shadow-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm text-stone-600">
                                <thead className="bg-orange-50/50 text-xs uppercase text-orange-600 font-mono tracking-wider">
                                    <tr>
                                        {dbData.length > 0 && Object.keys(dbData[0]).map(key => (
                                            <th key={key} className="px-6 py-4 font-semibold">{key}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-orange-100">
                                    {dbData.map((row, i) => (
                                        <tr key={i} className="hover:bg-orange-50/30 transition-colors">
                                            {Object.values(row).map((val, j) => (
                                                <td key={j} className="px-6 py-4 font-mono text-xs truncate max-w-[200px]" title={String(val)}>
                                                    {String(val)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {dbData.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="px-6 py-12 text-center text-stone-400 italic">
                                                {interpolateText(text.admin.noTableData, { table: dbTable === 'roles' ? text.admin.rolesTable : text.admin.notesTable })}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* CONFIG TAB */}
            {activeTab === 'config' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
                    {/* Config Form */}
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-orange-300/30 via-amber-200/30 to-orange-300/30 rounded-2xl blur-xl opacity-60 group-hover:opacity-80 transition-opacity duration-500" />
                        <div className="relative border border-orange-200 bg-white/90 backdrop-blur-xl p-6 sm:p-8 rounded-2xl overflow-hidden shadow-xl shadow-orange-100/50">
                            <div className="flex items-center gap-4 mb-8 relative z-10">
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-300/50">
                                    <Sparkles className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <div className="text-[10px] font-mono text-orange-500 tracking-[0.4em] mb-1">{text.admin.eyebrow}</div>
                                    <h2 className="text-2xl text-stone-800 tracking-wider font-light">{text.admin.title}</h2>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-5 relative z-10">
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="admin-app-title" className="text-xs font-mono text-orange-600 uppercase tracking-wider">{text.admin.applicationTitle}</label>
                                        <span className={`text-xs font-mono tabular-nums ${getCharacterCountColor(appTitle.length, LIMITS.app_title)}`}>{appTitle.length}/{LIMITS.app_title}</span>
                                    </div>
                                    <input id="admin-app-title" type="text" value={appTitle} onChange={(e) => handleChange('app_title', e.target.value)} maxLength={LIMITS.app_title} className={`bg-white border-2 text-stone-800 px-4 py-3 rounded-xl focus:outline-none font-mono transition-all duration-300 ${isOverLimit('app_title') ? 'border-orange-400' : 'border-orange-200 focus:border-orange-400'}`} />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="admin-console-title" className="text-xs font-mono text-orange-600 uppercase tracking-wider">{text.admin.consoleTitle}</label>
                                        <span className={`text-xs font-mono tabular-nums ${getCharacterCountColor(consoleTitle.length, LIMITS.console_title)}`}>{consoleTitle.length}/{LIMITS.console_title}</span>
                                    </div>
                                    <input id="admin-console-title" type="text" value={consoleTitle} onChange={(e) => handleChange('console_title', e.target.value)} maxLength={LIMITS.console_title} className={`bg-white border-2 text-stone-800 px-4 py-3 rounded-xl focus:outline-none font-mono transition-all duration-300 ${isOverLimit('console_title') ? 'border-orange-400' : 'border-orange-200 focus:border-orange-400'}`} />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="admin-subtitle" className="text-xs font-mono text-orange-600 uppercase tracking-wider">{text.admin.subtitle}</label>
                                        <span className={`text-xs font-mono tabular-nums ${getCharacterCountColor(appSubtitle.length, LIMITS.app_subtitle)}`}>{appSubtitle.length}/{LIMITS.app_subtitle}</span>
                                    </div>
                                    <textarea id="admin-subtitle" value={appSubtitle} onChange={(e) => handleChange('app_subtitle', e.target.value)} maxLength={LIMITS.app_subtitle} className={`bg-white border-2 text-stone-800 px-4 py-3 rounded-xl focus:outline-none font-mono h-28 resize-none transition-all duration-300 ${isOverLimit('app_subtitle') ? 'border-orange-400' : 'border-orange-200 focus:border-orange-400'}`} />
                                </div>
                                <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-orange-200">
                                    <button type="button" onClick={() => { void handleSave(); }} disabled={isSaving || !config} className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-medium text-sm rounded-xl hover:from-orange-600 hover:to-amber-600 transition-all duration-300 disabled:opacity-50">
                                        <Save className="w-4 h-4" aria-hidden="true" /> {isSaving ? text.common.saving : text.common.saveChanges}
                                    </button>
                                    <button type="button" onClick={handleReset} disabled={isSaving || !config} className="flex items-center gap-2 px-6 py-3 bg-white border border-orange-300 text-stone-600 font-medium text-sm rounded-xl hover:bg-orange-50 transition-all duration-300 disabled:opacity-50">
                                        <RotateCcw className="w-4 h-4" aria-hidden="true" /> {text.common.reset}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Live Preview */}
                    <div className="relative group">
                        <div className="relative border border-amber-200 bg-white/90 backdrop-blur-xl p-6 sm:p-8 rounded-2xl overflow-hidden h-full shadow-xl shadow-amber-100/50">
                            <div className="flex items-center justify-between mb-6 relative z-10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-300/50"><Eye className="w-5 h-5 text-white" /></div>
                                    <div><div className="text-[10px] font-mono text-amber-600 tracking-[0.4em]">{text.admin.live}</div><h2 className="text-lg text-stone-800 tracking-wider font-light">{text.admin.livePreview}</h2></div>
                                </div>
                            </div>
                            <div className="relative z-10 space-y-6">
                                <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 backdrop-blur-md px-6 py-5 rounded-xl min-h-[140px] flex flex-col justify-between shadow-lg">
                                    <div className="h-5 overflow-hidden"><div className="text-[10px] font-mono tracking-[0.35em] text-orange-500 uppercase truncate font-medium">{consoleTitle || text.admin.consoleTitle}</div></div>
                                    <div className="h-12 flex items-center overflow-hidden"><div className="text-2xl sm:text-3xl text-stone-800 tracking-[0.15em] truncate max-w-full font-light">{appTitle || text.admin.applicationTitle}</div></div>
                                    <div className="min-h-[36px] max-h-[44px] overflow-hidden"><div className="text-sm text-stone-500 leading-[18px] line-clamp-2">{appSubtitle || text.admin.subtitlePreview}</div></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* EVENTS TAB */}
            {activeTab === 'events' && (
                <div className="relative bg-white/90 backdrop-blur-xl border border-orange-200 rounded-2xl overflow-hidden shadow-xl shadow-orange-100/50 min-h-[500px]">
                    <div className="p-6 border-b border-orange-100 flex items-center justify-between bg-orange-50/30">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center shadow-md shadow-orange-200">
                                <Calendar className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-medium text-stone-800">{text.admin.eventManagement}</h2>
                                <p className="text-xs text-stone-500 font-mono">{text.admin.eventManagementDescription}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <select
                                value={filterUserId}
                                onChange={(e) => setFilterUserId(e.target.value)}
                                className="bg-white border border-orange-200 text-stone-600 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block w-full p-2.5"
                            >
                                <option value="">{text.admin.allUsers}</option>
                                {adminUsers.map(user => (
                                    <option key={user.id} value={user.id}>
                                        {user.username} {user.isAdmin ? `(${text.admin.administrator})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-stone-600">
                            <thead className="bg-orange-50/50 text-xs uppercase font-mono text-stone-500 tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 font-medium w-16">
                                        <div className="flex items-center justify-center">
                                            <input
                                                type="checkbox"
                                                aria-label={text.admin.selectAllEvents}
                                                checked={adminEvents.length > 0 && selectedIds.size === adminEvents.length}
                                                onChange={(e) => handleSelectAll(e.target.checked)}
                                                className="w-4 h-4 rounded border-stone-300 text-orange-500 focus:ring-orange-200 cursor-pointer"
                                            />
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 font-medium">{text.common.title}</th>
                                    <th className="px-6 py-4 font-medium">{text.common.date}</th>
                                    <th className="px-6 py-4 font-medium">{text.common.time}</th>
                                    <th className="px-6 py-4 font-medium">{text.common.user}</th>
                                    <th className="px-6 py-4 font-medium">{text.common.note}</th>
                                    <th className="px-6 py-4 font-medium">{text.common.link}</th>
                                    <th className="px-6 py-4 font-medium text-right">{text.common.actions}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-orange-100">
                                {adminEvents.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-stone-400 font-mono">{text.admin.noAdminEvents}</td></tr>
                                ) : adminEvents.map((e) => {
                                    const isSelected = selectedIds.has(e.id);
                                    return (
                                        <tr key={e.id} className={`transition-colors hover:bg-orange-50/30 ${isSelected ? 'bg-orange-50/80' : ''}`}>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-center">
                                                    <input type="checkbox" aria-label={interpolateText(text.admin.selectEvent, { name: e.title })} checked={isSelected} onChange={(ev) => handleSelectOne(e.id, ev.target.checked)} className="w-4 h-4 rounded border-stone-300 text-orange-500 focus:ring-orange-200 cursor-pointer" />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 font-medium text-stone-800">{e.title}</td>
                                            <td className="px-6 py-4 font-mono text-xs">{format(new Date(e.date), 'yyyy-MM-dd')}</td>
                                            <td className="px-6 py-4 font-mono text-xs text-stone-500">{e.startTime || '--:--'}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2"><UserIcon className="w-3 h-3 text-orange-400" /><span className="text-xs font-medium">{e.username}</span></div>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-stone-500 truncate max-w-[150px]">{e.note || '-'}</td>
                                            <td className="px-6 py-4 text-xs text-blue-500 truncate max-w-[150px]">{e.link ? <a href={e.link} target="_blank" rel="noreferrer" className="hover:underline">{e.link}</a> : '-'}</td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectOne(e.id, !isSelected)}
                                                        className={`text-xs uppercase font-mono tracking-wider transition-colors ${isSelected ? 'text-orange-600 font-bold' : 'text-stone-400 hover:text-stone-600'}`}
                                                    >
                                                        {isSelected ? text.common.deselect : text.common.select}
                                                    </button>
                                                    <button type="button" onClick={() => showToast('error', text.admin.editUnavailable)} className="text-xs text-stone-400 hover:text-orange-600 transition-colors uppercase font-mono tracking-wider">
                                                        {text.common.edit}
                                                    </button>
                                                    <button type="button" onClick={() => setDeleteCandidate({ kind: 'event', id: e.id, label: e.title })} className="text-xs text-stone-400 hover:text-red-500 transition-colors uppercase font-mono tracking-wider">
                                                        {text.common.delete}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* USERS TAB */}
            {activeTab === 'users' && (
                <div className="relative bg-white/90 backdrop-blur-xl border border-orange-200 rounded-2xl overflow-hidden shadow-xl shadow-orange-100/50 min-h-[500px]">
                    <div className="p-6 border-b border-orange-100 flex items-center justify-between bg-orange-50/30">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center shadow-md shadow-orange-200">
                                <Users className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-medium text-stone-800">{text.admin.userManagement}</h2>
                                <p className="text-xs text-stone-500 font-mono">{text.admin.userManagementDescription}</p>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-stone-600">
                            <thead className="bg-orange-50/50 text-xs uppercase font-mono text-stone-500 tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 font-medium w-16">
                                        <div className="flex items-center justify-center">
                                            <input
                                                type="checkbox"
                                                aria-label={text.admin.selectAllUsers}
                                                checked={adminUsers.length > 0 && selectedIds.size === adminUsers.length}
                                                onChange={(e) => handleSelectAll(e.target.checked)}
                                                className="w-4 h-4 rounded border-stone-300 text-orange-500 focus:ring-orange-200 cursor-pointer"
                                            />
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 font-medium">{text.common.user}</th>
                                    <th className="px-6 py-4 font-medium">{text.common.role}</th>
                                    <th className="px-6 py-4 font-medium text-center">{text.common.events}</th>
                                    <th className="px-6 py-4 font-medium text-right">{text.common.actions}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-orange-100">
                                {adminUsers.length === 0 ? (
                                    <tr><td colSpan={5} className="px-6 py-12 text-center text-stone-400 font-mono">{text.admin.noAdminUsers}</td></tr>
                                ) : adminUsers.map((u) => {
                                    const isSelected = selectedIds.has(u.id);
                                    return (
                                        <tr key={u.id} className={`transition-colors hover:bg-orange-50/30 ${isSelected ? 'bg-orange-50/80' : ''}`}>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-center">
                                                    <input type="checkbox" aria-label={interpolateText(text.admin.selectUser, { name: u.username })} checked={isSelected} onChange={(ev) => handleSelectOne(u.id, ev.target.checked)} className="w-4 h-4 rounded border-stone-300 text-orange-500 focus:ring-orange-200 cursor-pointer" />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                                                        {u.username[0].toUpperCase()}
                                                    </div>
                                                    <div className="font-medium text-stone-800">{u.username}</div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded text-xs font-medium ${u.isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-stone-100 text-stone-600'}`}>
                                                    {u.isAdmin ? text.admin.administrator : text.admin.standardUser}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="font-mono text-xs">{interpolateText(text.admin.eventCount, { count: u.eventCount || 0 })}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button type="button" onClick={() => handleSelectOne(u.id, !isSelected)} aria-label={interpolateText(text.admin.selectUser, { name: u.username })} className={`p-1.5 rounded-lg transition-colors border ${isSelected ? 'bg-orange-100 text-orange-600 border-orange-200' : 'text-stone-400 hover:text-orange-600 border-transparent hover:bg-orange-50'}`} title={isSelected ? text.common.deselect : text.common.select}>
                                                        {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                                    </button>
                                                    <button type="button" onClick={() => setDeleteCandidate({ kind: 'user', id: u.id, label: u.username })} disabled={u.isAdmin} aria-label={interpolateText(text.admin.deleteUser, { name: u.username })} className={`p-1.5 text-stone-400 hover:text-red-500 transition-colors ${u.isAdmin ? 'opacity-20 cursor-not-allowed' : ''}`} title={text.common.delete}>
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Persistent Bulk Action Bar */}
            <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 px-6 py-4 bg-white/90 backdrop-blur-xl border border-stone-200 rounded-2xl shadow-2xl transition-all duration-500 z-40 ${selectedIds.size > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20 pointer-events-none'}`}>
                <div className="flex items-center gap-3 pr-4 border-r border-stone-200">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 font-bold font-mono">
                        {selectedIds.size}
                    </div>
                    <span className="text-sm font-medium text-stone-600">{text.common.selected}</span>
                </div>
                <button
                    type="button"
                    onClick={requestBulkDelete}
                    disabled={isDeleting}
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-colors shadow-lg shadow-red-200"
                >
                    {isDeleting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    <span>{isDeleting ? text.common.deleting : text.admin.deleteSelection}</span>
                </button>
            </div>
            <ConfirmDialog
                open={Boolean(deleteCandidate)}
                title={deleteCandidate?.kind === 'event'
                    ? text.admin.deleteEventTitle
                    : deleteCandidate?.kind === 'user'
                        ? text.admin.deleteUserTitle
                        : interpolateText(text.admin.bulkDeleteTitle, { items: deleteCandidate?.kind === 'bulk' && deleteCandidate.itemType === 'users' ? text.admin.usersLower : text.admin.eventsLower })}
                description={deleteCandidate?.kind === 'event'
                    ? interpolateText(text.admin.deleteEventDescription, { name: deleteCandidate.label })
                    : deleteCandidate?.kind === 'user'
                        ? interpolateText(text.admin.deleteUserDescription, { name: deleteCandidate.label })
                        : deleteCandidate?.kind === 'bulk'
                            ? interpolateText(text.admin.bulkDeleteDescription, { count: deleteCandidate.count, items: deleteCandidate.itemType === 'users' ? text.admin.usersLower : text.admin.eventsLower })
                            : undefined}
                confirmLabel={text.common.delete}
                cancelLabel={text.common.cancel}
                onConfirm={() => { void handleDelete(); }}
                onCancel={() => setDeleteCandidate(null)}
                interactionId="admin-confirm-delete"
            />
        </div>
    );
};
