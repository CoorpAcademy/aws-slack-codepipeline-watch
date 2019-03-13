const {exec} = require('child_process');
const path = require('path');

const SERVERLESS = path.join(__dirname, '../node_modules/.bin/serverless');

if (!module.parent) {
  exec(`${SERVERLESS} package`,(err, stdout, stderr) => {
      console.log(err)
      console.log(stdout)
      console.error(stderr)
  })
}