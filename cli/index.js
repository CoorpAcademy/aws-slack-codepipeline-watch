const c = require('chalk');
const runServerless = require('./lib/serverless');
const commands = require('./lib/commands');

const main = async argv => {
  const commandName = argv[0];
  if (!commandName) {
    console.error(c.bold.red(`🚫 You need to provide a command`));
    return process.exit(2);
  }
  const command = commands[commandName];
  if (!command) {
    console.error(c.bold.red(`🚫 command ${commandName} is not available`));
    return process.exit(2);
  }
  try {
    await runServerless(command.args.concat(argv.slice(1)));
    console.log(`\n${command.success}`);
  } catch (err) {
    console.log(`\n${command.failure}`);
    process.exit(1);
  }
};

module.exports = main;
if (!module.parent) {
  main(process.argv.slice(2));
}
