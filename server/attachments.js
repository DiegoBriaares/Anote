const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const { ApiError } = require('./http');

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const CONTENT_TYPES = Object.freeze({
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
    'text/plain': '.txt'
});

const hasExpectedSignature = (buffer, mimeType) => {
    if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === 'image/gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
    if (mimeType === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (mimeType === 'text/plain') return !buffer.includes(0);
    return false;
};

const extensionMimeType = (fileName) => {
    const extension = path.extname(fileName).toLocaleLowerCase();
    if (extension === '.jpeg') return 'image/jpeg';
    return Object.entries(CONTENT_TYPES).find(([, value]) => value === extension)?.[0] || null;
};

const isSafeStoredName = (value) => typeof value === 'string'
    && value.length <= 255
    && value === path.basename(value)
    && /^[A-Za-z0-9._-]+$/.test(value);

const digestFile = (filePath) => {
    const hash = crypto.createHash('sha256');
    const descriptor = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
        let bytesRead;
        do {
            bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
    } finally {
        fs.closeSync(descriptor);
    }
    return hash.digest('hex');
};

const fileHasExpectedSignature = (filePath, mimeType) => {
    const descriptor = fs.openSync(filePath, 'r');
    try {
        if (mimeType === 'text/plain') {
            const buffer = Buffer.allocUnsafe(64 * 1024);
            let bytesRead;
            do {
                bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
                if (bytesRead > 0 && buffer.subarray(0, bytesRead).includes(0)) return false;
            } while (bytesRead > 0);
            return true;
        }
        const prefix = Buffer.alloc(16);
        const bytesRead = fs.readSync(descriptor, prefix, 0, prefix.length, 0);
        return hasExpectedSignature(prefix.subarray(0, bytesRead), mimeType);
    } finally {
        fs.closeSync(descriptor);
    }
};

const createAttachmentService = ({ db, uploadDir, now = () => new Date() }) => {
    const lstatIfExists = (filePath) => {
        try {
            return fs.lstatSync(filePath);
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
    };
    const stagingDir = path.join(path.dirname(uploadDir), '.anote-upload-staging');
    const retirementDir = path.join(path.dirname(uploadDir), '.anote-attachment-retirement');
    for (const directory of [stagingDir, retirementDir]) {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        try {
            fs.chmodSync(directory, 0o700);
        } catch (error) {
            if (process.platform !== 'win32') throw error;
        }
    }
    for (const entry of fs.readdirSync(stagingDir)) {
        const candidate = path.join(stagingDir, entry);
        const stats = fs.lstatSync(candidate);
        if (stats.isFile() || stats.isSymbolicLink()) fs.rmSync(candidate, { force: true });
    }

    const reconcileRetirements = () => {
        for (const storedName of fs.readdirSync(retirementDir)) {
            if (!isSafeStoredName(storedName)) {
                throw new Error('Attachment retirement storage contains an unsafe entry');
            }
            const retired = path.join(retirementDir, storedName);
            const stats = fs.lstatSync(retired);
            if (!stats.isFile() || stats.isSymbolicLink()) {
                throw new Error('Attachment retirement storage contains a non-file entry');
            }
            const stillOwned = db.prepare('SELECT 1 FROM attachments WHERE stored_name = ? LIMIT 1').get(storedName);
            if (!stillOwned) {
                fs.rmSync(retired, { force: true });
                continue;
            }
            const target = path.join(uploadDir, storedName);
            if (lstatIfExists(target)) {
                throw new Error('Attachment retirement recovery found an ambiguous file');
            }
            fs.renameSync(retired, target);
        }
    };
    reconcileRetirements();

    const isReferenced = (attachment) => {
        const url = `/attachments/${attachment.id}`;
        if (attachment.purpose === 'note') {
            return db.prepare('SELECT 1 FROM events WHERE id = ? AND user_id = ?')
                .get(attachment.event_id, attachment.owner_user_id) !== undefined;
        }
        if (attachment.purpose === 'avatar') {
            return db.prepare('SELECT 1 FROM users WHERE id = ? AND avatar_url = ?')
                .get(attachment.owner_user_id, url) !== undefined;
        }
        return db.prepare('SELECT 1 FROM day_backgrounds_v2 WHERE user_id = ? AND image_url = ? LIMIT 1')
            .get(attachment.owner_user_id, url) !== undefined
            || db.prepare(`
                SELECT 1 FROM users
                WHERE id = ?
                  AND json_extract(
                      CASE WHEN json_valid(preferences) THEN preferences ELSE '{}' END,
                      '$.backgroundUrl'
                  ) = ?
            `).get(attachment.owner_user_id, url) !== undefined;
    };

    const retireAfterMutation = (collectCandidates, mutate) => {
        const moved = [];
        const write = db.transaction(() => {
            const candidates = collectCandidates();
            if (!Array.isArray(candidates)) throw new Error('Attachment retirement candidates are invalid');
            const unique = [...new Map(candidates.map((attachment) => [attachment.id, attachment])).values()];
            if (unique.some((attachment) => !isSafeStoredName(attachment.stored_name))) {
                throw new ApiError(409, 'attachment_integrity_error');
            }
            const result = mutate();
            for (const attachment of unique) {
                const current = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachment.id);
                if (current && isReferenced(current)) continue;
                if (current) db.prepare('DELETE FROM attachments WHERE id = ?').run(current.id);
            }
            const storedNames = [...new Set(unique.map((attachment) => attachment.stored_name))];
            for (const storedName of storedNames) {
                if (db.prepare('SELECT 1 FROM attachments WHERE stored_name = ? LIMIT 1').get(storedName)) continue;
                const source = path.join(uploadDir, storedName);
                const stats = lstatIfExists(source);
                if (!stats) continue;
                if (!stats.isFile() || stats.isSymbolicLink()) {
                    throw new ApiError(409, 'attachment_integrity_error');
                }
                const retired = path.join(retirementDir, storedName);
                if (lstatIfExists(retired)) throw new ApiError(409, 'attachment_integrity_error');
                fs.renameSync(source, retired);
                moved.push({ source, retired });
            }
            return result;
        });
        let result;
        try {
            result = write.immediate();
        } catch (error) {
            for (const item of moved.reverse()) {
                if (lstatIfExists(item.retired) && !lstatIfExists(item.source)) {
                    fs.renameSync(item.retired, item.source);
                }
            }
            throw error;
        }
        for (const item of moved) {
            try {
                fs.rmSync(item.retired, { force: true });
            } catch {
                // A committed retirement is completed by reconcileRetirements on restart.
            }
        }
        return result;
    };

    const stage = (file) => {
        if (typeof file?.path === 'string') {
            const candidate = path.resolve(file.path);
            if (path.dirname(candidate) !== path.resolve(stagingDir)
                || !/^[0-9a-f-]{36}\.upload$/.test(path.basename(candidate))) {
                throw new ApiError(400, 'invalid_attachment_request');
            }
            return candidate;
        }
        if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
            throw new ApiError(400, 'unsupported_attachment_type');
        }
        if (file.buffer.length > MAX_ATTACHMENT_BYTES) throw new ApiError(413, 'attachment_too_large');
        const candidate = path.join(stagingDir, `${crypto.randomUUID()}.upload`);
        fs.writeFileSync(candidate, file.buffer, { flag: 'wx', mode: 0o600 });
        return candidate;
    };

    const create = ({ ownerId, purpose, eventId, file }) => {
        if (!file) throw new ApiError(400, 'attachment_required');
        let temporary;
        let target;
        try {
            temporary = stage(file);
            const stats = fs.lstatSync(temporary);
            if (!stats.isFile() || stats.size === 0) throw new ApiError(400, 'unsupported_attachment_type');
            if (stats.size > MAX_ATTACHMENT_BYTES) throw new ApiError(413, 'attachment_too_large');
            try {
                fs.chmodSync(temporary, 0o600);
            } catch (error) {
                if (process.platform !== 'win32') throw error;
            }
            if (!['avatar', 'note', 'background'].includes(purpose)) throw new ApiError(400, 'invalid_attachment_purpose');
            if (!CONTENT_TYPES[file.mimetype] || !fileHasExpectedSignature(temporary, file.mimetype)) {
                throw new ApiError(400, 'unsupported_attachment_type');
            }
            const originalExtension = path.extname(file.originalname || '').toLocaleLowerCase();
            const nameMimeType = extensionMimeType(file.originalname || '');
            if (originalExtension && nameMimeType !== file.mimetype) {
                throw new ApiError(400, 'attachment_type_mismatch');
            }
            if (['avatar', 'background'].includes(purpose) && !file.mimetype.startsWith('image/')) {
                throw new ApiError(400, 'attachment_must_be_image');
            }
            if (purpose === 'note') {
                if (typeof eventId !== 'string' || !eventId) throw new ApiError(400, 'attachment_event_required');
                const event = db.prepare('SELECT 1 FROM events WHERE id = ? AND user_id = ?').get(eventId, ownerId);
                if (!event) throw new ApiError(404, 'event_not_found');
            } else if (eventId) {
                throw new ApiError(400, 'attachment_cannot_have_event');
            }

            const id = crypto.randomUUID();
            const storedName = `${id}${CONTENT_TYPES[file.mimetype]}`;
            target = path.join(uploadDir, storedName);
            const sha256 = digestFile(temporary);
            fs.renameSync(temporary, target);
            temporary = null;
            db.prepare(`
                INSERT INTO attachments (
                    id, owner_user_id, purpose, event_id, original_name,
                    stored_name, mime_type, size, sha256, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                ownerId,
                purpose,
                purpose === 'note' ? eventId : null,
                path.basename(file.originalname || 'attachment').slice(0, 255),
                storedName,
                file.mimetype,
                stats.size,
                sha256,
                now().toISOString()
            );
            target = null;
            return {
                id,
                url: `/attachments/${id}`,
                filename: path.basename(file.originalname || 'attachment').slice(0, 255),
                mimeType: file.mimetype,
                size: stats.size
            };
        } catch (error) {
            if (temporary) fs.rmSync(temporary, { force: true });
            if (target) fs.rmSync(target, { force: true });
            throw error;
        }
    };

    const read = (requesterId, id) => {
        const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
        if (!attachment) throw new ApiError(404, 'attachment_not_found');
        const noteIsOwned = attachment.purpose === 'note'
            && attachment.owner_user_id === requesterId
            && db.prepare('SELECT 1 FROM events WHERE id = ? AND user_id = ?')
                .get(attachment.event_id, requesterId);
        const avatarIsVisible = attachment.purpose === 'avatar'
            && db.prepare('SELECT 1 FROM users WHERE id = ? AND avatar_url = ?')
                .get(attachment.owner_user_id, `/attachments/${attachment.id}`);
        const backgroundIsOwned = attachment.purpose === 'background'
            && attachment.owner_user_id === requesterId;
        if (!noteIsOwned && !avatarIsVisible && !backgroundIsOwned) {
            throw new ApiError(404, 'attachment_not_found');
        }
        if (!isSafeStoredName(attachment.stored_name)) throw new ApiError(409, 'attachment_integrity_error');
        const filePath = path.join(uploadDir, attachment.stored_name);
        let stats;
        try {
            stats = fs.lstatSync(filePath);
        } catch {
            throw new ApiError(404, 'attachment_not_found');
        }
        if (!stats.isFile() || stats.size !== attachment.size || digestFile(filePath) !== attachment.sha256) {
            throw new ApiError(409, 'attachment_integrity_error');
        }
        return { attachment, filePath };
    };

    const migrateLegacyReferences = () => {
        const referencePattern = /\/uploads\/([A-Za-z0-9._-]+)/g;
        const findOrCreate = (ownerId, purpose, eventId, storedName) => {
            const existing = db.prepare(`
                SELECT id FROM attachments
                WHERE owner_user_id = ? AND purpose = ? AND stored_name = ?
                  AND COALESCE(event_id, '') = COALESCE(?, '')
            `).get(ownerId, purpose, storedName, eventId || null);
            if (existing) return existing.id;
            const filePath = path.join(uploadDir, storedName);
            let stats;
            try {
                stats = fs.lstatSync(filePath);
            } catch {
                return null;
            }
            const mimeType = extensionMimeType(storedName);
            if (!stats.isFile() || !mimeType || stats.size > MAX_ATTACHMENT_BYTES) return null;
            const id = crypto.randomUUID();
            db.prepare(`
                INSERT INTO attachments (
                    id, owner_user_id, purpose, event_id, original_name,
                    stored_name, mime_type, size, sha256, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id, ownerId, purpose, eventId || null, storedName, storedName,
                mimeType, stats.size, digestFile(filePath), now().toISOString()
            );
            return id;
        };

        db.transaction(() => {
            const users = db.prepare("SELECT id, avatar_url FROM users WHERE avatar_url LIKE '%/uploads/%'").all();
            const updateAvatar = db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?');
            for (const user of users) {
                const match = [...user.avatar_url.matchAll(referencePattern)][0];
                const id = match ? findOrCreate(user.id, 'avatar', null, match[1]) : null;
                if (id) updateAvatar.run(`/attachments/${id}`, user.id);
            }

            const notes = db.prepare(`
                SELECT n.event_id, n.role_id, n.content, e.user_id
                FROM event_notes n JOIN events e ON e.id = n.event_id
                WHERE n.content LIKE '%/uploads/%'
            `).all();
            const updateNote = db.prepare('UPDATE event_notes SET content = ? WHERE event_id = ? AND role_id = ?');
            for (const note of notes) {
                const rewritten = note.content.replace(referencePattern, (full, storedName) => {
                    const id = findOrCreate(note.user_id, 'note', note.event_id, storedName);
                    return id ? `/attachments/${id}` : full;
                });
                if (rewritten !== note.content) updateNote.run(rewritten, note.event_id, note.role_id);
            }

            const backgrounds = db.prepare("SELECT date, user_id, image_url FROM day_backgrounds_v2 WHERE image_url LIKE '%/uploads/%'").all();
            const updateBackground = db.prepare('UPDATE day_backgrounds_v2 SET image_url = ? WHERE date = ? AND user_id = ?');
            for (const background of backgrounds) {
                const match = [...background.image_url.matchAll(referencePattern)][0];
                const id = match ? findOrCreate(background.user_id, 'background', null, match[1]) : null;
                if (id) updateBackground.run(`/attachments/${id}`, background.date, background.user_id);
            }
        }).immediate();
    };

    return { create, migrateLegacyReferences, read, reconcileRetirements, retireAfterMutation, stagingDir };
};

const createAttachmentsRouter = ({ service, authenticate }) => {
    const upload = multer({
        storage: multer.diskStorage({
            destination: service.stagingDir,
            filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`)
        }),
        limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 4 }
    });
    const router = express.Router();
    router.use(authenticate);
    router.post('/', upload.single('file'), (req, res, next) => {
        try {
            const data = service.create({
                ownerId: req.user.id,
                purpose: req.body?.purpose,
                eventId: req.body?.eventId,
                file: req.file
            });
            res.status(201).json({ message: 'success', data });
        } catch (error) {
            next(error);
        }
    });
    router.get('/:id', (req, res, next) => {
        try {
            const { attachment, filePath } = service.read(req.user.id, req.params.id);
            res.type(attachment.mime_type);
            res.set('Content-Length', String(attachment.size));
            const inline = attachment.mime_type.startsWith('image/') || attachment.mime_type === 'application/pdf';
            res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="attachment${CONTENT_TYPES[attachment.mime_type]}"`);
            if (attachment.mime_type === 'application/pdf') {
                res.set('X-Frame-Options', 'SAMEORIGIN');
                res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; sandbox");
            }
            fs.createReadStream(filePath).on('error', next).pipe(res);
        } catch (error) {
            next(error);
        }
    });
    return router;
};

module.exports = {
    CONTENT_TYPES,
    MAX_ATTACHMENT_BYTES,
    createAttachmentService,
    createAttachmentsRouter,
    digestFile,
    fileHasExpectedSignature,
    hasExpectedSignature
};
