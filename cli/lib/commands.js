const c = require('chalk');

module.exports = {
  setup: {
    args: ['deploy'],
    success: c.bold.green('🚀 codepipeline-watch is all set up'),
    failure: c.bold.red('🚨 There is some issue with codepipeline-watch')
  },
  remove: {
    args: ['remove'],
    success: c.bold.green('💥 codepipeline-watch was sucessfully removed'),
    failure: c.bold.red('🚨 There was some issue with codepipeline-watch removal')
  }
};
