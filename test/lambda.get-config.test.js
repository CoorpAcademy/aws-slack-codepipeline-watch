const test = require('ava');
const Promise = require('bluebird');
const {getContext} = require('../lambda/aws-slack-codepipeline-watch');

test('getConfig without expected arguments does throw when no SLACK_TOKEN', async t => {
  await t.throws(
    () => getContext({DYNAMO_TABLE: 'dbt', SLACK_CHANNEL: 'sc'}),
    'Need a valid token defined in SLACK_TOKEN'
  );
});
test('getConfig without expected arguments does throw when no SLACK_CHANNEL', async t => {
  await t.throws(() =>
    getContext(
      {DYNAMO_TABLE: 'dbt', SLACK_TOKEN: 'st'},
      'Need a valid chanel defined in SLACK_CHANNEL'
    )
  );
});
test('getConfig without expected arguments does throw when no DYNAMO_TABLE', async t => {
  await t.throws(
    () => getContext({SLACK_TOKEN: 'st', SLACK_CHANNEL: 'sc'}),
    'Need a valid table defined in DYNAMO_TABLE'
  );
});

const eventStub = {
  detail: {
    pipeline: 'my-org-codepipeline-my-project',
    'execution-id': 'eid'
  }
};
const lambdaContextStub = {
  codepipeline: {
    getPipelineExecutionAsync: () => Promise.resolve('pipeline-data')
  }
};
test('getConfig with expected arguments return expected config', async t => {
  const {aws, slack} = await getContext(
    {
      NODE_ENV: 'test',
      SLACK_TOKEN: 'st',
      SLACK_CHANNEL: 'sc',
      DYNAMO_TABLE: 'dt'
    },
    eventStub,
    lambdaContextStub
  );
  t.is(aws.dynamodbTable, 'dt');
  t.is(slack.channel, 'sc');
  t.is(slack.token, 'st');
});
test('getConfig with expected arguments return promisified clients (mocked)', async t => {
  const {aws, slack} = await getContext(
    {
      NODE_ENV: 'test',
      SLACK_TOKEN: 'st',
      SLACK_CHANNEL: 'sc',
      DYNAMO_TABLE: 'dt'
    },
    eventStub,
    {
      slack: {chat: {someMethod: () => 'slack'}},
      dynamoDocClient: {putAsync: () => 'dynamo'},
      codepipeline: {getPipelineExecutionAsync: () => 'codepipeline'}
    }
  );
  t.is(typeof aws.dynamoDocClient.putAsync, 'function');
  t.is(typeof aws.codepipeline.getPipelineExecutionAsync, 'function');
  t.is(typeof slack.web.chat.someMethod, 'function');
});

test('getConfig with expected arguments return expected values from event', async t => {
  const context = await getContext(
    {
      NODE_ENV: 'test',
      SLACK_TOKEN: 'st',
      SLACK_CHANNEL: 'sc',
      DYNAMO_TABLE: 'dt'
    },
    eventStub,
    {
      slack: {chat: {someMethod: () => 'slack'}},
      dynamoDocClient: {putAsync: () => 'dynamo'},
      codepipeline: {getPipelineExecutionAsync: () => 'codepipeline'}
    }
  );
  t.deepEqual(context.event, {
    event: eventStub,
    env: 'production',
    projectName: 'my-project',
    pipelineName: 'my-org-codepipeline-my-project',
    executionId: 'eid',
    pipelineData: 'codepipeline',
    link:
      'https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/my-org-codepipeline-my-project'
  });
});
