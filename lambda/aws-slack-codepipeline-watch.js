const {WebClient} = require('@slack/client');
const AWS = require('aws-sdk');
const Promise = require('bluebird');
const request = require('request');
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
      ? new AWS.CodePipeline({apiVersion: '2015-07-09'})
      : lambdaContext.codepipeline;
  const dynamoDocClient =
    environ.NODE_ENV !== 'test'
      ? new AWS.DynamoDB.DocumentClient({apiVersion: '2012-08-10'})
      : lambdaContext.dynamoDocClient;

  const requestClient = environ.NODE_ENV !== 'test' ? request : lambdaContext.request;

  const web = environ.NODE_ENV !== 'test' ? new WebClient(token) : lambdaContext.slack;

  const pipelineName = _.get('detail.pipeline', event);
  const pipelineExecutionId = _.get('detail.execution-id', event);

  const pipelineData = await codepipeline
    .getPipelineExecution({
      pipelineExecutionId,
      pipelineName
    })
    .promise();
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
    github: {
      token: environ.GITHUB_AUTH_TOKEN
    },
    request: requestClient,
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

const ACTION_TYPE_SYMBOL = {
  Source: '💾',
  Build: '🛠',
  Test: '🔬',
  Deploy: '🚀',
  Approval: '🗳',
  Invoke: '📡'
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

const getStageActionTypes = (pipelineDetails, stageName) => {
  return _.uniq(
    _.map('actionTypeId.category', getStageDetails(pipelineDetails, stageName).actions)
  );
};

const getActionType = (pipelineDetails, stage, action) => {
  const stageDetails = _.find({name: stage}, pipelineDetails.stages);
  const actionDetails = stageDetails && _.find({name: action}, stageDetails.actions);
  return actionDetails && _.get('actionTypeId.category', actionDetails);
};

const shouldProceed = (
  {type, stage, action, state, runOrder},
  currentStage,
  currentActions = {}
) => {
  const NO_ACTIONS = (nsa, _runOrder = 1) => ({
    runOrder: _runOrder,
    actions: [],
    noStartedAction: nsa
  });
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
        currentStage === stage && currentActions.runOrder === runOrder,
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
            ? NO_ACTIONS(false, runOrder + 1)
            : {
                noStartedAction: false,
                runOrder,
                actions: _.filter(_action => _action !== action, currentActions.actions)
              }
      }
    ];
  }
  return [
    currentStage === null,
    {
      currentStage,
      currentActions: NO_ACTIONS(true)
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
  const updateRecord = await aws.dynamoDocClient
    .update(params)
    .promise()
    .catch(err => {
      // §TODO catch error type to distinguish ConditionFailed de Throughput
      return {};
    });
  if (updateRecord.Attributes) return updateRecord.Attributes;
  await Promise.delay(500);
  return getRecord(context);
};

const getCommitDetails = async (context, pipelineDetails) => {
  const githubDetails = _.filter(
    action =>
      _.equals(action.actionTypeId, {
        category: 'Source',
        owner: 'ThirdParty',
        provider: 'GitHub',
        version: '1'
      }),
    _.flatMap('actions', _.get('stages', pipelineDetails))
  );
  const artifactRevision = _.get(
    'event.pipelineData.pipelineExecution.artifactRevisions[0]',
    context
  );
  if (_.size(githubDetails) !== 1 || !artifactRevision || _.isEmpty(_.get('github.token', context)))
    return null;
  // not hanlded for now
  const {configuration: {Branch, Owner, Repo}} = githubDetails[0];

  const githubCommitDetails = await Promise.fromCallback(callback => {
    context.request(
      {
        url: `https://api.github.com/repos/${Owner}/${Repo}/commits/${artifactRevision.revisionId}`,
        headers: {
          Authorization: `token ${context.github.token}`,
          'User-Agent': 'codepipeline-watch-lambda',
          json: true
        }
      },
      (err, response, body) => {
        if (err) return callback(err);
        if (response.statusCode !== 200)
          return callback(new Error(`Status code was ${response.statusCode}`));
        return callback(null, JSON.parse(body));
      }
    );
  });
  // §maybe later use file too
  const author = _.get('author.login', githubCommitDetails);
  const authorName = _.get('commit.author.name', githubCommitDetails);
  const authorLink = _.get('author.html_url', githubCommitDetails);
  const authorIcon = `${authorLink}.png?size=16`;
  const committer = _.get('commit.committer.name', githubCommitDetails);
  const committerName = _.get('commit.committer.name', githubCommitDetails);
  const committerLink = _.get('committer.html_url', githubCommitDetails);
  const committerIcon = `${committerLink}.png?size=16`;
  return {
    owner: Owner,
    repo: Repo,
    branch: Branch,
    author,
    authorName,
    authorLink,
    authorIcon,
    stats: githubCommitDetails.stats,
    committer,
    committerName,
    committerLink,
    committerIcon
  };
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
  const pipelineDetails = (await aws.codepipeline.getPipeline({name: pipelineName}).promise())
    .pipeline;
  // §TODO only do if github token
  const commitDetails = await getCommitDetails(context, pipelineDetails);
  const slackThreadMessage = await slack.web.chat.postMessage({
    as_user: true,
    channel: slack.channel,
    text: pipelineExectionMessage,
    thread_ts: slackPostedMessage.message.ts
  });
  await aws.dynamoDocClient
    .put({
      TableName: aws.dynamodbTable,
      Item: {
        projectName,
        executionId,
        slackThreadTs: slackPostedMessage.message.ts,
        originalMessage: startAttachments,
        codepipelineDetails: pipelineDetails,
        commitDetails,
        pendingMessages: {},
        currentActions: [],
        currentStage: null,
        lastActionType: null,
        threadTimeStamp: [slackThreadMessage.message.ts],
        Lock: false
      }
    })
    .promise();

  return 'Message Acknowledge';
};

const computeExecutionDetailsProperties = context => {
  const {event, pipelineData} = context.event;
  const {codepipelineDetails, originalMessage, slackThreadTs} = context.record;
  const artifactRevision = pipelineData.pipelineExecution.artifactRevisions[0];
  const commitId = artifactRevision && artifactRevision.revisionId;
  // §TODO : move up
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
    commitUrl,
    commitDetailsMessage,
    eventCurrentStage,
    nbActionsOfStage,
    eventCurrentOrder,
    codepipelineDetails,
    originalMessage,
    slackThreadTs
  };
};

const attachmentForEvent = (
  context,
  {type, stage, stageActionTypes, action, actionType, state, runOrder}
) => {
  const {event: {projectName, env, link}, executionDetails: {nbActionsOfStage}} = context;
  const fstage = stage && stage.replace(/_/g, ' ');
  let title, text, color;
  if (type === 'pipeline') {
    text = `Deployment just *${state.toLowerCase()}* <${link}|🔗>`;
    title = `${projectName} (${env})`;
    color = COLOR_CODES[state];
  } else if (type === 'stage') {
    const satIcons = _.map(sat => ACTION_TYPE_SYMBOL[sat], stageActionTypes).join('');
    text = `${satIcons} Stage *${fstage}* just *${state.toLowerCase()}*`;
    color = COLOR_CODES.pale[state];
  } else if (type === 'action') {
    text = `>${
      ACTION_TYPE_SYMBOL[actionType]
    } Action *${action}* _(stage *${fstage}* *[${runOrder}/${nbActionsOfStage}]*)_ just *${state.toLowerCase()}*`;
    color = COLOR_CODES.palest[state];
  }
  return [{title, text, color: color || '#dddddd', mrkdwn_in: ['text']}];
};

const getCommitMessage = context => {
  if (!context.executionDetails.commitId) return null;
  const commitDetails = _.get('record.commitDetails', context);
  if (!commitDetails) {
    return {
      text: context.executionDetails.commitDetailsMessage,
      mrkdwn_in: ['text'],
      color: '#dddddd'
    };
  }

  return {
    fields: [
      {
        title: 'Commit',
        value: `\`<${context.executionDetails.commitUrl}|${
          context.executionDetails.shortCommitId
        }>\``,
        short: true
      },
      {
        title: 'Author',
        value: `_<${commitDetails.authorLink}|${commitDetails.authorName}>_`,
        short: true
      }
    ],
    footer: context.executionDetails.commitMessage,
    footer_icon: commitDetails.authorIcon,
    mrkdwn_in: ['text', 'fields'],
    author_icon: 'https://github.com/github.png?size=16',
    author_name: `Github ${commitDetails.owner}/${commitDetails.repo}`,
    author_link: `https://github.com/${commitDetails.owner}/${commitDetails.repo}`,
    color: '#dddddd'
  };
};

const handleEvent = async (context, {type, stage, action, state, runOrder}) => {
  const {
    slack,
    event: {projectName, link},
    record: {codepipelineDetails},
    executionDetails: {slackThreadTs, originalMessage, shortCommitId, commitMessage}
  } = context;

  const stageDetails = _.find({name: stage}, codepipelineDetails.stages);
  const actionDetails = stageDetails && _.find({name: action}, stageDetails.actions);
  const actionType = actionDetails && _.get('actionTypeId.category', actionDetails);
  const stageActionTypes = stage && getStageActionTypes(codepipelineDetails, stage);

  const slackMessage = await slack.web.chat.postMessage({
    as_user: true,
    channel: slack.channel,
    attachments: attachmentForEvent(context, {
      type,
      stage,
      action,
      stageActionTypes,
      actionType,
      state,
      runOrder
    }),
    thread_ts: slackThreadTs
  });
  context.record.threadTimeStamp.push(slackMessage.message.ts);

  const commitAttachement = getCommitMessage(context);
  let extraMessage;
  // Update pipeline on treated messages
  if (type === 'pipeline') {
    const pipelineMessage = {
      SUCCEEDED: 'Operation is now *Completed!*',
      RESUMED: "Operation was *Resumed*, it's now in progress",
      CANCELED: 'Operation was *Canceled*',
      SUPERSEDED: 'Operation was *Superseded* while waiting, see next build',
      FAILED: `Operation is in *Failed* Status\nYou can perform a restart <${link}|there 🔗>`
    }[state];
    extraMessage = {
      text: pipelineMessage,
      mrkdwn_in: ['text'],
      color: COLOR_CODES[state]
    };
    if (commitAttachement) commitAttachement.color = COLOR_CODES.pale[state];
  }
  if (type === 'stage') {
    const satIcons = _.map(sat => ACTION_TYPE_SYMBOL[sat], stageActionTypes).join('');
    const fstage = stage.replace(/_/g, ' ');
    const stageMessage = {
      SUCCEEDED: `Stage *_${fstage}_* succeeded, waiting for the next stage to start`,
      RESUMED: `Stage *_${fstage}_* resumed, now in progress`,
      STARTED: `Stage *_${fstage}_* started, now in progress`,
      CANCELED: `Stage *_${fstage}_* canceled`,
      SUPERSEDED: `Stage *_${fstage}_* was superseeded`,
      FAILED: `Stage *_${fstage}_* in *Failed* Status\nYou can perform a restart <${link}|there 🔗>`
    }[state];
    extraMessage = {
      text: `${satIcons} ${stageMessage}`,
      mrkdwn_in: ['text'],
      color: COLOR_CODES.palest[state]
    };
  }

  if (state === 'FAILED' && type === 'pipeline' && context.record.lastActionType === 'Approval') {
    await slack.web.chat.update({
      as_user: true,
      channel: slack.channel,
      attachments: [
        {
          text: `🚫 Commit \`${shortCommitId}\` of *${projectName}* was denied to proceed <${link}|🔗>\n\`\`\`${commitMessage}\`\`\``,
          mrkdwn_in: ['text']
        }
      ],
      ts: slackThreadTs
    });
    await Promise.map(context.record.threadTimeStamp, ts =>
      slack.web.chat.delete({channel: slack.channel, ts})
    );
    context.record.threadTimeStamp = [];
  } else if (extraMessage || context.freshCommitDetails) {
    await slack.web.chat.update({
      as_user: true,
      channel: slack.channel,
      attachments: _.compact([...originalMessage, commitAttachement, extraMessage]),
      ts: slackThreadTs
    });
  }
};

// §FIXME refactor needed before extraction // ※inprogress
const handlePendingMessages = async (
  context,
  {pendingMessages, currentStage: _currentStage, currentActions: _currentActions}
) => {
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
      runOrder: _.toNumber(eventPart[4])
    };
  };
  const treatOneEventAtATime = async (pendingEvents, cStage, cActions, handledMessages) => {
    const guardList = _.map(
      ev => [ev, ...shouldProceed(extractEventSummary(ev), cStage, cActions)],
      pendingEvents
    );
    let [firstEvent, firstGuard, firstUpdates] = guardList[0];
    if (!firstGuard) {
      // handling simultaneus messages
      const simultaneusMessages = _.filter(
        ([k, v]) => v === pendingMessages[pendingEvents[0]],
        _.toPairs(pendingMessages)
      );
      // §TODO: check simulatenus messages
      const simultaneousGuardList = _.map(([ev, ts]) => {
        return [ev, ...shouldProceed(extractEventSummary(ev), cStage, cActions)];
      }, simultaneusMessages);
      const simultaneousGuard = _.find(
        ([_event, _guard, _update]) => _guard,
        simultaneousGuardList
      );

      if (!simultaneousGuard)
        return {pendingEvents, currentStage: cStage, currentActions: cActions, handledMessages};
      else [firstEvent, firstGuard, firstUpdates] = simultaneousGuard;
    }
    const _eventSummary = extractEventSummary(firstEvent);

    const eventAssociatedStage = getStageDetails(
      context.executionDetails.codepipelineDetails,
      _eventSummary.stage
    );
    if (!(_eventSummary.type === 'action' && _.size(_.get('actions', eventAssociatedStage)) <= 1))
      await handleEvent(context, _eventSummary);

    context.record.lastActionType =
      getActionType(
        context.record.codepipelineDetails,
        _eventSummary.stage,
        _eventSummary.action
      ) || context.record.lastActionType;

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
  const newPending = await treatOneEventAtATime(orderedEvents, _currentStage, _currentActions, []);
  if (!_.isEmpty(newPending.handledMessages)) {
    context.record = _.reduce(
      (acc, handledMessage) => _.unset(`pendingMessages.${handledMessage}`, acc),
      context.record,
      newPending.handledMessages
    );
    context.record = _.set(
      'currentActions',
      newPending.currentActions,
      _.set('currentStage', newPending.currentStage, context.record)
    );
  }
  return newPending;
};

exports.handler = async (event, lambdaContext) => {
  if (event.source !== 'aws.codepipeline')
    throw new Error(`Called from wrong source ${event.source}`);
  const context = await getContext(process.env, event, lambdaContext);
  const {aws} = context;

  const type = EVENT_TYPES[event['detail-type']];
  const stage = event.detail.stage;
  const action = event.detail.action;
  const state = event.detail.state;

  if (state === 'STARTED' && type === 'pipeline') {
    return handleInitialMessage(context);
  }

  const record = await getRecord(context);
  const {currentStage, currentActions} = record;
  context.record = _.cloneDeep(record);
  if (!record.commitDetails) {
    const commitDetails = await getCommitDetails(context, record.codepipelineDetails);
    if (commitDetails) {
      context.record.commitDetails = commitDetails;
      context.freshCommitDetails = true;
    }
  }
  context.executionDetails = computeExecutionDetailsProperties(context); // §todo:maybe: rename
  const eventSummary = {
    type,
    stage,
    action,
    state,
    runOrder: context.executionDetails.eventCurrentOrder
  };
  const pendingMessage = _.compact([
    type,
    state,
    stage,
    action,
    context.executionDetails.eventCurrentOrder
  ]).join(':');

  // eslint-disable-next-line prefer-const
  let [guard, update] = shouldProceed(eventSummary, currentStage, currentActions);

  let pendingResult;
  if (!guard) {
    // Postpone current message if cannot handle it after pending messages
    pendingResult = await handlePendingMessages(context, record);
    const [retryGuard, retryUpdate] = shouldProceed(
      eventSummary,
      pendingResult.currentStage,
      pendingResult.currentActions
    );
    if (!retryGuard) {
      context.record = _.set(`pendingMessages.${pendingMessage}`, event.time, context.record);
      update = {currentActions: record.currentActions, currentStage: record.currentStage};
    } else {
      update = retryUpdate;
    }
  }
  context.record = _.set(
    'currentActions',
    update.currentActions,
    _.set('currentStage', update.currentStage, context.record)
  );
  context.record.lastActionType =
    getActionType(context.record.codepipelineDetails, stage, action) ||
    context.record.lastActionType;

  if (
    guard &&
    !(
      type === 'action' && _.size(_.get('actions', context.executionDetails.eventCurrentStage)) <= 1
    )
  ) {
    await handleEvent(context, {
      type,
      stage,
      action,
      state,
      runOrder: context.executionDetails.eventCurrentOrder
    });
  }

  await handlePendingMessages(
    context,
    _.set(
      'currentActions',
      update.currentActions,
      _.set('currentStage', update.currentStage, record) // §FIXME
    )
  );

  // Update and Lock Release
  await aws.dynamoDocClient
    .put({
      TableName: aws.dynamodbTable,
      Item: _.set('Lock', false, context.record)
    })
    .promise();

  return 'Acknoledge Event';
};

exports.shouldProceed = shouldProceed;
exports.getContext = getContext;
exports.shouldProceed = shouldProceed;
exports.getRecord = getRecord;
exports.getCommitDetails = getCommitDetails;
exports.handleInitialMessage = handleInitialMessage;
exports.computeExecutionDetailsProperties = computeExecutionDetailsProperties;
exports.attachmentForEvent = attachmentForEvent;
exports.handleEvent = handleEvent;
