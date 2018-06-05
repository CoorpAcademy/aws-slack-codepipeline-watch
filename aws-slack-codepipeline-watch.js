const { WebClient } = require('@slack/client');
const AWS = require('aws-sdk');
const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });

const token = process.env.SLACK_TOKEN;
if (!token) throw new Error('Need a valid token defined in SLACK_TOKEN');

const channel = process.env.SLACK_CHANNEL;
if (!channel) throw new Error('Need a valid chanel defined in SLACK_CHANNEL');

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

exports.handler = (event, context, callback) => {
    if (event.source !== 'aws.codepipeline')
        return callback(new Error(`Called from wrong source ${event.source}`));

    if (EVENT_TYPES.pipeline !== event['detail-type']) return callback(null, 'No Treatment for now of stage and action');
    const pipelineName = event.detail.pipeline;
    const pipelineExecutionId = event.detail['execution-id'];

    codepipeline.getPipelineExecution({ pipelineExecutionId, pipelineName }, function (err, data) {
        if (err) return callback(err)
        const artifactRevision = data.pipelineExecution.artifactRevisions[0];
        const commitId = artifactRevision.revisionId;
        const commitMessage = artifactRevision.revisionSummary;
        const commitUrl = artifactRevision.revisionUrl;
        const env = /staging/.test(pipelineName) ? 'staging' : 'production';
        const projectName = /codepipeline-(.*)/.exec(pipelineName)[1];
        const title = `${projectName} (${env})`;
        const link = `https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/${pipelineName}`;
        const text = `Deployment just *${event.detail.state.toLowerCase()}* <${link}|🔗>
commit \`<${commitUrl}|${commitId.slice(0, 8)}>\`: _${commitMessage}_
_(\`execution-id\`: <${link}/history|${pipelineExecutionId}>)_`;

        web.chat.postMessage({
            as_user: true,
            channel,
            attachments: [{ title, text, color: COLOR_CODES[event.detail.state] || '#dddddd' }]
        })
            .then(res => {
                callback(null, 'Acknoledge Event');
            }).catch(err => callback(err));

    });
};
