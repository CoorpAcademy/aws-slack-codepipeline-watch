const Bromise = require('bluebird');

const awsPromise = res => ({
  promise: () => Bromise.resolve(res)
});
const failingAwsPromise = err => ({
  promise: () => Bromise.reject(err)
});

module.exports = {awsPromise, failingAwsPromise};
