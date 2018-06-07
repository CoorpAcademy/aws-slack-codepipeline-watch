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
  'CodePipeline Pipeline Execution State Change': 'pipeline',
  'CodePipeline Stage Execution State Change': 'stage',
  'CodePipeline Action Execution State Change': 'action'
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
  return _.find({name: stageName}, pipelineDetails.stages);
};

const shouldProceed = ({type, stage, action, state}, currentStage, currentActions) => {
  if (type === 'stage') {
    if (state === 'STARTED' || state === 'RESUMED')
      return [currentStage === null, {currentStage: stage, currentActions: []}];
    return [
      _.isEmpty(currentActions) && stage === currentStage,
      {currentStage: null, currentActions: []}
    ];
  }

  if (type === 'action') {
    if (state === 'STARTED' || state === 'RESUMED')
      return [
        _.isEmpty(currentActions) && currentStage === stage,
        {currentStage, currentActions: [...(currentActions || []), action]}
      ];
    return [
      _.includes(action, currentActions),
      {
        currentStage,
        currentActions: _.filter(_action => _action !== action, currentActions)
      }
    ];
  }
  console.log('XXXXXXX', {type, stage, action, state});
  return [currentStage === null, {currentStage: null, currentActions: []}];
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

  if (event.detail.state === 'STARTED' && EVENT_TYPES[event['detail-type']] === 'pipeline') {
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
    const codepipelineDetails = await codepipeline.getPipelineAsync({name: pipelineName});
    await Promise.all([
      docClient.putAsync({
        TableName: dynamodbTable,
        Item: {
          projectName,
          executionId: pipelineExecutionId,
          slackThreadTs: slackPostedMessage.message.ts,
          originalMessage: startAttachments,
          resolvedCommit: false,
          codepipelineDetails,
          pendingMessages: {},
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

  const getRecord = async params => {
    const record = await docClient.getAsync(params);
    if (record.Item) return record;
    await Promise.delay(500);
    return getRecord(params);
  };
  const doc = await getRecord({
    TableName: dynamodbTable,
    Key: {projectName, executionId: pipelineExecutionId}
  });
  const {currentStage, currentActions, codepipelineDetails} = doc.Item;
  const artifactRevision = pipelineData.pipelineExecution.artifactRevisions[0];
  const commitId = artifactRevision && artifactRevision.revisionId;
  const shortCommitId = commitId && commitId.slice(0, 8);
  const commitMessage = artifactRevision && artifactRevision.revisionSummary;
  const commitUrl = artifactRevision && artifactRevision.revisionUrl;
  const commitDetailsMessage = `commit \`<${commitUrl}|${shortCommitId}>\`\n> ${commitMessage}`;

  const eventSummary = {
    type: EVENT_TYPES[event['detail-type']],
    stage: event.detail.stage,
    action: event.detail.action,
    state: event.detail.state
  };
  const [guard, update] = shouldProceed(eventSummary, currentStage, currentActions);
  console.log(
    `guard: ${guard} ${event.detail.state} ${event.detail.stage} ${
      event.detail.action
    } ${currentStage} ${currentActions} ${guard ? JSON.stringify(update) : ''}`
  );
  if (!guard) {
    const pendingMessage = _.compact([
      EVENT_TYPES[event['detail-type']],
      event.detail.stage,
      event.detail.action,
      event.detail.state
    ]).join(':');
    console.log(
      `CANT process, ${
        event['detail-type']
      } due to ${currentStage} ${currentActions}->>${pendingMessage}`
    );
    return docClient
      .updateAsync({
        TableName: dynamodbTable,
        Key: {projectName, executionId: pipelineExecutionId},
        UpdateExpression: `SET #pmf.#pm = :ts`,
        ExpressionAttributeNames: {'#pmf': 'pendingMessages', '#pm': pendingMessage},
        ExpressionAttributeValues: {':ts': event.time}
      })
      .catch(err => {
        console.error(pipelineExecutionId, err.message, pendingMessage);
      });
  }
  console.log({':ca': update.currentActions, ':sa': update.currentStage});
  const updateRecord = docClient.updateAsync({
    TableName: dynamodbTable,
    Key: {projectName, executionId: pipelineExecutionId},
    UpdateExpression: 'SET #actions = :ca, #stage = :sa ',
    ExpressionAttributeNames: {'#actions': 'currentActions', '#stage': 'currentStage'},
    ExpressionAttributeValues: {':ca': update.currentActions, ':sa': update.currentStage}
  });

  const attachmentForEvent = ({type, stage, action, state}) => {
    const stageDetails = getStageDetails(codepipelineDetails, stage);
    const nbAction = _.size(_.get('actions', stageDetails));
    let title, text, color;
    const detailType = EVENT_TYPES[event['detail-type']];
    if (detailType === 'pipeline') {
      text = `Deployment just *${state.toLowerCase()}* <${link}|🔗>`;
      title = `${projectName} (${env})`;
      color = COLOR_CODES[state];
    } else if (detailType === 'stage') {
      text = `Stage *${stage}* just *${state.toLowerCase()}*`;
      color = COLOR_CODES.pale[state];
    } else if (detailType === 'action') {
      const actionIndexInStage = _.findIndex({name: action}, stage.actions);
      text = `> Action *${action}* _(stage *${stage}* *[${actionIndexInStage +
        1}/${nbAction}]*)_ just *${state.toLowerCase()}*`;
      color = COLOR_CODES.palest[state];
    }
    return [{title, text, color: color || '#dddddd', mrkdwn_in: ['text']}];
  };

  const handleEvent = async ({type, stage, action, state}) => {
    console.log(`HANDLING EVENT ${type} ${stage} ${action}`);
    await web.chat.postMessage({
      as_user: true,
      channel,
      attachments: attachmentForEvent({type, stage, action, state}),
      thread_ts: doc.Item.slackThreadTs
    });
    // Update pipeline on treated messages
    if (type === 'pipeline') {
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
  };

  const eventCurrentStage = getStageDetails(codepipelineDetails, event.detail.stage);
  if (
    !(
      EVENT_TYPES[event['detail-type']] === 'action' &&
      _.size(_.get('actions', eventCurrentStage)) <= 1
    )
  )
    await handleEvent({
      type: EVENT_TYPES[event['detail-type']],
      stage: event.detail.stage,
      action: event.detail.action,
      state: event.detail.state
    });

  if (doc.Item && !doc.Item.resolvedCommit && artifactRevision) {
    await docClient.updateAsync({
      TableName: dynamodbTable,
      Key: {projectName, executionId: pipelineExecutionId},
      UpdateExpression: 'set #resolvedCommit = :resolvedCommit',
      ExpressionAttributeNames: {'#resolvedCommit': 'resolvedCommit'},
      ExpressionAttributeValues: {':resolvedCommit': true}
    });

    await web.chat.update({
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
    });
  }

  const {
    pendingMessages,
    currentStage: _currentStage,
    currentActions: _currentActions
  } = (await getRecord({
    TableName: dynamodbTable,
    Key: {projectName, executionId: pipelineExecutionId}
  })).Item;
  console.log(`there is ${_.size(pendingMessages)} pendingMessages`);
  if (!_.isEmpty(pendingMessages)) {
    // §TODO Handling pending messages
    // Iterate and treat them as going
    console.log('PENDING MESSAGES', pendingMessages);
    // §FIXME here
    const orderedEvents = _.map(([k, v]) => k, _.sortBy(([k, v]) => v, _.toPairs(pendingMessages)));
    console.log('orderedEvents', orderedEvents);

    const extractEventSummary = ev => {
      const eventPart = ev.split(':');
      return {
        type: eventPart[0],
        stage: eventPart[1],
        action: eventPart[2],
        state: eventPart[3] || eventPart[2] || eventPart[1]
      };
    };
    const treatOneEventAtATime = async (pendingEvents, cStage, cActions, handledMessages) => {
      const guardList = _.map(ev => {
        return shouldProceed(extractEventSummary(ev), cStage, cActions);
      }, pendingEvents);
      if (!guardList[0][0]) return {pendingEvents, currentStage: cStage, currentActions: cActions, handledMessages};

      const eventCurrentStage = getStageDetails(codepipelineDetails, event.detail.stage);
      const eventSummary = extractEventSummary(pendingEvents[0]);
      if (!(eventSummary.type === 'action' && _.size(_.get('actions', eventSummary.stage)) <= 1))
        await handleEvent(eventSummary);
      if (pendingEvents.length === 1)
        return {
          pendingEvents,
          currentStage: cStage, // §FIXME change value of stage on retrieval!!
          currentActions: cActions,
          handledMessages: [...handledMessages, pendingEvents[0]]
        };
      return treatOneEventAtATime(
        [..._.slice(1, pendingEvents.length, pendingEvents)],
        update.currentStage,
        update.currentActions,
        [...handledMessages, pendingEvents[0]]
      );
    };
    const newPending = await treatOneEventAtATime(
      orderedEvents,
      _currentStage,
      _currentActions,
      []
    );
    if (!_.isEmpty(newPending.handledMessages)) {
      const disableMessages = Promise.map(newPending.handledMessages, handledMessage =>
        docClient.updateAsync({
          TableName: dynamodbTable,
          Key: {projectName, executionId: pipelineExecutionId},
          UpdateExpression: 'remove #pm.#pmf',
          ExpressionAttributeNames: {
            '#pm': 'pendingMessages',
            '#pmf': handledMessage
          }
        })
      );
      await Promise.all([
        disableMessages,
        docClient.updateAsync({
          TableName: dynamodbTable,
          Key: {projectName, executionId: pipelineExecutionId},
          UpdateExpression: 'set #cs = :cs, #ca = :ca',
          ExpressionAttributeNames: {
            '#ca': 'currentActions',
            '#cs': 'currentStage'
          },
          ExpressionAttributeValues: {
            ':cs': newPending.currentStage,
            ':ca': newPending.currentActions
          }
        })
      ]);
    }
  }

  await updateRecord;

  return 'Acknoledge Event';
};
