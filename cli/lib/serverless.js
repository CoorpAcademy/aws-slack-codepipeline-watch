const {spawn} = require('child_process');
const path = require('path');
const c = require('chalk');

const SERVERLESS = path.join(__dirname, '../../node_modules/.bin/serverless');
const PADDING = ' :>> ';

const runServerless = command => {
  return new Promise((resolve, reject) => {
    const sls = spawn(SERVERLESS, command);
    process.stdout.write(
      `⚡️ ${c.bold.blue("About to run '")}${c.yellow(
        `serverless ${command.join(' ')}`
      )}${c.bold.blue("':")}\n\n`
    );
    process.stdout.write(PADDING);
    sls.stdout.on('data', output =>
      process.stdout.write(output.toString().replace(/\n/g, `\n${PADDING}`))
    );
    sls.stderr.on('data', output => process.stderr.write(output.toString()));
    sls.on('close', exitCode => {
      process.stdout.write('\n');
      if (exitCode === 0) return resolve();
      return reject(new Error(`Some error occured, exitCode:${exitCode}`));
    });
  });
};

module.exports = runServerless;
