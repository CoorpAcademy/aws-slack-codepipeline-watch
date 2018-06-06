const {WebClient} = require('@slack/client');
const AWS = require('aws-sdk');
const Promise = require('bluebird');
const _ = require('lodash/fp');

const codepipeline = Promise.promisifyAll(new AWS.CodePipeline({apiVersion: '2015-07-09'}));
const docClient = Promise.promisifyAll(new AWS.DynamoDB.DocumentClient({apiVersion: '2012-08-10'}));
const token = process.env.SLACK_TOKEN;
if (!token) throw new Error('Need a valid token defined in SLACK_TOKEN');

const channel = process.env.SLACK_CHANNEL;
if (!channel) throw new Error('Need a valid chanel defined in SLACK_CHANNEL');

const dynamodbTable = process.env.DYNAMO_TABLE;
if (!dynamodbTable) throw new Error('Need a valid chanel defined in DYNAMO_TABLE');

const web = new WebClient(token);

const EVENT_TYPES = {
  pipeline: 'CodePipeline Pipeline Execution State Change',
  stage: 'CodePipeline Stage Execution State Change',
  action: 'CodePipeline Action Execution State Change'
};

const COLOR_CODES = {
  STARTED: '#38d',
  FAILED: '#DC143C',
  SUCCEEDED: '#1b9932',
  SUPERSEDED: '#db7923',
  CANCELED: '#eeeeee',
  RESUMED: '#5eba81'
};

const getStageDetails = (pipelineDetails, stageName) => {
  return _.find({name: stageName}, pipelineDetails.pipeline.stages);
};

exports.handler = async (event, context) => {
  if (event.source !== 'aws.codepipeline')
    throw new Error(`Called from wrong source ${event.source}`);

  const pipelineName = event.detail.pipeline;
  const pipelineExecutionId = event.detail['execution-id'];

  const [pipelineData, pipelineDetails] = await Promise.all([
    codepipeline.getPipelineExecutionAsync({
      pipelineExecutionId,
      pipelineName
    }),
    codepipeline.getPipelineAsync({name: pipelineName})
  ]);

  const artifactRevision = pipelineData.pipelineExecution.artifactRevisions[0];
  const commitId = artifactRevision && artifactRevision.revisionId;
  const shortCommitId = commitId && commitId.slice(0, 8);
  const commitMessage = artifactRevision && artifactRevision.revisionSummary;
  const commitUrl = artifactRevision && artifactRevision.revisionUrl;
  const env = /staging/.test(pipelineName) ? 'staging' : 'production';
  const projectName = /codepipeline-(.*)/.exec(pipelineName)[1];
  const link = `https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/${pipelineName}`;
  const commitDetailsMessage = `commit \`<${commitUrl}|${shortCommitId}>\`\n> ${commitMessage}`;
  const pipelineExectionMessage = `\`execution-id\`: <${link}/history|${pipelineExecutionId}>`;
  const stage = getStageDetails(pipelineDetails, event.detail.stage);
  const nbAction = _.size(_.get('actions', stage));

  let title, text;
  if (EVENT_TYPES.pipeline === event['detail-type']) {
    text = `Deployment just *${event.detail.state.toLowerCase()}* <${link}|🔗>`;
    title = `${projectName} (${env})`;
  } else if (EVENT_TYPES.stage === event['detail-type']) {
    text = `Stage *${event.detail.stage}* just *${event.detail.state.toLowerCase()}*`;
  } else if (EVENT_TYPES.action === event['detail-type']) {
    const actionIndexInStage = _.findIndex({name: event.detail.action}, stage.actions);
    text = `Action *${event.detail.action}* _(stage *${event.detail.stage}* *[${actionIndexInStage +
      1}/${nbAction}]*)_ just *${event.detail.state.toLowerCase()}*`;
  }
  const attachments = [
    {title, text, color: COLOR_CODES[event.detail.state] || '#dddddd', mrkdwn_in: ['text']}
  ];

  if (event.detail.state === 'STARTED' && EVENT_TYPES.pipeline === event['detail-type']) {
    const slackPostedMessage = await web.chat.postMessage({
      as_user: true,
      channel,
      attachments
    });
    await Promise.all([
      docClient.putAsync({
        TableName: dynamodbTable,
        Item: {
          projectName,
          executionId: pipelineExecutionId,
          slackThreadTs: slackPostedMessage.message.ts,
          originalMessage: attachments,
          resolvedCommit: false
        }
      }),
      web.chat.postMessage({
        as_user: true,
        channel,
        text: pipelineExectionMessage,
        thread_ts: slackPostedMessage.message.ts
      })
    ]);

    return 'Message Acknowledge';
  } else {
    if (EVENT_TYPES.action === event['detail-type']) {
      if (nbAction === 1) return 'Message Acknowledge';
    }
    const dynamoParams = {
      TableName: dynamodbTable,
      Key: {projectName, executionId: pipelineExecutionId}
    };

    const getRecord = async params => {
      const record = await docClient.getAsync(params);
      if (record.Item) return record;
      await Promise.delay(500);
      return getRecord(params);
    };
    const doc = await getRecord(dynamoParams);
    if (doc.Item && !doc.Item.resolvedCommit && artifactRevision) {
      await docClient.updateAsync({
        TableName: dynamodbTable,
        Key: {projectName, executionId: pipelineExecutionId},
        UpdateExpression: 'set #resolvedCommit = :resolvedCommit',
        ExpressionAttributeNames: {'#resolvedCommit': 'resolvedCommit'},
        ExpressionAttributeValues: {':resolvedCommit': true}
      });
      return Promise.all([
        web.chat.update({
          as_user: true,
          channel,
          attachments: [
            ...doc.Item.originalMessage,
            {
              text: commitDetailsMessage,
              mrkdwn_in: ['text']
            }
          ],
          ts: doc.Item.slackThreadTs
        }),
        web.chat.postMessage({
          as_user: true,
          channel,
          attachments,
          thread_ts: doc.Item.slackThreadTs
        })
      ]);
    }

    web.chat.postMessage({
      as_user: true,
      channel,
      attachments,
      thread_ts: doc.Item.slackThreadTs
    });
    if (EVENT_TYPES.pipeline === event['detail-type']) {
      const state = event.detail.state;
      // update status
      // STARTED FAILED SUCCEEDED SUPERSEDED CANCELED RESUMED:
      const extraMessage = {
        SUCCEEDED: 'Operation is now *Completed!*',
        RESUMED: "Operation was *Resumed*, it's now in progress",
        CANCELED: 'Operation was *Canceled*',
        SUPERSEDED: 'Operation was *Superseded* while waiting, see next build',
        FAILED: `Operation is in *Failed* Status\nYou can perform a restart <${link}|there 🔗>`
      }[state];
      
      await web.chat.update({
        as_user: true,
        channel,
        attachments: [
          ...doc.Item.originalMessage,
          {
            text: commitDetailsMessage,
            mrkdwn_in: ['text'],
            color: COLOR_CODES[state]
          },
          {
            text: extraMessage,
            mrkdwn_in: ['text'],
            color: COLOR_CODES[state]
          }
        ],
        ts: doc.Item.slackThreadTs
      });
    }

    return 'Acknoledge Event';
  }
};
