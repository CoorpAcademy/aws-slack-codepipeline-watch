const {describe} = require('ava-spec');
const Promise = require('bluebird');
const {handler} = require('../aws-slack-codepipeline-watch');

const codepipelineData = {
  pipeline: {
    name: 'codepipeline-test',
    roleArn: 'arn:aws:iam::446570804799:role/ecs-staging-CodePipelineServiceRole-RA8QX37QF7OM',
    artifactStore: {
      type: 'S3',
      location: 'some-buildbucket-uj497f6bne6c'
    },
    stages: [
      {
        name: 'Source',
        actions: [
          {
            name: 'source',
            actionTypeId: {
              category: 'Source',
              owner: 'ThirdParty',
              provider: 'GitHub',
              version: '1'
            },
            runOrder: 1,
            configuration: {
              Branch: 'develop',
              OAuthToken: '****',
              Owner: 'CoorpAcademy',
              Repo: 'my-repo'
            },
            outputArtifacts: [
              {
                name: 'source'
              }
            ],
            inputArtifacts: []
          }
        ]
      },
      {
        name: 'Install',
        actions: [
          {
            name: 'Install',
            actionTypeId: {
              category: 'Build',
              owner: 'AWS',
              provider: 'CodeBuild',
              version: '1'
            },
            runOrder: 1,
            configuration: {
              ProjectName: 'codebuild-test-Install'
            },
            outputArtifacts: [],
            inputArtifacts: [
              {
                name: 'source'
              }
            ]
          }
        ]
      },
      {
        name: 'Tests',
        actions: [
          {
            name: 'Lint',
            actionTypeId: {
              category: 'Test',
              owner: 'AWS',
              provider: 'CodeBuild',
              version: '1'
            },
            runOrder: 1,
            configuration: {
              ProjectName: 'codebuild-test-lint'
            },
            outputArtifacts: [],
            inputArtifacts: [
              {
                name: 'source'
              }
            ]
          },
          {
            name: 'Tests',
            actionTypeId: {
              category: 'Test',
              owner: 'AWS',
              provider: 'CodeBuild',
              version: '1'
            },
            runOrder: 2,
            configuration: {
              ProjectName: 'codebuild-test-test'
            },
            outputArtifacts: [],
            inputArtifacts: [
              {
                name: 'source'
              }
            ]
          }
        ]
      }
    ],
    version: 1
  },
  metadata: {
    pipelineArn: 'arn:aws:codepipeline:eu-west-1:446570804799:coorp-staging-codepipeline-store',
    created: '2018-06-08T08:38:22.510Z',
    updated: '2018-06-08T08:38:22.510Z'
  }
};

describe('lambda handler', it => {
  process.env.SLACK_TOKEN = 'slackToken';
  process.env.SLACK_CHANNEL = 'slackChannel';
  process.env.DYNAMO_TABLE = 'dynamoTable';

  it('process correctly original pipeline message', async t => {
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
        getPipelineExecutionAsync: params => {
          t.deepEqual(params, {
            pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
            pipelineName: 'codepipeline-test'
          });
          return Promise.resolve({});
        },
        getPipelineAsync: params => {
          t.deepEqual(params, {
            name: 'codepipeline-test'
          });
          return Promise.resolve({});
        }
      },
      dynamoDocClient: {
        putAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Item: {
              Lock: false,
              codepipelineDetails: undefined,
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
              resolvedCommit: false,
              slackThreadTs: 'timestamp'
            }
          });
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
              return Promise.resolve({message: {ts: 'timestamp'}});
            }
          }
        }
      }
    };

    const res = await handler(event, falseContext);
    t.is(res, 'Message Acknowledge');
  });

  it('process correctly another stage message, the first with commit', async t => {
    t.plan(6);
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
        getPipelineExecutionAsync: params => {
          t.deepEqual(params, {
            pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
            pipelineName: 'codepipeline-test'
          });
          return Promise.resolve({
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
          });
        },
        getPipelineAsync: params => {
          t.deepEqual(params, {
            name: 'codepipeline-test'
          });
          return Promise.resolve(codepipelineData);
        }
      },
      dynamoDocClient: {
        putAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Item: {
              Lock: false,
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
              resolvedCommit: true,
              slackThreadTs: 'timestamp'
            }
          });
        },
        updateAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Key: {projectName: 'test', executionId: '01234567-0123-0123-0123-012345678901'},
            UpdateExpression: 'SET #lock = :lock',
            ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
            ExpressionAttributeNames: {'#lock': 'Lock'},
            ExpressionAttributeValues: {':lock': true, ':unlocked': false},
            ReturnValues: 'ALL_NEW'
          });
          return Promise.resolve({
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
              resolvedCommit: false,
              slackThreadTs: 'timestamp'
            }
          });
        }
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

  it('store a message it cannot process', async t => {
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
        getPipelineExecutionAsync: params => {
          t.deepEqual(params, {
            pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
            pipelineName: 'codepipeline-test'
          });
          return Promise.resolve({
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
          });
        },
        getPipelineAsync: params => {
          t.deepEqual(params, {
            name: 'codepipeline-test'
          });
          return Promise.resolve(codepipelineData);
        }
      },
      dynamoDocClient: {
        putAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Item: {
              Lock: false,
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
              resolvedCommit: true,
              slackThreadTs: 'timestamp'
            }
          });
        },
        updateAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Key: {projectName: 'test', executionId: '01234567-0123-0123-0123-012345678901'},
            UpdateExpression: 'SET #lock = :lock',
            ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
            ExpressionAttributeNames: {'#lock': 'Lock'},
            ExpressionAttributeValues: {':lock': true, ':unlocked': false},
            ReturnValues: 'ALL_NEW'
          });
          return Promise.resolve({
            Attributes: {
              Lock: false,
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
              resolvedCommit: true,
              slackThreadTs: 'timestamp'
            }
          });
        }
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

  it('unpile a message it can now process', async t => {
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
        getPipelineExecutionAsync: params => {
          t.deepEqual(params, {
            pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
            pipelineName: 'codepipeline-test'
          });
          return Promise.resolve({
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
          });
        },
        getPipelineAsync: params => {
          t.deepEqual(params, {
            name: 'codepipeline-test'
          });
          return Promise.resolve(codepipelineData);
        }
      },
      dynamoDocClient: {
        putAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Item: {
              Lock: false,
              codepipelineDetails: codepipelineData.pipeline,
              currentActions: {actions: [], noStartedAction: false, runOrder: 2},
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
              resolvedCommit: true,
              slackThreadTs: 'timestamp'
            }
          });
        },
        updateAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Key: {projectName: 'test', executionId: '01234567-0123-0123-0123-012345678901'},
            UpdateExpression: 'SET #lock = :lock',
            ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
            ExpressionAttributeNames: {'#lock': 'Lock'},
            ExpressionAttributeValues: {':lock': true, ':unlocked': false},
            ReturnValues: 'ALL_NEW'
          });
          return Promise.resolve({
            Attributes: {
              Lock: false,
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
              resolvedCommit: true,
              slackThreadTs: 'timestamp'
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
                    text: '> Action *Lint* _(stage *Tests* *[1/2]*)_ just *started*',
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
                    text: '> Action *Lint* _(stage *Tests* *[1/2]*)_ just *succeeded*',
                    title: undefined
                  }
                ],
                channel: 'slackChannel',
                thread_ts: 'timestamp'
              });
            }
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
  it('unpile message even if they are simultaneus', async t => {
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
        getPipelineExecutionAsync: params => {
          t.deepEqual(params, {
            pipelineExecutionId: '01234567-0123-0123-0123-012345678901',
            pipelineName: 'codepipeline-test'
          });
          return Promise.resolve({
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
          });
        },
        getPipelineAsync: params => {
          t.deepEqual(params, {
            name: 'codepipeline-test'
          });
          return Promise.resolve(codepipelineData);
        }
      },
      dynamoDocClient: {
        putAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Item: {
              Lock: false,
              codepipelineDetails: codepipelineData.pipeline,
              currentActions: {actions: ['Tests'], noStartedAction: false, runOrder: 2},
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
              resolvedCommit: true,
              slackThreadTs: 'timestamp'
            }
          });
        },
        updateAsync(params) {
          t.deepEqual(params, {
            TableName: 'dynamoTable',
            Key: {projectName: 'test', executionId: '01234567-0123-0123-0123-012345678901'},
            UpdateExpression: 'SET #lock = :lock',
            ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
            ExpressionAttributeNames: {'#lock': 'Lock'},
            ExpressionAttributeValues: {':lock': true, ':unlocked': false},
            ReturnValues: 'ALL_NEW'
          });
          return Promise.resolve({
            Attributes: {
              Lock: false,
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
              resolvedCommit: true,
              slackThreadTs: 'timestamp'
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
                    text: '> Action *Lint* _(stage *Tests* *[1/2]*)_ just *started*',
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
                    text: '> Action *Lint* _(stage *Tests* *[1/2]*)_ just *succeeded*',
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
                    text: '> Action *Tests* _(stage *Tests* *[2/2]*)_ just *started*',
                    title: undefined
                  }
                ],
                channel: 'slackChannel',
                thread_ts: 'timestamp'
              });
            }
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
});
