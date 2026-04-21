import React, { useState, useEffect, useRef } from 'react';
import { useCalendarStore, type CalendarEvent, type Role } from '../../store/calendarStore';
import { X, Save, FileText, RotateCcw, Link, Paperclip, Eye, Pencil } from 'lucide-react';
import { formatFullDate } from '../../utils/dateUtils';
import { toApiUrl } from '../../utils/api';
import ReactMarkdown from 'react-markdown';

interface NoteEnvironmentProps {
    isOpen: boolean;
    onClose: () => void;
    event: CalendarEvent;
    role: Role;
}

export const NoteEnvironment: React.FC<NoteEnvironmentProps> = ({ isOpen, onClose, event, role }) => {
    const { eventNotes, fetchEventNotes, saveEventNote, uploadFile } = useCalendarStore();
    const [content, setContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [isPreview, setIsPreview] = useState(false);
    const [selectedFile, setSelectedFile] = useState<{ url: string; name: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Initial load
    useEffect(() => {
        if (isOpen && event.id) {
            fetchEventNotes(event.id);
        }
    }, [isOpen, event.id, fetchEventNotes]);

    // Update local content when store updates (initial fetch)
    useEffect(() => {
        if (eventNotes[event.id] && eventNotes[event.id][role.id]) {
            setContent(eventNotes[event.id][role.id]);
        } else {
            setContent('');
        }
    }, [eventNotes, event.id, role.id]);

    const handleSave = async () => {
        setIsSaving(true);
        const success = await saveEventNote(event.id, role.id, content);
        setIsSaving(false);
        if (success) {
            setLastSaved(new Date());
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const url = await uploadFile(file);
        if (url) {
            const cursor = textareaRef.current?.selectionStart || content.length;
            const textToInsert = file.type.startsWith('image/') ? `\n![${file.name}](${url})\n` : `\n[${file.name}](${url})`;

            const newContent = content.slice(0, cursor) + textToInsert + content.slice(cursor);
            setContent(newContent);

            setTimeout(() => {
                textareaRef.current?.focus();
            }, 100);
        }
    };

    const handleInsertLink = () => {
        const url = prompt('Enter URL:');
        if (!url) return;
        const text = prompt('Enter link text:', 'link') || 'link';

        const cursor = textareaRef.current?.selectionStart || content.length;
        const textToInsert = `[${text}](${url})`;
        const newContent = content.slice(0, cursor) + textToInsert + content.slice(cursor);
        setContent(newContent);
        setTimeout(() => {
            textareaRef.current?.focus();
        }, 100);
    };

    const resolveUrl = (url: string) => {
        return toApiUrl(url);
    };

    const handleDownload = () => {
        if (selectedFile) {
            window.open(selectedFile.url, '_blank');
            setSelectedFile(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] bg-white flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="h-16 border-b border-stone-200 flex items-center justify-between px-6 bg-stone-50/50 backdrop-blur-md">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 -ml-2 hover:bg-stone-200 rounded-full transition-colors text-stone-500">
                        <X className="w-6 h-6" />
                    </button>
                    <div>
                        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-stone-400">
                            <span>{formatFullDate(new Date(event.date))}</span>
                            <span className="w-1 h-1 bg-stone-300 rounded-full" />
                            <span className="text-orange-500 font-bold">{role.label}</span>
                        </div>
                        <h2 className="text-lg font-bold text-stone-800">{event.title}</h2>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {lastSaved && (
                        <span className="text-xs text-stone-400 mr-2 animate-in fade-in">
                            Saved {lastSaved.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </div>

            {/* Main Editor Area */}
            <div className="flex-1 flex overflow-hidden relative">
                {/* Editor / Preview */}
                <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full pb-32">
                    {isPreview ? (
                        <div className="prose prose-stone prose-lg max-w-none">
                            <ReactMarkdown
                                components={{
                                    a: ({ node, ...props }) => {
                                        const href = resolveUrl(props.href as string);
                                        const isFile = href.includes('/uploads/');
                                        const children = props.children;

                                        return (
                                            <a
                                                {...props}
                                                href={href}
                                                onClick={(e) => {
                                                    if (isFile) {
                                                        e.preventDefault();
                                                        setSelectedFile({ url: href, name: String(children) });
                                                    }
                                                }}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-orange-500 hover:text-orange-600 underline decoration-orange-200 underline-offset-4 transition-colors font-medium break-all cursor-pointer"
                                            />
                                        );
                                    },
                                    img: ({ node, ...props }) => {
                                        const src = resolveUrl(props.src as string);
                                        return (
                                            <div className="my-4 rounded-xl overflow-hidden shadow-lg border border-stone-100 bg-stone-50">
                                                <img
                                                    {...props}
                                                    src={src}
                                                    className="max-w-full h-auto max-h-[500px] object-contain mx-auto"
                                                    loading="lazy"
                                                />
                                            </div>
                                        );
                                    },
                                    p: ({ node, ...props }) => <p {...props} className="mb-4 leading-relaxed text-stone-700" />
                                }}
                            >
                                {content}
                            </ReactMarkdown>
                            {content.trim() === '' && (
                                <div className="text-stone-300 italic">No content to preview...</div>
                            )}
                        </div>
                    ) : (
                        <textarea
                            ref={textareaRef}
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={`Write your observations as ${role.label}...`}
                            className="w-full h-full min-h-[50vh] resize-none outline-none text-lg leading-relaxed text-stone-700 placeholder:text-stone-300 font-serif"
                            autoFocus
                        />
                    )}
                </div>

                {/* Sidebar */}
                <div className="w-72 border-l border-stone-200 bg-stone-50 p-4 flex flex-col gap-4 hidden lg:flex">
                    <div className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">Attachments</div>
                    <div
                        onClick={() => !isPreview && fileInputRef.current?.click()}
                        className={`border-2 border-dashed border-stone-200 rounded-xl p-8 flex flex-col items-center justify-center text-stone-400 gap-2 transition-colors group ${isPreview ? 'opacity-50 cursor-not-allowed' : 'hover:border-orange-300 hover:bg-orange-50/10 cursor-pointer'}`}
                    >
                        <FileText className="w-8 h-8 group-hover:text-orange-400 transition-colors" />
                        <span className="text-xs text-center">Drag files here<br />or click to upload</span>
                    </div>

                    <div className="flex-1"></div>

                    <div className="border-t border-stone-200 pt-4">
                        <div className="text-xs text-stone-400 text-center">
                            Markdown supported
                        </div>
                    </div>
                </div>

                {/* Footer Toolbar */}
                <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-stone-200 p-4 px-8 flex items-center justify-between shadow-2xl z-10">
                    <div className="flex items-center gap-2">
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileUpload}
                        />
                        <button
                            onClick={() => setIsPreview(!isPreview)}
                            className={`p-2 rounded-lg transition-colors ${isPreview ? 'bg-orange-100 text-orange-600' : 'hover:bg-stone-100 text-stone-500 hover:text-stone-800'}`}
                            title={isPreview ? "Edit Mode" : "Preview Mode"}
                        >
                            {isPreview ? <Pencil className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                        <div className="w-px h-6 bg-stone-200 mx-2" />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isPreview}
                            className="p-2 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Attach File"
                        >
                            <Paperclip className="w-5 h-5" />
                        </button>
                        <button
                            onClick={handleInsertLink}
                            disabled={isPreview}
                            className="p-2 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Insert Link"
                        >
                            <Link className="w-5 h-5" />
                        </button>
                    </div>

                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-6 py-2.5 bg-stone-900 text-white rounded-xl hover:bg-black transition-all disabled:opacity-50 shadow-lg shadow-stone-200"
                    >
                        {isSaving ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>Save Note</span>
                    </button>
                </div>

                {/* Download Popover */}
                {selectedFile && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 text-center animate-in zoom-in-95 duration-200 border border-stone-100">
                            <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <FileText className="w-6 h-6" />
                            </div>
                            <h3 className="font-bold text-stone-800 mb-1 truncate px-2">{selectedFile.name}</h3>
                            <p className="text-sm text-stone-500 mb-6">Do you want to open this file?</p>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => setSelectedFile(null)}
                                    className="flex-1 px-4 py-2 rounded-xl text-stone-600 hover:bg-stone-100 font-medium transition-colors"
                                >
                                    Close
                                </button>
                                <button
                                    onClick={handleDownload}
                                    className="flex-1 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium shadow-lg shadow-orange-200 transition-all hover:scale-105"
                                >
                                    Open
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
