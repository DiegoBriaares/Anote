import React, { useState, useEffect, useRef } from 'react';
import { useCalendarStore, type CalendarEvent, type Role } from '../../store/calendarStore';
import { X, Save, FileText, RotateCcw, Link, Paperclip, Eye, Pencil, UploadCloud } from 'lucide-react';
import { toApiUrl } from '../../utils/api';
import ReactMarkdown from 'react-markdown';
import { attachmentsApi } from '../../api/attachments';
import { useTranslation } from '../../i18n/languageContext';
import { interpolateText } from '../../i18n/appText';
import { TextInputDialog } from '../Common/TextInputDialog';

interface NoteEnvironmentProps {
    isOpen: boolean;
    onClose: () => void;
    event: CalendarEvent;
    role: Role;
}

type AttachmentKind = 'pdf' | 'image' | 'text' | 'file';

const TextAttachmentPreview = ({ url }: { url: string }) => {
    const { text } = useTranslation();
    const [preview, setPreview] = useState<{ isLoading: boolean; content: string | null; error: boolean }>({ isLoading: true, content: null, error: false });

    useEffect(() => {
        const controller = new AbortController();
        attachmentsApi.readText(url, controller.signal)
            .then((content) => setPreview({ isLoading: false, content, error: false }))
            .catch((error: unknown) => {
                if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
                setPreview({ isLoading: false, content: null, error: true });
            });
        return () => controller.abort();
    }, [url]);

    return (
        <div className="h-full min-h-0 overflow-auto bg-stone-950 p-5">
            {preview.isLoading && <div className="text-sm text-stone-400">{text.notes.loadingText}</div>}
            {preview.error && <div className="text-sm text-red-300">{text.notes.textPreviewFailed}</div>}
            {preview.content !== null && <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-stone-100">{preview.content}</pre>}
        </div>
    );
};

export const NoteEnvironment: React.FC<NoteEnvironmentProps> = ({ isOpen, onClose, event, role }) => {
    const { language, text } = useTranslation();
    const { eventNotes, fetchEventNotes, saveEventNote, uploadFile } = useCalendarStore();
    const noteKey = `${event.id}:${role.id}`;
    const [contentDraft, setContentDraft] = useState<{ key: string; value: string } | null>(null);
    const storedContent = eventNotes[event.id]?.[role.id] || '';
    const content = contentDraft?.key === noteKey ? contentDraft.value : storedContent;
    const setContent = (value: string) => setContentDraft({ key: noteKey, value });
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [isPreview, setIsPreview] = useState(false);
    const [selectedFile, setSelectedFile] = useState<{ url: string; name: string } | null>(null);
    const [linkStep, setLinkStep] = useState<'url' | 'text' | null>(null);
    const [pendingLinkUrl, setPendingLinkUrl] = useState('');
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const contentRef = useRef(content);
    const attachmentCloseRef = useRef<HTMLButtonElement>(null);
    const attachmentDialogRef = useRef<HTMLDivElement>(null);
    const noteDialogRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const selectedFileRef = useRef(selectedFile);
    const linkStepRef = useRef(linkStep);
    onCloseRef.current = onClose;
    selectedFileRef.current = selectedFile;
    linkStepRef.current = linkStep;

    useEffect(() => {
        contentRef.current = content;
    }, [content]);

    useEffect(() => {
        if (!isOpen) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const handleKeyDown = (keyEvent: KeyboardEvent) => {
            if (keyEvent.key === 'Escape' && !linkStepRef.current) {
                if (selectedFileRef.current) {
                    setSelectedFile(null);
                } else {
                    onCloseRef.current();
                }
                return;
            }
            if (keyEvent.key !== 'Tab' || linkStepRef.current) return;
            const activeDialog = selectedFileRef.current ? attachmentDialogRef.current : noteDialogRef.current;
            const controls = activeDialog?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            );
            if (!controls?.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (keyEvent.shiftKey && document.activeElement === first) {
                keyEvent.preventDefault();
                last.focus();
            } else if (!keyEvent.shiftKey && document.activeElement === last) {
                keyEvent.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [isOpen]);

    useEffect(() => {
        if (!selectedFile) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        attachmentCloseRef.current?.focus();
        return () => previouslyFocused?.focus();
    }, [selectedFile]);

    // Initial load
    useEffect(() => {
        if (isOpen && event.id) {
            fetchEventNotes(event.id);
        }
    }, [isOpen, event.id, fetchEventNotes]);

    const handleSave = async () => {
        setIsSaving(true);
        const success = await saveEventNote(event.id, role.id, content);
        setIsSaving(false);
        if (success) {
            setLastSaved(new Date());
        }
    };

    const isPdfFile = (fileName: string, fileType?: string) => {
        return fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    };

    const isPdfUrl = (url: string) => {
        return url.split('?')[0].toLowerCase().endsWith('.pdf');
    };

    const getAttachmentKind = (url: string, name: string): AttachmentKind => {
        const value = `${url} ${name}`.split('?')[0].toLowerCase();
        if (value.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/)) return 'image';
        if (value.match(/\.pdf(\s|$)/)) return 'pdf';
        if (value.match(/\.(txt|md|markdown|csv|json|log|xml|html|css|js|jsx|ts|tsx|sql|yml|yaml)$/)) return 'text';
        return 'file';
    };

    const getTextContent = (value: React.ReactNode): string => {
        if (typeof value === 'string' || typeof value === 'number') {
            return String(value);
        }

        if (Array.isArray(value)) {
            return value.map(getTextContent).join('');
        }

        return text.notes.attachmentFallback;
    };

    const buildAttachmentMarkdown = (file: File, url: string) => {
        if (file.type.startsWith('image/')) {
            return `![${file.name}](${url})`;
        }

        const label = isPdfFile(file.name, file.type) ? `${file.name} PDF` : file.name;
        return `[${label}](${url})`;
    };

    const insertTextAtCursor = (text: string, cursor = textareaRef.current?.selectionStart ?? contentRef.current.length) => {
        const currentContent = contentRef.current;
        const safeCursor = Math.min(cursor, currentContent.length);
        const prefix = currentContent.slice(0, safeCursor);
        const suffix = currentContent.slice(safeCursor);
        const leadingBreak = prefix.trim().length > 0 && !prefix.endsWith('\n') ? '\n\n' : '';
        const trailingBreak = suffix.trim().length > 0 && !suffix.startsWith('\n') ? '\n\n' : '\n';
        const nextContent = `${prefix}${leadingBreak}${text}${trailingBreak}${suffix}`;

        contentRef.current = nextContent;
        setContent(nextContent);
        setTimeout(() => {
            const nextCursor = safeCursor + leadingBreak.length + text.length + trailingBreak.length;
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
        }, 100);
    };

    const uploadAndInsertFiles = async (files: FileList | File[]) => {
        const filesToUpload = Array.from(files);
        if (filesToUpload.length === 0 || isPreview) return;

        setIsUploading(true);
        const uploadedMarkdown: string[] = [];

        for (const file of filesToUpload) {
            const url = await uploadFile(file, 'note', event.id);
            if (url) {
                uploadedMarkdown.push(buildAttachmentMarkdown(file, url));
            }
        }

        setIsUploading(false);
        if (uploadedMarkdown.length > 0) {
            insertTextAtCursor(uploadedMarkdown.join('\n\n'));
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files) {
            await uploadAndInsertFiles(files);
        }
        e.target.value = '';
    };

    const handleFileDrop = async (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingFile(false);
        if (e.dataTransfer.files.length > 0) {
            await uploadAndInsertFiles(e.dataTransfer.files);
        }
    };

    const handleFileDragOver = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = isPreview ? 'none' : 'copy';
        if (!isPreview) {
            setIsDraggingFile(true);
        }
    };

    const handleFileDragLeave = (e: React.DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsDraggingFile(false);
        }
    };

    const handleInsertLink = () => {
        setLinkStep('url');
    };

    const resolveUrl = (url: string) => {
        return toApiUrl(url);
    };

    const renderAttachmentViewer = () => {
        if (!selectedFile) return null;

        const kind = getAttachmentKind(selectedFile.url, selectedFile.name);

        if (kind === 'pdf') {
            return (
                <iframe
                    src={selectedFile.url}
                    title={selectedFile.name}
                    className="h-full min-h-0 w-full border-0 bg-stone-100"
                />
            );
        }

        if (kind === 'image') {
            return (
                <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-stone-100 p-4">
                    <img src={selectedFile.url} alt={selectedFile.name} className="max-h-full max-w-full object-contain" />
                </div>
            );
        }

        if (kind === 'text') {
            return <TextAttachmentPreview key={selectedFile.url} url={selectedFile.url} />;
        }

        return (
            <div className="flex h-full min-h-0 items-center justify-center bg-stone-50 p-8 text-center">
                <div>
                    <FileText className="mx-auto mb-4 h-12 w-12 text-stone-400" />
                    <p className="text-sm font-semibold text-stone-700">{selectedFile.name}</p>
                    <p className="mt-2 text-sm text-stone-500">{text.notes.noInlinePreview}</p>
                </div>
            </div>
        );
    };

    if (!isOpen) return null;

    return (
        <div ref={noteDialogRef} role="dialog" aria-modal="true" aria-label={event.title} className="fixed inset-0 z-[70] bg-white flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="h-16 border-b border-stone-200 flex items-center justify-between px-6 bg-stone-50/50 backdrop-blur-md">
                <div className="flex items-center gap-4">
                    <button type="button" onClick={onClose} aria-label={text.notes.closeEditor} className="p-2 -ml-2 hover:bg-stone-200 rounded-full transition-colors text-stone-500">
                        <X className="w-6 h-6" aria-hidden="true" />
                    </button>
                    <div>
                        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-stone-400">
                            <span>{new Intl.DateTimeFormat(language, { dateStyle: 'full' }).format(new Date(event.date))}</span>
                            <span className="w-1 h-1 bg-stone-300 rounded-full" />
                            <span className="text-orange-500 font-bold">{role.label}</span>
                        </div>
                        <h2 className="text-lg font-bold text-stone-800">{event.title}</h2>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {lastSaved && (
                        <span className="text-xs text-stone-400 mr-2 animate-in fade-in">
                            {interpolateText(text.notes.savedAt, { time: new Intl.DateTimeFormat(language, { timeStyle: 'short' }).format(lastSaved) })}
                        </span>
                    )}
                </div>
            </div>

            {/* Main Editor Area */}
            <div className="flex-1 flex overflow-hidden relative">
                {/* Editor / Preview */}
                <div
                    className={`flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full pb-32 transition-colors ${isDraggingFile ? 'bg-orange-50/40' : ''}`}
                    onDrop={handleFileDrop}
                    onDragOver={handleFileDragOver}
                    onDragLeave={handleFileDragLeave}
                >
                    {isPreview ? (
                        <div className="prose prose-stone prose-lg max-w-none">
                            <ReactMarkdown
                                components={{
                                    a: (props) => {
                                        const { node, ...linkProps } = props;
                                        void node;
                                        const href = resolveUrl(linkProps.href as string);
                                        const isFile = href.includes('/uploads/') || href.includes('/attachments/');
                                        const attachmentName = getTextContent(linkProps.children);
                                        const attachmentKind = getAttachmentKind(href, attachmentName);
                                        const isPdf = isFile && (isPdfUrl(href) || attachmentKind === 'pdf');

                                        if (isPdf) {
                                            return (
                                                <div className="my-5 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
                                                    <div className="flex items-center gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedFile({ url: href, name: attachmentName })}
                                                            aria-label={`${text.notes.preview}: ${attachmentName}`}
                                                            className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold text-stone-700 transition-colors hover:text-orange-600"
                                                        >
                                                            <FileText className="h-4 w-4 shrink-0 text-red-500" />
                                                            <span className="truncate">{attachmentName}</span>
                                                        </button>
                                                    </div>
                                                    <iframe
                                                        src={href}
                                                        title={attachmentName}
                                                        className="h-[420px] w-full border-0 bg-stone-100"
                                                    />
                                                </div>
                                            );
                                        }

                                        if (isFile) {
                                            return (
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedFile({ url: href, name: attachmentName })}
                                                    className="my-4 flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-orange-200 hover:bg-orange-50/30"
                                                >
                                                    <span className="flex min-w-0 items-center gap-3">
                                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
                                                            <FileText className="h-5 w-5" />
                                                        </span>
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-sm font-semibold text-stone-800">{attachmentName}</span>
                                                            <span className="block text-xs text-stone-400">{text.notes.uploadedFile}</span>
                                                        </span>
                                                    </span>
                                                    <span className="shrink-0 text-xs font-semibold text-stone-400">
                                                        {text.notes.preview}
                                                    </span>
                                                </button>
                                            );
                                        }

                                        return (
                                            <a
                                                {...linkProps}
                                                href={href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-orange-500 hover:text-orange-600 underline decoration-orange-200 underline-offset-4 transition-colors font-medium break-all cursor-pointer"
                                            />
                                        );
                                    },
                                    img: (props) => {
                                        const { node, ...imageProps } = props;
                                        void node;
                                        const src = resolveUrl(imageProps.src as string);
                                        return (
                                            <div className="my-4 rounded-xl overflow-hidden shadow-lg border border-stone-100 bg-stone-50">
                                                <img
                                                    {...imageProps}
                                                    src={src}
                                                    className="max-w-full h-auto max-h-[500px] object-contain mx-auto"
                                                    loading="lazy"
                                                />
                                            </div>
                                        );
                                    },
                                    p: (props) => {
                                        const { node, ...paragraphProps } = props;
                                        void node;
                                        return <div {...paragraphProps} className="mb-4 leading-relaxed text-stone-700" />;
                                    }
                                }}
                            >
                                {content}
                            </ReactMarkdown>
                            {content.trim() === '' && (
                                <div className="text-stone-400 italic">{text.notes.noPreview}</div>
                            )}
                        </div>
                    ) : (
                        <textarea
                            ref={textareaRef}
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            onDrop={handleFileDrop}
                            onDragOver={handleFileDragOver}
                            onDragLeave={handleFileDragLeave}
                            aria-label={interpolateText(text.notes.writeAs, { role: role.label })}
                            placeholder={interpolateText(text.notes.writeAs, { role: role.label })}
                            className="w-full h-full min-h-[50vh] resize-none outline-none text-lg leading-relaxed text-stone-700 placeholder:text-stone-300 font-serif"
                            autoFocus
                        />
                    )}
                </div>

                {/* Sidebar */}
                <div className="w-72 border-l border-stone-200 bg-stone-50 p-4 flex flex-col gap-4 hidden lg:flex">
                    <div className="text-xs font-bold text-stone-500 uppercase tracking-widest mb-2">{text.notes.attachments}</div>
                    <button
                        type="button"
                        disabled={isPreview || isUploading}
                        onClick={() => fileInputRef.current?.click()}
                        onDrop={handleFileDrop}
                        onDragOver={handleFileDragOver}
                        onDragLeave={handleFileDragLeave}
                        className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-stone-500 gap-2 transition-colors group ${isPreview ? 'border-stone-200 opacity-50 cursor-not-allowed' : isDraggingFile ? 'border-orange-400 bg-orange-50 text-orange-500 cursor-copy' : 'border-stone-200 hover:border-orange-300 hover:bg-orange-50/10 cursor-pointer'}`}
                    >
                        {isUploading ? <RotateCcw className="w-8 h-8 animate-spin text-orange-400" /> : <UploadCloud className="w-8 h-8 group-hover:text-orange-400 transition-colors" />}
                        <span className="text-xs text-center">{isUploading ? text.notes.uploading : text.notes.dropFiles}<br />{text.notes.clickToUpload}</span>
                    </button>

                    <div className="flex-1"></div>

                    <div className="border-t border-stone-200 pt-4">
                        <div className="text-xs text-stone-400 text-center">
                            {text.notes.markdownSupported}
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
                            multiple
                        />
                        <button
                            type="button"
                            onClick={() => setIsPreview(!isPreview)}
                            className={`p-2 rounded-lg transition-colors ${isPreview ? 'bg-orange-100 text-orange-600' : 'hover:bg-stone-100 text-stone-500 hover:text-stone-800'}`}
                            title={isPreview ? text.notes.editMode : text.notes.previewMode}
                            aria-label={isPreview ? text.notes.editMode : text.notes.previewMode}
                        >
                            {isPreview ? <Pencil className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                        <div className="w-px h-6 bg-stone-200 mx-2" />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isPreview || isUploading}
                            className="p-2 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={text.notes.attachFile}
                            aria-label={text.notes.attachFile}
                        >
                            <Paperclip className="w-5 h-5" />
                        </button>
                        <button
                            type="button"
                            onClick={handleInsertLink}
                            disabled={isPreview}
                            className="p-2 hover:bg-stone-100 rounded-lg text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={text.notes.insertLink}
                            aria-label={text.notes.insertLink}
                        >
                            <Link className="w-5 h-5" />
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => { void handleSave(); }}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-6 py-2.5 bg-stone-900 text-white rounded-xl hover:bg-black transition-all disabled:opacity-50 shadow-lg shadow-stone-200"
                    >
                        {isSaving ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>{isSaving ? text.common.saving : text.notes.saveNote}</span>
                    </button>
                </div>

                {/* Attachment Viewer */}
                {selectedFile && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/25 p-5 backdrop-blur-sm animate-in fade-in duration-200">
                        <div ref={attachmentDialogRef} role="dialog" aria-modal="true" aria-label={selectedFile.name} className="flex h-full max-h-[84vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl animate-in zoom-in-95 duration-200">
                            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4">
                                <div className="flex min-w-0 items-center gap-2">
                                    <FileText className="h-5 w-5 shrink-0 text-stone-500" />
                                    <span className="truncate text-sm font-semibold text-stone-800">{selectedFile.name}</span>
                                </div>
                                <button
                                    ref={attachmentCloseRef}
                                    type="button"
                                    onClick={() => setSelectedFile(null)}
                                    className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-200 hover:text-stone-900"
                                    title={text.notes.closeAttachment}
                                    aria-label={text.notes.closeAttachment}
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="min-h-0 flex-1">
                                {renderAttachmentViewer()}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <TextInputDialog
                open={linkStep === 'url'}
                title={text.notes.linkUrlTitle}
                label={text.notes.linkUrlLabel}
                placeholder={text.notes.linkUrlPlaceholder}
                confirmLabel={text.common.next}
                cancelLabel={text.common.cancel}
                onCancel={() => setLinkStep(null)}
                onConfirm={(url) => {
                    setPendingLinkUrl(url);
                    setLinkStep('text');
                }}
                interactionId="note-link-url"
            />
            <TextInputDialog
                open={linkStep === 'text'}
                title={text.notes.linkTextTitle}
                label={text.notes.linkTextLabel}
                initialValue={text.notes.linkTextDefault}
                confirmLabel={text.common.add}
                cancelLabel={text.common.cancel}
                onCancel={() => {
                    setLinkStep(null);
                    setPendingLinkUrl('');
                }}
                onConfirm={(label) => {
                    insertTextAtCursor(`[${label}](${pendingLinkUrl})`);
                    setLinkStep(null);
                    setPendingLinkUrl('');
                }}
                interactionId="note-link-text"
            />
        </div>
    );
};
