const test = require('ava');
const {handleEvent} = require('../lambda/aws-slack-codepipeline-watch');
const codepipelineData = require('./fixtures/codepipeline-data');

test('handleEvent handle pipeline message', async t => {
  t.plan(7);
  const originalMessage = [{text: 'toto'}];
  const context = {
    event: {
      projectName: 'test',
      env: 'production',
      link:
        'https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test'
    },
    record: {
      codepipelineDetails: codepipelineData.pipeline,
      threadTimeStamp: ['some-ts']
    },
    executionDetails: {
      commitId: '42',
      commitDetailsMessage: 'co co commit',
      slackThreadTs: 'ts',
      originalMessage
    },
    slack: {
      channel: '#deploys-channel-id',
      web: {
        chat: {
          postMessage(params) {
            t.is(params.channel, '#deploys-channel-id');
            t.is(params.thread_ts, 'ts');
            t.deepEqual(params.attachments, [
              {
                color: '#1b9932',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *succeeded* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ]);
            return Promise.resolve({message: {ts: 'yats'}});
          },
          update(params) {
            t.is(params.channel, '#deploys-channel-id');
            t.is(params.ts, 'ts');
            t.deepEqual(params.attachments, [
              ...originalMessage,
              {
                color: '#36a94b',
                mrkdwn_in: ['text'],
                text: 'co co commit'
              },
              {
                color: '#1b9932',
                mrkdwn_in: ['text'],
                text: 'Operation is now *Completed!*'
              }
            ]);
            return Promise.resolve();
          }
        }
      }
    }
  };
  await handleEvent(context, {
    type: 'pipeline',
    pipeline: 'test',
    state: 'SUCCEEDED'
  });
  t.deepEqual(context.record.threadTimeStamp, ['some-ts', 'yats']);
});
test('handle stage message', async t => {
  t.plan(6);
  const originalMessage = [{text: 'toto'}];
  const context = {
    event: {
      projectName: 'test',
      env: 'production',
      link:
        'https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test'
    },
    record: {
      codepipelineDetails: codepipelineData.pipeline,
      threadTimeStamp: ['some-ts']
    },
    executionDetails: {
      commitId: '4444',
      commitDetailsMessage: 'co co commit',
      slackThreadTs: 'ts',
      originalMessage
    },
    slack: {
      channel: '#deploys-channel-id',
      web: {
        chat: {
          postMessage(params) {
            t.is(params.channel, '#deploys-channel-id');
            t.is(params.thread_ts, 'ts');
            t.deepEqual(params.attachments, [
              {
                color: '#36a94b',
                mrkdwn_in: ['text'],
                text: '🛠 Stage *Install* just *succeeded*',
                title: undefined
              }
            ]);
            return Promise.resolve({message: {ts: 'yats'}});
          },
          update(params) {
            t.deepEqual(params, {
              as_user: true,
              attachments: [
                {
                  text: 'toto'
                },
                {
                  color: '#dddddd',
                  mrkdwn_in: ['text'],
                  text: 'co co commit'
                },
                {
                  color: '#54c869',
                  mrkdwn_in: ['text'],
                  text: '🛠 Stage *_Install_* succeeded, waiting for the next stage to start'
                }
              ],
              channel: '#deploys-channel-id',
              ts: 'ts'
            });
            return Promise.resolve();
          }
        }
      }
    }
  };
  const res = await handleEvent(context, {
    type: 'stage',
    pipeline: 'test',
    state: 'SUCCEEDED',
    stage: 'Install'
  });
  t.not(res, true);
  t.deepEqual(context.record.threadTimeStamp, ['some-ts', 'yats']);
});
test('handleEvent handle action message', async t => {
  t.plan(5);
  const originalMessage = [{text: 'toto'}];
  const context = {
    event: {
      projectName: 'test',
      env: 'production',
      link:
        'https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test'
    },
    executionDetails: {
      commitDetailsMessage: 'co co commit',
      slackThreadTs: 'ts',
      originalMessage,
      nbActionsOfStage: 2
    },
    record: {
      codepipelineDetails: codepipelineData.pipeline,
      threadTimeStamp: ['some-ts']
    },
    slack: {
      channel: '#deploys-channel-id',
      web: {
        chat: {
          postMessage(params) {
            t.is(params.channel, '#deploys-channel-id');
            t.is(params.thread_ts, 'ts');
            t.deepEqual(params.attachments, [
              {
                color: '#54c869',
                mrkdwn_in: ['text'],
                text: '>🛠 Action *Install* _(stage *Install* *[2/2]*)_ just *succeeded*',
                title: undefined
              }
            ]);
            return Promise.resolve({message: {ts: 'yats'}});
          },
          update(params) {
            t.fail();
            return Promise.resolve();
          }
        }
      }
    }
  };
  const res = await handleEvent(context, {
    type: 'action',
    pipeline: 'test',
    state: 'SUCCEEDED',
    stage: 'Install',
    action: 'Install',
    runOrder: 2
  });
  t.deepEqual(context.record.threadTimeStamp, ['some-ts', 'yats']);
  t.not(res, true);
});
