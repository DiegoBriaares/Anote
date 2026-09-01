const cors = require('cors');
const express = require('express');

const { createAdminRouter, createAdminService } = require('./admin');
const { createAttachmentService, createAttachmentsRouter } = require('./attachments');
const { createAuth } = require('./auth');
const { createCalendarMetadataRouter, createCalendarMetadataService } = require('./calendar-metadata');
const { createConfigurationRouter, createConfigurationService } = require('./configuration');
const { closeDatabase, createDatabase } = require('./db');
const { createEventService, createEventsRouter } = require('./events');
const { createHealthRouter, verifyUploads } = require('./health');
const {
    errorHandler,
    notFound,
    requestContext,
    createSameOriginMutations,
    securityHeaders
} = require('./http');
const { migrateDatabase } = require('./migrations');
const { createNoteService, createNotesRouter } = require('./notes');
const { createProgramService, createProgramsRouter, startProgramScheduler } = require('./programs');
const { createRoleService, createRolesRouter } = require('./roles');
const { createSocialRouter, createSocialService } = require('./social');
const { createUserService, createUsersRouter } = require('./users');

const createRuntime = ({ config, database, now = () => new Date(), scheduler = true, logger = console }) => {
    const db = database || createDatabase(config.databasePath, {
        posixModeEnforcement: config.posixModeEnforcement
    });
    const ownsDatabase = !database;
    let schemaVersion;
    try {
        schemaVersion = migrateDatabase(db, {
            defaultTimeZone: config.defaultTimeZone,
            isProduction: config.isProduction,
            now
        });
        if (db.prepare(`
            SELECT 1 FROM app_config
            WHERE key = 'legacy_ownership_recovery_required' AND value = 'true'
        `).get()) {
            throw new Error('Legacy ownership recovery is required before Anote can start');
        }
    } catch (error) {
        if (ownsDatabase) closeDatabase(db);
        throw error;
    }

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.isProduction ? 1 : false);
    if (!config.isProduction) {
        app.use(cors({
            origin: ['http://127.0.0.1:5174', 'http://localhost:5174'],
            credentials: true
        }));
    }
    app.use(requestContext);
    app.use(securityHeaders);
    app.use(express.json({ limit: '1mb', strict: true }));
    app.use(createSameOriginMutations(config.isProduction ? [] : [
        'http://127.0.0.1:5174',
        'http://localhost:5174'
    ]));

    let attachmentService;
    try {
        attachmentService = createAttachmentService({
            db,
            uploadDir: config.uploadDir,
            now,
            posixModeEnforcement: config.posixModeEnforcement
        });
        attachmentService.migrateLegacyReferences();
        verifyUploads(config.uploadDir);
    } catch (error) {
        if (ownsDatabase) closeDatabase(db);
        throw error;
    }
    const retireAttachments = attachmentService.retireAfterMutation;
    const userService = createUserService({ db, retireAttachments });
    const auth = createAuth({ db, config, now, userService });
    const eventService = createEventService({ db, now, retireAttachments });
    const adminService = createAdminService({ db, eventService, userService, retireAttachments });
    const calendarMetadataService = createCalendarMetadataService({ db, retireAttachments });
    const configurationService = createConfigurationService({ db });
    const noteService = createNoteService({ db, now });
    const programService = createProgramService({ db, now });
    const roleService = createRoleService({ db });
    const socialService = createSocialService({ db, now });
    app.use(createHealthRouter({
        db,
        uploadDir: config.uploadDir,
        release: config.release,
        schemaVersion,
        logger
    }));

    app.use(auth.router);
    app.use(createUsersRouter({ service: userService, authenticate: auth.authenticate }));
    app.use('/events', createEventsRouter({ service: eventService, authenticate: auth.authenticate }));
    app.use('/postponed-events', createEventsRouter({ service: eventService, authenticate: auth.authenticate, postponed: true }));
    app.use('/programs', createProgramsRouter({
        service: programService,
        authenticate: auth.authenticate
    }));
    app.use('/attachments', createAttachmentsRouter({ service: attachmentService, authenticate: auth.authenticate }));
    app.use(createNotesRouter({ service: noteService, authenticate: auth.authenticate }));
    app.use(createAdminRouter({ service: adminService, authenticate: auth.authenticate, requireAdmin: auth.requireAdmin }));
    app.use(createCalendarMetadataRouter({ service: calendarMetadataService, authenticate: auth.authenticate }));
    app.use(createConfigurationRouter({ service: configurationService, authenticate: auth.authenticate, requireAdmin: auth.requireAdmin }));
    app.use(createRolesRouter({ service: roleService, authenticate: auth.authenticate }));
    app.use(createSocialRouter({ service: socialService, authenticate: auth.authenticate }));

    app.use(notFound);
    app.use(errorHandler);

    const stopScheduler = scheduler ? startProgramScheduler({ service: programService, logger }) : () => {};
    let backgroundStopped = false;
    const stopBackgroundWork = () => {
        if (backgroundStopped) return;
        backgroundStopped = true;
        stopScheduler();
    };
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        stopBackgroundWork();
        if (ownsDatabase) closeDatabase(db);
    };

    return {
        adminService,
        app,
        attachmentService,
        auth,
        calendarMetadataService,
        close,
        configurationService,
        db,
        eventService,
        noteService,
        programService,
        roleService,
        schemaVersion,
        socialService,
        stopBackgroundWork
    };
};

module.exports = { createRuntime };
