const test = require('ava');
const {getCommitDetails} = require('../lambda/aws-slack-codepipeline-watch');
const codepipelineData = require('./fixtures/codepipeline-data');
const githubCommitDetails = require('./fixtures/github-commit-details');

test('getCommitDetails perform a query to the github api to extract details', async t => {
  const context = {
    request: (param, callback) => {
      callback(null, {statusCode: 200}, JSON.stringify(githubCommitDetails));
    },
    github: {token: 'tokenn'},
    event: {pipelineData: {pipelineExecution: {artifactRevisions: [{revisionId: 'abcd'}]}}}
  };
  const res = await getCommitDetails(context, codepipelineData.pipeline);
  t.deepEqual(res, {
    author: 'AdrieanKhisbe',
    authorIcon: 'https://github.com/AdrieanKhisbe.png?size=16',
    authorLink: 'https://github.com/AdrieanKhisbe',
    authorName: 'AdrieanKhisbe',
    branch: 'develop',
    committer: 'GitHub',
    committerIcon: 'https://github.com/web-flow.png?size=16',
    committerLink: 'https://github.com/web-flow',
    committerName: 'GitHub',
    owner: 'CoorpAcademy',
    repo: 'my-repo',
    stats: {additions: 1, deletions: 2, total: 3}
  });
});
