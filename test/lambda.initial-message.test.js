const test = require('ava');
const Promise = require('bluebird');
const {handleInitialMessage} = require('../lambda/aws-slack-codepipeline-watch');

test('handleInitialMessage create two slack message and a dynamo record', async t => {
  t.plan(11);
  let originalMessage;
  const context = {
    event: {
      event: {detail: {pipeline: 'codepipeline-test', state: 'STARTED'}},
      env: 'production',
      projectName: 'test',
      pipelineName: 'codepipeline-test',
      executionId: 'eid',
      pipelineData: 'codepipeline',
      link:
        'https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test'
    },
    aws: {
      codepipeline: {
        getPipelineAsync(params) {
          return Promise.resolve({pipeline: `pipeline ${params.name}`});
        }
      },
      dynamodbTable: 'CodepipelineWatch',
      dynamoDocClient: {
        putAsync(params) {
          t.is(params.TableName, 'CodepipelineWatch');
          t.is(params.Item.projectName, 'test');
          t.is(params.Item.slackThreadTs, 'ts');
          t.deepEqual(params.Item.originalMessage, originalMessage);
          t.is(params.Item.codepipelineDetails, 'pipeline codepipeline-test');
        }
      }
    },
    slack: {
      channel: '#deploys-channel-id',
      web: {
        chat: {
          postMessage(params) {
            t.is(params.channel, '#deploys-channel-id');
            if (params.thread_ts) {
              t.is(params.thread_ts, 'ts');
              t.is(
                params.text,
                '`execution-id`: <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test/history|eid>'
              );
              return Promise.resolve({message: {ts: 'eid-ts'}});
            } else {
              originalMessage = params.attachments;
              t.deepEqual(params.attachments, [
                {
                  color: '#38d',
                  mrkdwn_in: ['text'],
                  text:
                    'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                  title: 'test (production)'
                }
              ]);
              return Promise.resolve({message: {ts: 'ts'}});
            }
          }
        }
      }
    }
  };
  const res = await handleInitialMessage(context);
  t.is(res, 'Message Acknowledge');
});
