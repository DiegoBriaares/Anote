const { runCli } = require('./prod_user_ops.cjs');

runCli(['change-username', ...process.argv.slice(2)]);
