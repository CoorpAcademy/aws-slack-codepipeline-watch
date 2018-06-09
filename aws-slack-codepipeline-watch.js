const {WebClient} = require('@slack/client');
const AWS = require('aws-sdk');
const Promise = require('bluebird');
const _ = require('lodash/fp');

const getContext = async (environ, event, lambdaContext = {}) => {
  const token = environ.SLACK_TOKEN;
  if (!token) throw new Error('Need a valid token defined in SLACK_TOKEN');

  const channel = environ.SLACK_CHANNEL;
  if (!channel) throw new Error('Need a valid chanel defined in SLACK_CHANNEL');

  const dynamodbTable = environ.DYNAMO_TABLE;
  if (!dynamodbTable) throw new Error('Need a valid table defined in DYNAMO_TABLE');

  const codepipeline =
    environ.NODE_ENV !== 'test'
      ? Promise.promisifyAll(new AWS.CodePipeline({apiVersion: '2015-07-09'}))
      : lambdaContext.codepipeline;
  const dynamoDocClient =
    environ.NODE_ENV !== 'test'
      ? Promise.promisifyAll(new AWS.DynamoDB.DocumentClient({apiVersion: '2012-08-10'}))
      : lambdaContext.dynamoDocClient;

  const web = environ.NODE_ENV !== 'test' ? new WebClient(token) : lambdaContext.slack;

  const pipelineName = _.get('detail.pipeline', event);
  const pipelineExecutionId = _.get('detail.execution-id', event);

  const pipelineData = await codepipeline.getPipelineExecutionAsync({
    pipelineExecutionId,
    pipelineName
  });
  // §TODO try to generalize that
  const env = /staging/.test(pipelineName) ? 'staging' : 'production';
  const projectName = /codepipeline-(.*)/.exec(pipelineName)[1];
  const link = `https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/${pipelineName}`; // §TODO: move

  return {
    slack: {
      token,
      channel,
      web
    },
    aws: {
      codepipeline,
      dynamodbTable,
      dynamoDocClient
    },
    event: {
      event,
      projectName,
      pipelineName,
      executionId: pipelineExecutionId,
      env,
      pipelineData,
      link
    }
  };
};

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

const shouldProceed = (
  {type, stage, action, state, runOrder},
  currentStage,
  currentActions = {}
) => {
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
      _.includes(action, _.get('actions', currentActions)),
      {
        currentStage,
        currentActions:
          _.size(_.get('actions', currentActions)) === 1
            ? NO_ACTIONS()
            : {noStartedAction: false, runOrder, actions: _.filter(_action => _action !== action)}
      }
    ];
  }
  return [
    currentStage === null,
    {
      currentStage,
      currentActions: NO_ACTIONS()
    }
  ];
};

const getRecord = async context => {
  const {aws, event: {projectName, executionId}} = context;
  const params = {
    TableName: aws.dynamodbTable,
    Key: {projectName, executionId},
    UpdateExpression: 'SET #lock = :lock',
    ConditionExpression: 'attribute_exists(slackThreadTs) AND #lock = :unlocked',
    ExpressionAttributeNames: {'#lock': 'Lock'},
    ExpressionAttributeValues: {':lock': true, ':unlocked': false},
    ReturnValues: 'ALL_NEW'
  };
  const updateRecord = await aws.dynamoDocClient.updateAsync(params).catch(err => {
    // §TODO catch error type to distinguish ConditionFailed de Throughput
    return {};
  });
  if (updateRecord.Attributes) return updateRecord.Attributes;
  await Promise.delay(500);
  return getRecord(context);
};

const handleInitialMessage = async context => {
  const {aws, slack} = context;
  const {event, projectName, executionId, pipelineName, env, link} = context.event;
  const startText = `Deployment just *${event.detail.state.toLowerCase()}* <${link}|🔗>`;
  const startTitle = `${projectName} (${env})`;
  const startAttachments = [
    {title: startTitle, text: startText, color: COLOR_CODES.STARTED, mrkdwn_in: ['text']}
  ];
  const pipelineExectionMessage = `\`execution-id\`: <${link}/history|${executionId}>`;

  const slackPostedMessage = await slack.web.chat.postMessage({
    as_user: true,
    channel: slack.channel,
    attachments: startAttachments
  });
  await Promise.all([
    aws.dynamoDocClient.putAsync({
      TableName: aws.dynamodbTable,
      Item: {
        projectName,
        executionId,
        slackThreadTs: slackPostedMessage.message.ts,
        originalMessage: startAttachments,
        resolvedCommit: false,
        codepipelineDetails: (await aws.codepipeline.getPipelineAsync({name: pipelineName}))
          .pipeline,
        pendingMessages: {},
        currentActions: [],
        currentStage: null,
        Lock: false
      }
    }),
    slack.web.chat.postMessage({
      as_user: true,
      channel: slack.channel,
      text: pipelineExectionMessage,
      thread_ts: slackPostedMessage.message.ts
    })
  ]);

  return 'Message Acknowledge';
};

const computeExecutionDetailsProperties = (context, record) => {
  const {event, pipelineData} = context.event;
  const {codepipelineDetails} = record;
  const artifactRevision = pipelineData.pipelineExecution.artifactRevisions[0];
  const commitId = artifactRevision && artifactRevision.revisionId;
  const shortCommitId = commitId && commitId.slice(0, 8);
  const commitMessage = artifactRevision && artifactRevision.revisionSummary;
  const commitUrl = artifactRevision && artifactRevision.revisionUrl;
  const commitDetailsMessage = `commit \`<${commitUrl}|${shortCommitId}>\`\n> ${commitMessage}`;
  const eventCurrentStage =
    event.detail.stage && getStageDetails(codepipelineDetails, event.detail.stage);
  const nbActionsOfStage =
    event.detail.stage && _.maxBy(_action => _action.runOrder, eventCurrentStage.actions).runOrder;
  const eventCurrentOrder =
    EVENT_TYPES[event['detail-type']] === 'action'
      ? getActionDetails(eventCurrentStage, event.detail.action).runOrder
      : undefined;
  return {
    artifactRevision,
    commitId,
    shortCommitId,
    commitMessage,
    commitDetailsMessage,
    eventCurrentStage,
    nbActionsOfStage,
    eventCurrentOrder,
    codepipelineDetails,
    originalMessage: record.originalMessage,
    slackThreadTs: record.slackThreadTs
  };
};

const attachmentForEvent = (context, {type, stage, action, state, runOrder}) => {
  const {event: {projectName, env, link}, executionDetails: {nbActionsOfStage}} = context;
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

const updateMainMessage = async context => {
  const {slack, executionDetails: {commitDetailsMessage, slackThreadTs, originalMessage}} = context;
  await slack.web.chat.update({
    as_user: true,
    channel: slack.channel,
    attachments: [
      ...originalMessage,
      {
        text: commitDetailsMessage,
        mrkdwn_in: ['text']
      }
    ],
    ts: slackThreadTs
  });
};

const handleEvent = async (context, {type, stage, action, state, runOrder}) => {
  const {
    slack,
    event: {link},
    executionDetails: {commitDetailsMessage, slackThreadTs, originalMessage}
  } = context;
  await slack.web.chat.postMessage({
    as_user: true,
    channel: slack.channel,
    attachments: attachmentForEvent(context, {type, stage, action, state, runOrder}),
    thread_ts: slackThreadTs
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

    await slack.web.chat.update({
      as_user: true,
      channel: slack.channel,
      attachments: [
        ...originalMessage,
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
      ts: slackThreadTs
    });
    return true;
  }
};

exports.handler = async (event, lambdaContext) => {
  if (event.source !== 'aws.codepipeline')
    throw new Error(`Called from wrong source ${event.source}`);

  const context = await getContext(process.env, event, lambdaContext);
  const {aws} = context;

  if (event.detail.state === 'STARTED' && EVENT_TYPES[event['detail-type']] === 'pipeline') {
    return handleInitialMessage(context);
  }

  const record = await getRecord(context);
  const {currentStage, currentActions} = record;
  let futureRecord = _.cloneDeep(record);
  context.executionDetails = computeExecutionDetailsProperties(context, record); // §todo:maybe: rename
  const eventSummary = {
    type: EVENT_TYPES[event['detail-type']],
    stage: event.detail.stage,
    action: event.detail.action,
    state: event.detail.state,
    runOrder: context.executionDetails.eventCurrentOrder
  };
  const pendingMessage = _.compact([
    EVENT_TYPES[event['detail-type']],
    event.detail.state,
    event.detail.stage,
    event.detail.action,
    context.executionDetails.eventCurrentOrder
  ]).join(':');

  // §FIXME refactor needed before extraction
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
      // §todo extract
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
        // §TODO: check simulatenus messages
        const simultaneousGuardList = _.map(([ev, ts]) => {
          return shouldProceed(extractEventSummary(ev), cStage, cActions);
        }, simultaneusMessages);
        const simultaneousGuard = _.find(([_guard, _update]) => _guard, simultaneousGuardList);

        if (!simultaneousGuard)
          return {pendingEvents, currentStage: cStage, currentActions: cActions, handledMessages};
        else [firstGuard, firstUpdates] = simultaneousGuard;
      }
      const _eventSummary = extractEventSummary(pendingEvents[0]);

      const eventAssociatedStage = getStageDetails(
        context.executionDetails.codepipelineDetails,
        _eventSummary.stage
      );
      if (!(_eventSummary.type === 'action' && _.size(_.get('actions', eventAssociatedStage)) <= 1))
        await handleEvent(context, _eventSummary);
      if (_.size(pendingEvents) === 1)
        return {
          pendingEvents,
          currentStage: firstUpdates.currentStage,
          currentActions: firstUpdates.currentActions,
          handledMessages: [...handledMessages, pendingEvents[0]]
        };
      return treatOneEventAtATime(
        [..._.slice(1, _.size(pendingEvents), pendingEvents)],
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
      futureRecord = _.reduce(
        (acc, handledMessage) => _.unset(`pendingMessages.${handledMessage}`, acc),
        futureRecord,
        newPending.handledMessages
      );
      futureRecord = _.set(
        'currentActions',
        newPending.currentActions,
        _.set('currentStage', newPending.currentStage, futureRecord)
      );
    }
    return newPending;
  };

  const type = EVENT_TYPES[event['detail-type']];
  const stage = event.detail.stage;
  const action = event.detail.action;
  const state = event.detail.state;
  // eslint-disable-next-line prefer-const
  let [guard, update] = shouldProceed(eventSummary, currentStage, currentActions);

  let pendingResult;
  if (!guard) {
    // Postpone current message if cannot handle it after pending messages
    pendingResult = await handlePendingMessages(record);
    const [retryGuard, retryUpdate] = shouldProceed(
      eventSummary,
      pendingResult.currentStage,
      pendingResult.currentActions
    );
    if (!retryGuard) {
      futureRecord = _.set(`pendingMessages.${pendingMessage}`, event.time, futureRecord);
      update = {currentActions: record.currentActions, currentStage: record.currentStage};
    } else {
      update = retryUpdate;
    }
  }
  futureRecord = _.set(
    'currentActions',
    update.currentActions,
    _.set('currentStage', update.currentStage, futureRecord)
  );

  let hasUpdatedMainMessage;
  if (
    guard &&
    !(
      type === 'action' && _.size(_.get('actions', context.executionDetails.eventCurrentStage)) <= 1
    )
  ) {
    hasUpdatedMainMessage = await handleEvent(context, {
      type,
      stage,
      action,
      state,
      runOrder: context.executionDetails.eventCurrentOrder
    });
  }
  if (
    record &&
    !hasUpdatedMainMessage &&
    !record.resolvedCommit &&
    context.executionDetails.artifactRevision
  ) {
    await updateMainMessage(context);
    futureRecord = _.set('resolvedCommit', true, futureRecord);
  }
  await handlePendingMessages(
    _.set(
      'currentActions',
      update.currentActions,
      _.set('currentStage', update.currentStage, record) // §FIXME
    )
  );

  // Update and Lock Release
  await aws.dynamoDocClient.putAsync({
    TableName: aws.dynamodbTable,
    Item: _.set('Lock', false, futureRecord)
  });

  return 'Acknoledge Event';
};

exports.shouldProceed = shouldProceed;
exports.getContext = getContext;
