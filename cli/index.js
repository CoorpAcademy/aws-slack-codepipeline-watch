const {spawn} = require('child_process');
const path = require('path');
const c = require('chalk');

const SERVERLESS = path.join(__dirname, '../node_modules/.bin/serverless');
const PADDING = ' :>> '

const runServerless = (command, cb) => {
   const sls = spawn(SERVERLESS, command);
   process.stdout.write(`⚡️ ${c.bold.blue("About to run '")}${c.yellow(`serverless ${command.join(' ')}`)}${c.bold.blue("':")}\n\n`);
   process.stdout.write(PADDING);
   sls.stdout.on('data', output => process.stdout.write(output.toString().replace(/\n/g, '\n' + PADDING)))
   sls.stderr.on('data', output => process.stderr.write(output.toString()))
   sls.on('close', exitCode => {
       process.stdout.write('\n')
       if (!cb) return;
       if (exitCode === 0) return cb();
       return cb(new Error(`Some error occured, exitCode:${exitCode}`))
   })
};

if (!module.parent) {
    runServerless(['deploy', '--region', 'eu-west-3', '--stack-name', 'codepipeline-watch-test']);
}
