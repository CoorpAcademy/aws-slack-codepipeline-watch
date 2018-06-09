const {describe} = require('ava-spec');
const {getConfig} = require('../aws-slack-codepipeline-watch');

describe('getConfig without expected arguments', it => {
  it('does throw when no SLACK_TOKEN', t => {
    t.throws(
      () => getConfig({DYNAMO_TABLE: 'dbt', SLACK_CHANNEL: 'sc'}),
      'Need a valid token defined in SLACK_TOKEN'
    );
  });
  it('does throw when no SLACK_CHANNEL', t => {
    t.throws(() =>
      getConfig(
        {DYNAMO_TABLE: 'dbt', SLACK_TOKEN: 'st'},
        'Need a valid chanel defined in SLACK_CHANNEL'
      )
    );
  });
  it('does throw when no DYNAMO_TABLE', t => {
    t.throws(
      () => getConfig({SLACK_TOKEN: 'st', SLACK_CHANNEL: 'sc'}),
      'Need a valid table defined in DYNAMO_TABLE'
    );
  });
});

describe('getConfig with expected arguments', it => {
  it('return expected config', t => {
    const {aws, slack} = getConfig({SLACK_TOKEN: 'st', SLACK_CHANNEL: 'sc', DYNAMO_TABLE: 'dt'});
    t.is(aws.dynamodbTable, 'dt');
    t.is(slack.channel, 'sc');
    t.is(slack.token, 'st');
  });
  it('return promisified clients', t => {
    const {aws, slack} = getConfig({SLACK_TOKEN: 'st', SLACK_CHANNEL: 'sc', DYNAMO_TABLE: 'dt'});
    t.is(typeof aws.dynamoDocClient.putAsync, 'function');
    t.is(typeof slack.web.chat.postMessage, 'function');
    t.is(typeof slack.web.chat.update, 'function');
  });
});
