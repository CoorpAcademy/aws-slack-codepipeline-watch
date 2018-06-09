const {describe} = require('ava-spec');
const {computeExecutionDetailsProperties} = require('../aws-slack-codepipeline-watch');

describe('computeExecutionDetailsProperties', it => {
  it('for pipeline', t => {
    const context = {
      event: {
        event: {
          detail: {}
        },
        pipelineData: {
          pipelineExecution: {
            artifactRevisions: [
              {
                revisionId: '42424242424242',
                revisionSummary: 'Solution to all problems',
                revisionUrl: 'gitehube'
              }
            ]
          }
        }
      }
    };
    const record = {
      codepipelineDetails: {pipeline: 'details'},
      slackThreadTs: 'record.slackThreadTs',
      originalMessage: 'record.originalMessage'
    };
    const res = computeExecutionDetailsProperties(context, record);
    t.deepEqual(res, {
      artifactRevision: {
        revisionId: '42424242424242',
        revisionSummary: 'Solution to all problems',
        revisionUrl: 'gitehube'
      },
      commitId: '42424242424242',
      shortCommitId: '42424242',
      commitMessage: 'Solution to all problems',
      commitDetailsMessage: 'commit `<gitehube|42424242>`\n> Solution to all problems',
      eventCurrentStage: undefined,
      nbActionsOfStage: undefined,
      eventCurrentOrder: undefined,
      codepipelineDetails: {pipeline: 'details'},
      originalMessage: 'record.originalMessage',
      slackThreadTs: 'record.slackThreadTs'
    });
  });
  it('for actions', t => {
    const context = {
      event: {
        event: {
          'detail-type': 'CodePipeline Action Execution State Change',
          detail: {
            stage: 'mystage',
            action: 'myaction'
          }
        },
        pipelineData: {
          pipelineExecution: {
            artifactRevisions: [
              {
                revisionId: '42424242424242',
                revisionSummary: 'Solution to all problems',
                revisionUrl: 'gitehube'
              }
            ]
          }
        }
      }
    };
    const record = {
      codepipelineDetails: {
        stages: [
          {
            name: 'mystage',
            actions: [{name: 'myaction', runOrder: 1}, {name: 'myaction2', runOrder: 2}]
          }
        ]
      },
      slackThreadTs: 'record.slackThreadTs',
      originalMessage: 'record.originalMessage'
    };
    const res = computeExecutionDetailsProperties(context, record);
    t.deepEqual(res, {
      artifactRevision: {
        revisionId: '42424242424242',
        revisionSummary: 'Solution to all problems',
        revisionUrl: 'gitehube'
      },
      commitId: '42424242424242',
      shortCommitId: '42424242',
      commitMessage: 'Solution to all problems',
      commitDetailsMessage: 'commit `<gitehube|42424242>`\n> Solution to all problems',
      eventCurrentStage: {
        name: 'mystage',
        actions: [{name: 'myaction', runOrder: 1}, {name: 'myaction2', runOrder: 2}]
      },
      nbActionsOfStage: 2,
      eventCurrentOrder: 1,
      codepipelineDetails: {
        stages: [
          {
            name: 'mystage',
            actions: [{name: 'myaction', runOrder: 1}, {name: 'myaction2', runOrder: 2}]
          }
        ]
      },
      originalMessage: 'record.originalMessage',
      slackThreadTs: 'record.slackThreadTs'
    });
  });
});
