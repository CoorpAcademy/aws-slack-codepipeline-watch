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
  FAILED: '#dc143c',
  SUCCEEDED: '#1b9932',
  SUPERSEDED: '#db7923',
  CANCELED: '#bbbbbb',
  RESUMED: '#5eba81',
  pale: {
    STARTED: '#4d90d4',
    FAILED: '#d83354',
    SUCCEEDED: '#36a94b',
    SUPERSEDED: '#db7923',
    CANCELED: '#dcdcdc',
    RESUMED: '#86daa6'
  },
  palest: {
    STARTED: '#6a9fd4',
    FAILED: '#d64c68',
    SUCCEEDED: '#54c869',
    SUPERSEDED: '#db7923',
    CANCELED: '#eeeeee',
    RESUMED: '#a2f5c5'
  }
};

const getStageDetails = (pipelineDetails, stageName) => {
  return _.find({name: stageName}, pipelineDetails.pipeline.stages);
};

const shouldProceed = (event, currentStage, currentActions) => {
  if (event['detail-type'] === EVENT_TYPES.stage) {
    if (event.detail.state === 'STARTED' || event.detail.state === 'RESUMED')
      return [currentStage === null, {currentStage: event.detail.stage, currentActions: []}];
    return [
      _.isEmpty(currentActions) && event.detail.stage === currentStage,
      {currentStage: null, currentActions: []}
    ];
  }
  if (event['detail-type'] === EVENT_TYPES.action) {
    if (event.detail.state === 'STARTED' || event.detail.state === 'RESUMED')
      return [
        _.isEmpty(currentActions) && currentStage === event.detail.stage,
        {currentStage, currentActions: [...currentActions, event.detail.action]}
      ];
    return [
      _.includes(event.detail.action, currentActions),
      {
        currentStage,
        currentActions: _.filter(action => action !== event.detail.action, currentActions)
      }
    ];
  }
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

  const env = /staging/.test(pipelineName) ? 'staging' : 'production';
  const projectName = /codepipeline-(.*)/.exec(pipelineName)[1];
  const link = `https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/${pipelineName}`;

  if (event.detail.state === 'STARTED' && EVENT_TYPES.pipeline === event['detail-type']) {
    const startText = `Deployment just *${event.detail.state.toLowerCase()}* <${link}|🔗>`;
    const startTitle = `${projectName} (${env})`;
    const startAttachments = [
      {title: startTitle, text: startText, color: COLOR_CODES.STARTED, mrkdwn_in: ['text']}
    ];
    const pipelineExectionMessage = `\`execution-id\`: <${link}/history|${pipelineExecutionId}>`;

    const slackPostedMessage = await web.chat.postMessage({
      as_user: true,
      channel,
      attachments: startAttachments
    });
    await Promise.all([
      docClient.putAsync({
        TableName: dynamodbTable,
        Item: {
          projectName,
          executionId: pipelineExecutionId,
          slackThreadTs: slackPostedMessage.message.ts,
          originalMessage: startAttachments,
          resolvedCommit: false,
          codepipelineDetails: await codepipeline.getPipelineAsync({name: pipelineName}),
          pendingMessages: [],
          currentActions: [],
          currentStage: null
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
  const {currentStage, currentActions, codepipelineDetails, pendingMessages} = doc.Item;

  const [guard, update] = shouldProceed(event, currentStage, currentActions);
  if (!guard) {
    return docClient.updateAsync({
      TableName: dynamodbTable,
      Key: {projectName, executionId: pipelineExecutionId},
      UpdateExpression: 'SET #list = list_append(#list, :event)',
      ExpressionAttributeNames: {'#list': 'pendingMessages'},
      ExpressionAttributeValues: {':event': [event]}
    });
  }

  const updateRecord = docClient.updateAsync({
    TableName: dynamodbTable,
    Key: {projectName, executionId: pipelineExecutionId},
    UpdateExpression: 'SET #actions = :ca, #stage = :sa ',
    ExpressionAttributeNames: {'#actions': 'currentActions', '#stage': 'currentStage'},
    ExpressionAttributeValues: {':ca': update.currentActions, ':sa': update.currentStage}
  });

  const artifactRevision = pipelineData.pipelineExecution.artifactRevisions[0];
  const commitId = artifactRevision && artifactRevision.revisionId;
  const shortCommitId = commitId && commitId.slice(0, 8);
  const commitMessage = artifactRevision && artifactRevision.revisionSummary;
  const commitUrl = artifactRevision && artifactRevision.revisionUrl;

  const commitDetailsMessage = `commit \`<${commitUrl}|${shortCommitId}>\`\n> ${commitMessage}`;
  const stage = getStageDetails(codepipelineDetails, event.detail.stage);
  const nbAction = _.size(_.get('actions', stage));

  let title, text, color;
  if (EVENT_TYPES.pipeline === event['detail-type']) {
    text = `Deployment just *${event.detail.state.toLowerCase()}* <${link}|🔗>`;
    title = `${projectName} (${env})`;
    color = COLOR_CODES[event.detail.state];
  } else if (EVENT_TYPES.stage === event['detail-type']) {
    text = `Stage *${event.detail.stage}* just *${event.detail.state.toLowerCase()}*`;
    color = COLOR_CODES.pale[event.detail.state];
  } else if (EVENT_TYPES.action === event['detail-type']) {
    const actionIndexInStage = _.findIndex({name: event.detail.action}, stage.actions);
    text = `> Action *${event.detail.action}* _(stage *${
      event.detail.stage
    }* *[${actionIndexInStage + 1}/${nbAction}]*)_ just *${event.detail.state.toLowerCase()}*`;
    color = COLOR_CODES.palest[event.detail.state];
  }
  const attachments = [{title, text, color: color || '#dddddd', mrkdwn_in: ['text']}];

  if (EVENT_TYPES.action === event['detail-type']) {
    if (nbAction === 1) return 'Message Acknowledge';
  }

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

  if (!_.isEmpty(pendingMessages)) {
    // §TODO Handling pending messages
    // Iterate and treat them as going
  }

  await web.chat.postMessage({
    as_user: true,
    channel,
    attachments,
    thread_ts: doc.Item.slackThreadTs
  });
  if (EVENT_TYPES.pipeline === event['detail-type']) {
    const state = event.detail.state;
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
          color: COLOR_CODES.palest[state]
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
  await updateRecord;

  return 'Acknoledge Event';
};
