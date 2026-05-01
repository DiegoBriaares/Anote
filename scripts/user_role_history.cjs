const { runCli } = require('./prod_user_ops.cjs');

runCli(['history', ...process.argv.slice(2)]);
