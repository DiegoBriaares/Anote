const config = require('./config');
const { createRuntime } = require('./app');

const start = () => {
    const runtime = createRuntime({ config });
    const server = runtime.app.listen(config.port, config.host, () => {
        console.log(`Anote API listening on http://${config.host}:${config.port}`);
    });
    server.once('error', (error) => {
        runtime.close();
        console.error('Anote API listener failed', error);
        process.exitCode = 1;
    });

    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        runtime.stopBackgroundWork();
        let finished = false;
        const finish = (error) => {
            if (finished) return;
            finished = true;
            clearTimeout(forceTimer);
            try {
                runtime.close();
            } catch (closeError) {
                console.error('Database shutdown failed', closeError);
                process.exitCode = 1;
            }
            if (error) {
                console.error('HTTP shutdown failed', error);
                process.exitCode = 1;
            }
        };
        const forceTimer = setTimeout(() => {
            server.closeAllConnections?.();
            finish(new Error('HTTP shutdown exceeded the 10 second drain limit'));
        }, 10_000);
        forceTimer.unref?.();
        server.closeIdleConnections?.();
        server.close(finish);
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return { runtime, server, stop };
};

if (require.main === module) {
    try {
        start();
    } catch (error) {
        console.error('Anote API failed to start', error);
        process.exitCode = 1;
    }
}

module.exports = { createRuntime, start };
