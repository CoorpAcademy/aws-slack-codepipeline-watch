const test = require('ava');
const Promise = require('bluebird');
const {handler} = require('../lambda/aws-slack-codepipeline-watch');
const codepipelineData = require('./fixtures/codepipeline-data');
const githubCommitDetails = require('./fixtures/github-commit-details');
const {awsPromise} = require('./utils');

const codepipelineExecutionWithoutArtefact = {
  pipelineExecution: {
    pipelineName: 'codepipeline-test',
    pipelineVersion: 1,
    pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
    status: 'Running',
    artifactRevisions: []
  }
};
const codepipelineExecutionWithArtefact = {
  pipelineExecution: {
    pipelineName: 'codepipeline-test',
    pipelineVersion: 1,
    pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
    status: 'Running',
    artifactRevisions: [
      {
        name: 'source',
        revisionId: 'ea42d3e8f8696860db721b7519b8eadd8a70f270',
        revisionChangeIdentifier: '2018-06-07T16:33:00Z',
        revisionSummary: 'Message Commit',
        created: '2018-06-07T16:33:00.000Z',
        revisionUrl:
          'https://github.com/CoorpAcademy/myrepo/commit/ea42d3e8f8696860db721b7519b8eadd8a70f270'
      }
    ]
  }
};

const commitDetails = {
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
  stats: {
    additions: 1,
    deletions: 2,
    total: 3
  }
};

process.env.SLACK_TOKEN = 'slackToken';
process.env.SLACK_CHANNEL = 'slackChannel';
process.env.DYNAMO_TABLE = 'dynamoTable';

test('lambda handler process correctly original pipeline message', async t => {
  t.plan(6);
  const event = {
    version: '0',
    id: 'CWE-event-id',
    'detail-type': 'CodePipeline Pipeline Execution State Change',
    source: 'aws.codepipeline',
    account: '123456789012',
    time: '2017-04-22T03:31:47Z',
    region: 'us-east-1',
    resources: ['arn:aws:codepipeline:us-east-1:123456789012:pipeline:myPipeline'],
    detail: {
      pipeline: 'codepipeline-test',
      version: '1',
      state: 'STARTED',
      'execution-id': '01234567-0123-0123-0123-012345678901'
    }
  };
  const falseContext = {
    codepipeline: {
      getPipelineExecution: params => {
        t.deepEqual(params, {
          pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
          pipelineName: 'codepipeline-test'
        });
        return awsPromise(codepipelineExecutionWithoutArtefact);
      },
      getPipeline: params => {
        t.deepEqual(params, {
          name: 'codepipeline-test'
        });
        return awsPromise(codepipelineData);
      }
    },
    dynamoDocClient: {
      put(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Item: {
            Lock: false,
            commitDetails: null,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: [],
            lastActionType: null,
            currentStage: null,
            executionId: '01234567-0123-0123-0123-012345678901',
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {},
            projectName: 'test',
            slackThreadTs: 'timestamp',
            threadTimeStamp: ['timestamp']
          }
        });
        return awsPromise();
      }
    },
    slack: {
      chat: {
        postMessage(params) {
          if (params.thread_ts) {
            t.deepEqual(params, {
              as_user: true,
              channel: 'slackChannel',
              text:
                '`execution-id`: <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test/history|01234567-0123-0123-0123-012345678901>',
              thread_ts: 'timestamp'
            });
          } else {
            t.deepEqual(params, {
              as_user: true,
              attachments: [
                {
                  color: '#38d',
                  mrkdwn_in: ['text'],
                  text:
                    'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                  title: 'test (production)'
                }
              ],
              channel: 'slackChannel'
            });
          }
          return Promise.resolve({message: {ts: 'timestamp'}});
        }
      }
    }
  };

  const res = await handler(event, falseContext);
  t.is(res, 'Message Acknowledge');
});

test('lambda handler process correctly another stage message, the first with commit', async t => {
  t.plan(6);
  process.env.GITHUB_AUTH_TOKEN = 'tokenstub';
  const event = {
    version: '0',
    id: 'CWE-event-id',
    'detail-type': 'CodePipeline Stage Execution State Change',
    source: 'aws.codepipeline',
    account: '123456789012',
    time: '2017-04-22T03:31:47Z',
    region: 'us-east-1',
    resources: ['arn:aws:codepipeline:us-east-1:123456789012:pipeline:myPipeline'],
    detail: {
      pipeline: 'codepipeline-test',
      version: '1',
      'execution-id': '01234567-0123-0123-0123-012345678901',
      stage: 'Tests',
      state: 'STARTED'
    }
  };
  const falseContext = {
    codepipeline: {
      getPipelineExecution: params => {
        t.deepEqual(params, {
          pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
          pipelineName: 'codepipeline-test'
        });
        return awsPromise(codepipelineExecutionWithArtefact);
      },
      getPipeline: params => {
        t.deepEqual(params, {
          name: 'codepipeline-test'
        });
        return awsPromise(codepipelineData);
      }
    },
    dynamoDocClient: {
      put(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Item: {
            Lock: false,
            commitDetails,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: {actions: [], noStartedAction: true, runOrder: 1},
            currentStage: 'Tests',
            executionId: '01234567-0123-0123-0123-012345678901',
            lastActionType: undefined,
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {},
            projectName: 'test',
            slackThreadTs: 'timestamp',
            threadTimeStamp: ['some-ts', 'timestamp']
          }
        });
        return awsPromise();
      },
      update(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Key: {projectName: 'test', executionId: '01234567-0123-0123-0123-012345678901'},
          UpdateExpression: 'SET #lock = :lock',
          ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
          ExpressionAttributeNames: {'#lock': 'Lock'},
          ExpressionAttributeValues: {':lock': true, ':unlocked': false},
          ReturnValues: 'ALL_NEW'
        });
        return awsPromise({
          Attributes: {
            Lock: false,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: [],
            currentStage: null,
            executionId: '01234567-0123-0123-0123-012345678901',
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {},
            projectName: 'test',
            slackThreadTs: 'timestamp',
            threadTimeStamp: ['some-ts']
          }
        });
      }
    },
    request: (param, callback) => {
      callback(null, {statusCode: 200}, JSON.stringify(githubCommitDetails));
    },
    slack: {
      chat: {
        postMessage(params) {
          t.deepEqual(params, {
            as_user: true,
            attachments: [
              {
                color: '#4d90d4',
                mrkdwn_in: ['text'],
                text: '🔬 Stage *Tests* just *started*',
                title: undefined
              }
            ],
            channel: 'slackChannel',
            thread_ts: 'timestamp'
          });
          return Promise.resolve({message: {ts: 'timestamp'}});
        },
        // §FIXME not called since updateMessage was disabled
        update(params) {
          t.deepEqual(params, {
            as_user: true,
            attachments: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              },
              {
                author_icon: 'https://github.com/github.png?size=16',
                author_link: 'https://github.com/CoorpAcademy/my-repo',
                author_name: 'Github CoorpAcademy/my-repo',
                color: '#dddddd',
                fields: [
                  {
                    short: true,
                    title: 'Commit',
                    value:
                      '`<https://github.com/CoorpAcademy/myrepo/commit/ea42d3e8f8696860db721b7519b8eadd8a70f270|ea42d3e8>`'
                  },
                  {
                    short: true,
                    title: 'Author',
                    value: '_<https://github.com/AdrieanKhisbe|AdrieanKhisbe>_'
                  }
                ],
                footer: 'Message Commit',
                footer_icon: 'https://github.com/AdrieanKhisbe.png?size=16',
                mrkdwn_in: ['text', 'fields']
              },
              {
                color: '#6a9fd4',
                mrkdwn_in: ['text'],
                text: '🔬 Stage *_Tests_* started, now in progress'
              }
            ],
            channel: 'slackChannel',
            ts: 'timestamp'
          });
        }
      }
    }
  };

  const res = await handler(event, falseContext);
  t.is(res, 'Acknoledge Event');
});

test('lambda handler store a message it cannot process', async t => {
  t.plan(4);
  const event = {
    version: '0',
    id: 'CWE-event-id',
    'detail-type': 'CodePipeline Action Execution State Change',
    source: 'aws.codepipeline',
    account: '123456789012',
    time: '2017-04-22T03:31:47Z',
    region: 'us-east-1',
    resources: ['arn:aws:codepipeline:us-east-1:123456789012:pipeline:myPipeline'],
    detail: {
      pipeline: 'codepipeline-test',
      version: '1',
      'execution-id': '01234567-0123-0123-0123-012345678901',
      stage: 'Tests',
      action: 'Lint',
      state: 'SUCCEEDED'
    }
  };
  const falseContext = {
    codepipeline: {
      getPipelineExecution: params => {
        t.deepEqual(params, {
          pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
          pipelineName: 'codepipeline-test'
        });
        return awsPromise(codepipelineExecutionWithArtefact);
      },
      getPipeline: params => {
        t.deepEqual(params, {
          name: 'codepipeline-test'
        });
        return awsPromise(codepipelineData);
      }
    },
    dynamoDocClient: {
      put(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Item: {
            Lock: false,
            commitDetails,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: {actions: [], noStartedAction: true, runOrder: 1},
            currentStage: 'Tests',
            executionId: '01234567-0123-0123-0123-012345678901',
            lastActionType: 'Test',
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {'action:SUCCEEDED:Tests:Lint:1': '2017-04-22T03:31:47Z'},
            projectName: 'test',
            slackThreadTs: 'timestamp'
          }
        });
        return awsPromise();
      },
      update(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Key: {projectName: 'test', executionId: '01234567-0123-0123-0123-012345678901'},
          UpdateExpression: 'SET #lock = :lock',
          ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
          ExpressionAttributeNames: {'#lock': 'Lock'},
          ExpressionAttributeValues: {':lock': true, ':unlocked': false},
          ReturnValues: 'ALL_NEW'
        });
        return awsPromise({
          Attributes: {
            Lock: false,
            commitDetails,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: {actions: [], noStartedAction: true, runOrder: 1},
            currentStage: 'Tests',
            executionId: '01234567-0123-0123-0123-012345678901',
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {},
            projectName: 'test',
            slackThreadTs: 'timestamp'
          }
        });
      }
    },
    github: {token: 'tokenstub'},
    slack: {
      chat: {
        postMessage(params) {
          t.deepEqual(params, {
            as_user: true,
            attachments: [
              {
                color: '#4d90d4',
                mrkdwn_in: ['text'],
                text: 'Stage *Tests* just *started*',
                title: undefined
              }
            ],
            channel: 'slackChannel',
            thread_ts: 'timestamp'
          });
        },
        update(params) {
          t.deepEqual(params, {
            as_user: true,
            attachments: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              },
              {
                mrkdwn_in: ['text'],
                text:
                  'commit `<https://github.com/CoorpAcademy/myrepo/commit/ea42d3e8f8696860db721b7519b8eadd8a70f270|ea42d3e8>`\n> Message Commit'
              }
            ],
            channel: 'slackChannel',
            ts: 'timestamp'
          });
        }
      }
    }
  };

  const res = await handler(event, falseContext);
  t.is(res, 'Acknoledge Event');
});

test('lambda handler unpile a message it can now process', async t => {
  t.plan(6);
  let nbCallSlackPost = 0;
  const event = {
    version: '0',
    id: 'CWE-event-id',
    'detail-type': 'CodePipeline Action Execution State Change',
    source: 'aws.codepipeline',
    account: '123456789012',
    time: '2017-04-22T03:31:47Z',
    region: 'us-east-1',
    resources: ['arn:aws:codepipeline:us-east-1:123456789012:pipeline:myPipeline'],
    detail: {
      pipeline: 'codepipeline-test',
      version: '1',
      'execution-id': '01234567-0123-0123-0123-012345678901',
      stage: 'Tests',
      action: 'Lint',
      state: 'STARTED'
    }
  };
  const falseContext = {
    codepipeline: {
      getPipelineExecution: params => {
        t.deepEqual(params, {
          pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
          pipelineName: 'codepipeline-test'
        });
        return awsPromise(codepipelineExecutionWithArtefact);
      },
      getPipeline: params => {
        t.deepEqual(params, {
          name: 'codepipeline-test'
        });
        return awsPromise(codepipelineData);
      }
    },
    dynamoDocClient: {
      put(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Item: {
            Lock: false,
            commitDetails,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: {actions: [], noStartedAction: false, runOrder: 2},
            currentStage: 'Tests',
            lastActionType: 'Test',
            executionId: '01234567-0123-0123-0123-012345678901',
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {},
            projectName: 'test',
            slackThreadTs: 'timestamp',
            threadTimeStamp: ['some-ts', 'yats-1', 'yats-2']
          }
        });
        return awsPromise();
      },
      update(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Key: {projectName: 'test', executionId: '01234567-0123-0123-0123-012345678901'},
          UpdateExpression: 'SET #lock = :lock',
          ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
          ExpressionAttributeNames: {'#lock': 'Lock'},
          ExpressionAttributeValues: {':lock': true, ':unlocked': false},
          ReturnValues: 'ALL_NEW'
        });
        return awsPromise({
          Attributes: {
            Lock: false,
            commitDetails,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: {actions: [], noStartedAction: true, runOrder: 1},
            currentStage: 'Tests',
            executionId: '01234567-0123-0123-0123-012345678901',
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {'action:SUCCEEDED:Tests:Lint:1': '2017-04-22T03:31:47Z'},
            projectName: 'test',
            slackThreadTs: 'timestamp',
            threadTimeStamp: ['some-ts']
          }
        });
      }
    },
    github: {token: 'tokenstub'},
    slack: {
      chat: {
        postMessage(params) {
          nbCallSlackPost++;
          if (nbCallSlackPost === 1) {
            t.deepEqual(params, {
              as_user: true,
              attachments: [
                {
                  color: '#6a9fd4',
                  mrkdwn_in: ['text'],
                  text: '>🔬 Action *Lint* _(stage *Tests* *[1/2]*)_ just *started*',
                  title: undefined
                }
              ],
              channel: 'slackChannel',
              thread_ts: 'timestamp'
            });
          } else {
            t.deepEqual(params, {
              as_user: true,
              attachments: [
                {
                  color: '#54c869',
                  mrkdwn_in: ['text'],
                  text: '>🔬 Action *Lint* _(stage *Tests* *[1/2]*)_ just *succeeded*',
                  title: undefined
                }
              ],
              channel: 'slackChannel',
              thread_ts: 'timestamp'
            });
          }
          return Promise.resolve({message: {ts: `yats-${nbCallSlackPost}`}});
        },
        update(params) {
          t.fail();
        }
      }
    }
  };

  const res = await handler(event, falseContext);
  t.is(res, 'Acknoledge Event');
});
test('lambda handler unpile message even if they are simultaneus', async t => {
  t.plan(7);
  let nbCallSlackPost = 0;
  const event = {
    version: '0',
    id: 'CWE-event-id',
    'detail-type': 'CodePipeline Action Execution State Change',
    source: 'aws.codepipeline',
    account: '123456789012',
    time: '2017-04-22T03:333:47Z',
    region: 'us-east-1',
    resources: ['arn:aws:codepipeline:us-east-1:123456789012:pipeline:myPipeline'],
    detail: {
      pipeline: 'codepipeline-test',
      version: '1',
      'execution-id': '01234567-0123-0123-0123-012345678901',
      stage: 'Tests',
      action: 'Lint',
      state: 'STARTED'
    }
  };
  const falseContext = {
    codepipeline: {
      getPipelineExecution: params => {
        t.deepEqual(params, {
          pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
          pipelineName: 'codepipeline-test'
        });
        return awsPromise(codepipelineExecutionWithArtefact);
      },
      getPipeline: params => {
        t.deepEqual(params, {
          name: 'codepipeline-test'
        });
        return awsPromise(codepipelineData);
      }
    },
    github: {token: 'tokenstub'},
    dynamoDocClient: {
      put(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Item: {
            Lock: false,
            commitDetails,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: {actions: ['Tests'], noStartedAction: false, runOrder: 2},
            currentStage: 'Tests',
            executionId: '01234567-0123-0123-0123-012345678901',
            lastActionType: 'Test',
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {},
            projectName: 'test',
            slackThreadTs: 'timestamp',
            threadTimeStamp: ['some-ts', 'ts-1', 'ts-2', 'ts-3']
          }
        });
        return awsPromise();
      },
      update(params) {
        t.deepEqual(params, {
          TableName: 'dynamoTable',
          Key: {projectName: 'test', executionId: '01234567-0123-0123-0123-012345678901'},
          UpdateExpression: 'SET #lock = :lock',
          ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
          ExpressionAttributeNames: {'#lock': 'Lock'},
          ExpressionAttributeValues: {':lock': true, ':unlocked': false},
          ReturnValues: 'ALL_NEW'
        });
        return awsPromise({
          Attributes: {
            Lock: false,
            commitDetails,
            codepipelineDetails: codepipelineData.pipeline,
            currentActions: {actions: [], noStartedAction: true, runOrder: 1},
            currentStage: 'Tests',
            executionId: '01234567-0123-0123-0123-012345678901',
            originalMessage: [
              {
                color: '#38d',
                mrkdwn_in: ['text'],
                text:
                  'Deployment just *started* <https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/codepipeline-test|🔗>',
                title: 'test (production)'
              }
            ],
            pendingMessages: {
              'action:STARTED:Tests:Tests:2': '2017-04-22T03:31:47Z',
              'action:SUCCEEDED:Tests:Lint:1': '2017-04-22T03:31:47Z'
            },
            projectName: 'test',
            slackThreadTs: 'timestamp',
            threadTimeStamp: ['some-ts']
          }
        });
      }
    },
    slack: {
      chat: {
        postMessage(params) {
          nbCallSlackPost++;
          if (nbCallSlackPost === 1) {
            t.deepEqual(params, {
              as_user: true,
              attachments: [
                {
                  color: '#6a9fd4',
                  mrkdwn_in: ['text'],
                  text: '>🔬 Action *Lint* _(stage *Tests* *[1/2]*)_ just *started*',
                  title: undefined
                }
              ],
              channel: 'slackChannel',
              thread_ts: 'timestamp'
            });
          } else if (nbCallSlackPost === 2) {
            t.deepEqual(params, {
              as_user: true,
              attachments: [
                {
                  color: '#54c869',
                  mrkdwn_in: ['text'],
                  text: '>🔬 Action *Lint* _(stage *Tests* *[1/2]*)_ just *succeeded*',
                  title: undefined
                }
              ],
              channel: 'slackChannel',
              thread_ts: 'timestamp'
            });
          } else {
            t.deepEqual(params, {
              as_user: true,
              attachments: [
                {
                  color: '#6a9fd4',
                  mrkdwn_in: ['text'],
                  text: '>🔬 Action *Tests* _(stage *Tests* *[2/2]*)_ just *started*',
                  title: undefined
                }
              ],
              channel: 'slackChannel',
              thread_ts: 'timestamp'
            });
          }
          return Promise.resolve({message: {ts: `ts-${nbCallSlackPost}`}});
        },
        update(params) {
          t.fail();
        }
      }
    }
  };

  const res = await handler(event, falseContext);
  t.is(res, 'Acknoledge Event');
});
