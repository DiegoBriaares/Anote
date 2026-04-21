const { runCli } = require('./prod_user_ops.cjs');

runCli(['remove-admin', ...process.argv.slice(2)]);
