const config = require('./config');
const { closeDatabase, createDatabase } = require('./db');
const { migrateDatabase } = require('./migrations');

const main = () => {
    const db = createDatabase(config.databasePath);
    try {
        const schemaVersion = migrateDatabase(db, config);
        process.stdout.write(`Anote database schema ${schemaVersion} is ready.\n`);
    } finally {
        closeDatabase(db);
    }
};

try {
    main();
} catch (error) {
    process.stderr.write(`Database migration failed: ${error.message}\n`);
    process.exitCode = 1;
}
