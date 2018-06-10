const {describe} = require('ava-spec');
const Promise = require('bluebird');
const {handleEvent} = require('../aws-slack-codepipeline-watch');

describe('handleEvent', it => {
  it('handle pipeline message', async t => {
    t.plan(6);
    const originalMessage = [{text: 'toto'}];
    const context = {
      event: {
        projectName: 'test',
        env: 'production',
        link:
          'https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test'
      },
      record: {},
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
              return Promise.resolve();
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
  });
  it('handle stage message', async t => {
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
                  text: 'Stage *secondStage* just *succeeded*',
                  title: undefined
                }
              ]);
              return Promise.resolve();
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
                    text: 'Stage _secondStage_ succeeded, waiting for the next stage to start'
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
      stage: 'secondStage'
    });
    t.not(res, true);
  });
  it('handle action message', async t => {
    t.plan(4);
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
                  text: '> Action *secondAction* _(stage *secondStage* *[2/2]*)_ just *succeeded*',
                  title: undefined
                }
              ]);
              return Promise.resolve();
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
      stage: 'secondStage',
      action: 'secondAction',
      runOrder: 2
    });
    t.not(res, true);
  });
});
