const awsPromise = res => ({
  promise: () => Promise.resolve(res)
});
const failingAwsPromise = err => ({
  promise: () => Promise.reject(err)
});

module.exports = {awsPromise, failingAwsPromise};
