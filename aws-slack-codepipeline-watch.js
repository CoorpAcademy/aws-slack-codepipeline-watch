const {WebClient} = require('@slack/client');
const AWS = require('aws-sdk');
const Promise = require('bluebird');

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

exports.handler = async (event, context) => {
  if (event.source !== 'aws.codepipeline')
    throw new Error(`Called from wrong source ${event.source}`);

  const pipelineName = event.detail.pipeline;
  const pipelineExecutionId = event.detail['execution-id'];

  const pipelineData = await codepipeline.getPipelineExecutionAsync({
    pipelineExecutionId,
    pipelineName
  });

  const artifactRevision = pipelineData.pipelineExecution.artifactRevisions[0];
  const commitId = artifactRevision && artifactRevision.revisionId;
  const shortCommitId = commitId && commitId.slice(0, 8);
  const commitMessage = artifactRevision && artifactRevision.revisionSummary;
  const commitUrl = artifactRevision && artifactRevision.revisionUrl;
  const env = /staging/.test(pipelineName) ? 'staging' : 'production';
  const projectName = /codepipeline-(.*)/.exec(pipelineName)[1];
  const link = `https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/${pipelineName}`;
  const details = `commit \`<${commitUrl}|${shortCommitId}>\`\n> ${commitMessage}
_(\`execution-id\`: <${link}/history|${pipelineExecutionId}>)_`;
  let title, text;
  if (EVENT_TYPES.pipeline === event['detail-type']) {
    text = `Deployment just *${event.detail.state.toLowerCase()}* <${link}|🔗>`;
    title = `${projectName} (${env})`;
  } else if (EVENT_TYPES.stage === event['detail-type']) {
    text = `Stage *${event.detail.stage}* just *${event.detail.state.toLowerCase()}*`;
  } else if (EVENT_TYPES.action === event['detail-type']) {
    text = `Action *${event.detail.action}* just *${event.detail.state.toLowerCase()}*`;
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
    await docClient.putAsync({
      TableName: dynamodbTable,
      Item: {
        projectName,
        executionId: pipelineExecutionId,
        slackThreadTs: slackPostedMessage.message.ts,
        originalMessage: attachments,
        resolvedCommit: false
      }
    });

    return 'Message Acknowledge';
  } else {
    const params = {
      TableName: dynamodbTable,
      Key: {projectName, executionId: pipelineExecutionId}
    };

    const doc = await docClient.getAsync(params);
    if (doc.Item && !doc.Item.resolvedCommit && artifactRevision) {
      await docClient.updateAsync({
        TableName: dynamodbTable,
        Key: {projectName, executionId: pipelineExecutionId},
        UpdateExpression: 'set #a = true',
        ExpressionAttributeNames: {'#a': 'resolvedCommit'}
      });
      return Promise.all([
        web.chat.update({
          as_user: true,
          channel,
          attachments: [
            ...doc.Item.originalMessage,
            {
              text: details,
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
    return 'Acknoledge Event';
  }
};
