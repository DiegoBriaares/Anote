const fs = require('fs');
const path = require('path');

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
const secretKey = process.env.SECRET_KEY || (isProduction ? '' : 'anote-development-only-secret');

if (!secretKey) {
    throw new Error('SECRET_KEY is required when NODE_ENV=production');
}

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

module.exports = Object.freeze({
    nodeEnv,
    isProduction,
    port: parsePort(process.env.PORT, isProduction ? 3001 : 3002),
    host: process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
    databasePath,
    uploadDir,
    secretKey
});
