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

const getActionDetails = (stageDetails, actionName) => {
  return _.find({name: actionName}, stageDetails.actions);
};

const shouldProceed = ({type, stage, action, state, runOrder}, currentStage, currentActions) => {
  const NO_ACTIONS = nsa => ({runOrder: undefined, actions: [], noStartedAction: nsa});
  // NO started to prevent stage to be taken without actions being processed
  if (type === 'stage') {
    if (state === 'STARTED' || state === 'RESUMED')
      return [currentStage === null, {currentStage: stage, currentActions: NO_ACTIONS(true)}];
    return [
      _.isEmpty(currentActions.actions) &&
        stage === currentStage &&
        !currentActions.noStartedAction,
      {currentStage: null, currentActions: NO_ACTIONS(false)}
    ];
  }

  if (type === 'action') {
    if (state === 'STARTED' || state === 'RESUMED')
      return [
        currentStage === stage &&
          (currentActions.runOrder === undefined || currentActions.runOrder === runOrder),
        // §TODO Improve parallel action with checking the run order
        {
          currentStage,
          currentActions: {
            actions: [...(currentActions.actions || []), action],
            noStartedAction: false,
            runOrder
          }
        }
      ];
    return [
      _.includes(action, currentActions.actions),
      {
        currentStage,
        currentActions:
          currentActions.actions.length === 1
            ? NO_ACTIONS()
            : {noStartedAction: false, runOrder, actions: _.filter(_action => _action !== action)}
      }
    ];
  }
  return [currentStage === null, NO_ACTIONS()];
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
    await Promise.all([
      docClient.putAsync({
        TableName: dynamodbTable,
        Item: {
          projectName,
          executionId: pipelineExecutionId,
          slackThreadTs: slackPostedMessage.message.ts,
          originalMessage: startAttachments,
          resolvedCommit: false,
          codepipelineDetails: (await codepipeline.getPipelineAsync({name: pipelineName})).pipeline,
          pendingMessages: {},
          currentActions: [],
          currentStage: null,
          Lock: false
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

  const getRecord = async () => {
    const params = {
      TableName: dynamodbTable,
      Key: {projectName, executionId: pipelineExecutionId},
      UpdateExpression: 'SET #lock = :lock',
      ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
      ExpressionAttributeNames: {'#lock': 'Lock'},
      ExpressionAttributeValues: {':lock': true, ':unlocked': false},
      ReturnValues: 'ALL_NEW'
    };
    const updateRecord = await docClient.updateAsync(params).catch(err => {
      console.error(err);
      return {};
    });
    console.log(updateRecord);
    if (updateRecord.Attributes) return updateRecord.Attributes;
    await Promise.delay(500);
    return getRecord(params);
  };
  const record = await getRecord({
    TableName: dynamodbTable,
    Key: {projectName, executionId: pipelineExecutionId}
  });
  const {currentStage, currentActions, codepipelineDetails} = record;
  const artifactRevision = pipelineData.pipelineExecution.artifactRevisions[0];
  const commitId = artifactRevision && artifactRevision.revisionId;
  const shortCommitId = commitId && commitId.slice(0, 8);
  const commitMessage = artifactRevision && artifactRevision.revisionSummary;
  const commitUrl = artifactRevision && artifactRevision.revisionUrl;
  const commitDetailsMessage = `commit \`<${commitUrl}|${shortCommitId}>\`\n> ${commitMessage}`;
  const eventCurrentStage = getStageDetails(codepipelineDetails, event.detail.stage);
  const nbActionsOfStage = _.maxBy(_action => _action.runOrder, eventCurrentStage.actions).runOrder;
  const eventCurrentOrder =
    EVENT_TYPES[event['detail-type']] === 'action'
      ? getActionDetails(eventCurrentStage, event.detail.action).runOrder
      : undefined;
  const eventSummary = {
    type: EVENT_TYPES[event['detail-type']],
    stage: event.detail.stage,
    action: event.detail.action,
    state: event.detail.state,
    runOrder: eventCurrentOrder
  };
  const pendingMessage = _.compact([
    EVENT_TYPES[event['detail-type']],
    event.detail.state,
    event.detail.stage,
    event.detail.action,
    eventCurrentOrder
  ]).join(':');

  const attachmentForEvent = ({type, stage, action, state, runOrder}) => {
    let title, text, color;
    if (type === 'pipeline') {
      text = `Deployment just *${state.toLowerCase()}* <${link}|🔗>`;
      title = `${projectName} (${env})`;
      color = COLOR_CODES[state];
    } else if (type === 'stage') {
      text = `Stage *${stage}* just *${state.toLowerCase()}*`;
      color = COLOR_CODES.pale[state];
    } else if (type === 'action') {
      text = `> Action *${action}* _(stage *${stage}* *[${runOrder}/${nbActionsOfStage}]*)_ just *${state.toLowerCase()}*`;
      color = COLOR_CODES.palest[state];
    }
    return [{title, text, color: color || '#dddddd', mrkdwn_in: ['text']}];
  };

  const handleEvent = async ({type, stage, action, state, runOrder}) => {
    await web.chat.postMessage({
      as_user: true,
      channel,
      attachments: attachmentForEvent({type, stage, action, state, runOrder}),
      thread_ts: record.slackThreadTs
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
          ...record.originalMessage,
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
        ts: record.slackThreadTs
      });
      return true;
    }
  };

  const updateMainMessage = async () => {
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
        ...record.originalMessage,
        {
          text: commitDetailsMessage,
          mrkdwn_in: ['text']
        }
      ],
      ts: record.slackThreadTs
    });
  };

  const handlePendingMessages = async ({
    pendingMessages,
    currentStage: _currentStage,
    currentActions: _currentActions
  }) => {
    if (_.isEmpty(pendingMessages)) {
      return {
        pendingMessages,
        currentStage: _currentStage,
        currentActions: _currentActions
      };
    }
    // Handling pending messages, Iterate and treat them as going
    const orderedEvents = _.map(([k, v]) => k, _.sortBy(([k, v]) => v, _.toPairs(pendingMessages)));

    const extractEventSummary = ev => {
      const eventPart = ev.split(':');
      return {
        type: eventPart[0],
        state: eventPart[1],
        stage: eventPart[2],
        action: eventPart[3],
        runOrder: eventPart[4]
      };
    };
    const treatOneEventAtATime = async (pendingEvents, cStage, cActions, handledMessages) => {
      const guardList = _.map(
        ev => shouldProceed(extractEventSummary(ev), cStage, cActions),
        pendingEvents
      );
      let [firstGuard, firstUpdates] = guardList[0];
      if (!firstGuard) {
        // handling simultaneus messages
        const simultaneusMessages = _.filter(
          ([k, v]) => v === pendingMessages[pendingEvents[0]],
          _.toPairs(pendingMessages)
        );
        if (_.size(simultaneusMessages) > 1)
          await web.chat.postMessage({
            channel,
            text: `*${_.size(simultaneusMessages)} SIMULATENUS MESSAGE*  ->  ${JSON.stringify(
              simultaneusMessages
            )}`,
            thread_ts: record.slackThreadTs
          });
        const simultaneousGuardList = _.map(([ev, ts]) => {
          return shouldProceed(extractEventSummary(ev), cStage, cActions);
        }, simultaneusMessages);
        const simultaneousGuard = _.find(([_guard, _update]) => _guard, simultaneousGuardList);

        if (!simultaneousGuard)
          return {pendingEvents, currentStage: cStage, currentActions: cActions, handledMessages};
        else [firstGuard, firstUpdates] = simultaneousGuard;
      }
      const _eventSummary = extractEventSummary(pendingEvents[0]);
      // /SLACK DEBUGING
      await web.chat.postMessage({
        channel,
        text: `unpile _(${context.awsRequestId.slice(0, 8)})_  ->  ${pendingEvents[0]}}`,
        thread_ts: record.slackThreadTs
      });
      //* /
      const eventAssociatedStage = getStageDetails(codepipelineDetails, _eventSummary.stage);
      if (!(_eventSummary.type === 'action' && _.size(_.get('actions', eventAssociatedStage)) <= 1))
        await handleEvent(_eventSummary);
      if (pendingEvents.length === 1)
        return {
          pendingEvents,
          currentStage: firstUpdates.currentStage,
          currentActions: firstUpdates.currentActions,
          handledMessages: [...handledMessages, pendingEvents[0]]
        };
      return treatOneEventAtATime(
        [..._.slice(1, pendingEvents.length, pendingEvents)],
        firstUpdates.currentStage,
        firstUpdates.currentActions,
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
        web.chat.postMessage({
          channel,
          text: `updateStage _(${context.awsRequestId.slice(0, 8)})_ ->  ${
            newPending.currentStage
          }, ${JSON.stringify(newPending.currentActions)}`,
          thread_ts: record.slackThreadTs
        }),
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
    return newPending;
  };

  const type = EVENT_TYPES[event['detail-type']];
  const stage = event.detail.stage;
  const action = event.detail.action;
  const state = event.detail.state;
  // eslint-disable-next-line prefer-const
  let [guard, update] = shouldProceed(eventSummary, currentStage, currentActions);

  // /SLACK DEBUGING
  await web.chat.postMessage({
    channel,
    text: `debug _(${context.awsRequestId.slice(0, 8)})_  ->  ${pendingMessage}, *${
      guard ? 'proceed' : 'initialy postponed'
    }*`,
    thread_ts: record.slackThreadTs
  });
  let pendingResult;
  //* /
  if (!guard) {
    // Postpone current message if cannot handle it after pending messages
    pendingResult = await handlePendingMessages(record);
    const [retryGuard, retryUpdate] = shouldProceed(
      eventSummary,
      pendingResult.currentStage,
      pendingResult.currentActions
    );
    if (!retryGuard) {
      await docClient.updateAsync({
        TableName: dynamodbTable,
        Key: {projectName, executionId: pipelineExecutionId},
        UpdateExpression: `SET #pmf.#pm = :ts`,
        ExpressionAttributeNames: {'#pmf': 'pendingMessages', '#pm': pendingMessage},
        ExpressionAttributeValues: {':ts': event.time}
      });
    } else {
      await web.chat.postMessage({
        channel,
        text: `RETRY after pending _(${context.awsRequestId.slice(0, 8)})_  ->  ${pendingMessage}`,
        thread_ts: record.slackThreadTs
      });
      update = retryUpdate;
    }
  }
  // Treat current message
  await docClient.updateAsync({
    TableName: dynamodbTable,
    Key: {projectName, executionId: pipelineExecutionId},
    UpdateExpression: 'SET #actions = :ca, #stage = :sa ',
    ExpressionAttributeNames: {'#actions': 'currentActions', '#stage': 'currentStage'},
    ExpressionAttributeValues: {':ca': update.currentActions, ':sa': update.currentStage}
  });

  let hasUpdatedMainMessage;
  if (!(type === 'action' && _.size(_.get('actions', eventCurrentStage)) <= 1)) {
    hasUpdatedMainMessage = await handleEvent({
      type,
      stage,
      action,
      state,
      runOrder: eventCurrentOrder
    });
  }

  if (record && !hasUpdatedMainMessage && !record.resolvedCommit && artifactRevision) {
    await updateMainMessage();
  }
  await handlePendingMessages(pendingResult || record);

  // Lock Release
  await docClient.updateAsync({
    TableName: dynamodbTable,
    Key: {projectName, executionId: pipelineExecutionId},
    UpdateExpression: 'SET #lock = :lock',
    ExpressionAttributeNames: {'#lock': 'Lock'},
    ExpressionAttributeValues: {':lock': false}
  });
  return 'Acknoledge Event';
};
