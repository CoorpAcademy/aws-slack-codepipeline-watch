const {spawn} = require('child_process');
const path = require('path');

const SERVERLESS = path.join(__dirname, '../node_modules/.bin/serverless');

const deploy = cb => {
   const sls = spawn(SERVERLESS, ['package']);
   sls.stdout.on('data', output => console.log(output.toString()))
   sls.stderr.on('data', output => console.error(output.toString()))
   sls.on('close', exitCode => {
       if (!cb) return;
       if (exitCode === 0) return cb();
       return cb(new Error(`Some error occured, exitCode:${exitCode}`))
   })
};

if (!module.parent) {
    deploy();
}
