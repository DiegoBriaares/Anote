const fs = require('fs');
const path = require('path');
const express = require('express');

const verifyUploads = (uploadDir) => {
    fs.accessSync(uploadDir, fs.constants.R_OK | fs.constants.W_OK);
    const probe = path.join(uploadDir, `.health-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    fs.rmSync(probe);
};

const createHealthRouter = ({ db, uploadDir, release, schemaVersion, logger = console }) => {
    const router = express.Router();
    router.get('/health/live', (_req, res) => res.json({ status: 'live' }));
    router.get('/health/ready', (req, res) => {
        try {
            if (db.prepare('SELECT 1 AS healthy').get().healthy !== 1) {
                throw new Error('Database probe failed');
            }
            verifyUploads(uploadDir);
            res.json({
                status: 'ready',
                data: {
                    releaseId: release.id,
                    version: release.version,
                    sourceCommit: release.sourceCommit,
                    schemaVersion
                }
            });
        } catch (error) {
            logger.error('Readiness check failed', {
                name: typeof error?.name === 'string' ? error.name : 'Error',
                code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
            });
            res.status(503).json({
                status: 'not_ready',
                error: { code: 'DEPENDENCY_UNAVAILABLE' },
                requestId: req.requestId
            });
        }
    });
    return router;
};

module.exports = { createHealthRouter, verifyUploads };
