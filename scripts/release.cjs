const path = require('path');
const { spawnSync } = require('child_process');

const deployScript = path.join(__dirname, 'deploy_to_prod.sh');
const result = spawnSync('bash', [deployScript], {
    stdio: 'inherit',
    env: process.env
});

if (result.error) {
    console.error(`Unable to start the production deployment: ${result.error.message}`);
    process.exit(1);
}

process.exit(result.status ?? 1);
