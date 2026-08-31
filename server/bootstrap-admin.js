const fs = require('fs');

const config = require('./config');
const { closeDatabase, createDatabase } = require('./db');
const { migrateDatabase } = require('./migrations');
const { createUserService } = require('./users');

const main = async () => {
    const input = fs.readFileSync(0, 'utf8');
    let payload;
    try {
        payload = JSON.parse(input);
    } catch {
        throw new Error('Bootstrap input must be JSON');
    }
    const username = typeof payload.username === 'string' ? payload.username.trim() : '';
    const password = payload.password;
    const db = createDatabase(config.databasePath, {
        posixModeEnforcement: config.posixModeEnforcement
    });
    try {
        migrateDatabase(db, config);
        await createUserService({ db }).bootstrapAdministrator({ username, password });
        process.stdout.write('Administrator created.\n');
    } finally {
        closeDatabase(db);
    }
};

main().catch((error) => {
    process.stderr.write(`${error.code || error.message}\n`);
    process.exitCode = 1;
});
