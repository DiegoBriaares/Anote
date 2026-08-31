const fs = require('fs');
const path = require('path');

const { parsePosixModeEnforcement } = require('./file-modes');

const parsePort = (value, fallback) => {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid server port: ${value}`);
    }
    return parsed;
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const serverDir = __dirname;
const databasePath = path.resolve(process.env.ANOTE_DATABASE_PATH || path.join(serverDir, 'calendar.db'));
const uploadDir = path.resolve(process.env.ANOTE_UPLOAD_DIR || path.join(serverDir, 'uploads'));
const configuredTimeZone = process.env.ANOTE_DEFAULT_TIME_ZONE;
if (isProduction && !configuredTimeZone) {
    throw new Error('ANOTE_DEFAULT_TIME_ZONE is required in production.');
}
const defaultTimeZone = configuredTimeZone || 'UTC';
try {
    new Intl.DateTimeFormat('en-US', { timeZone: defaultTimeZone }).format();
} catch {
    throw new Error('ANOTE_DEFAULT_TIME_ZONE must be a valid IANA time zone.');
}
const parsePositiveInteger = (value, fallback, name) => {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid ${name}: ${value}`);
    }
    return parsed;
};

fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });

module.exports = Object.freeze({
    nodeEnv,
    isProduction,
    port: parsePort(process.env.PORT, isProduction ? 3001 : 3002),
    host: process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
    databasePath,
    uploadDir,
    sessionCookieName: 'anote_session',
    sessionIdleSeconds: parsePositiveInteger(process.env.ANOTE_SESSION_IDLE_SECONDS, 60 * 60 * 24 * 7, 'session idle duration'),
    sessionAbsoluteSeconds: parsePositiveInteger(process.env.ANOTE_SESSION_ABSOLUTE_SECONDS, 60 * 60 * 24 * 30, 'session absolute duration'),
    secureCookies: process.env.ANOTE_SECURE_COOKIES === '1',
    posixModeEnforcement: parsePosixModeEnforcement(process.env.ANOTE_POSIX_MODE_ENFORCEMENT),
    defaultTimeZone,
    release: Object.freeze({
        id: process.env.ANOTE_RELEASE_ID || 'development',
        version: process.env.ANOTE_RELEASE_VERSION || '0.0.0-development',
        sourceCommit: process.env.ANOTE_SOURCE_COMMIT || 'unknown'
    })
});
