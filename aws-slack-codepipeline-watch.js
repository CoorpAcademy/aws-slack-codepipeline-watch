const { WebClient } = require('@slack/client');

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
    STARTED:'#eeeeee', 
    FAILED:'#DC143C',
    SUCCEEDED: '#3CB371',
    SUPERSEDED: '',
    CANCELED: '',
    RESUMED: ''
};

exports.handler = (event, context, callback) => {
    if (event.source !== 'aws.codepipeline')
        return callback(new Error(`Called from wrong source ${event.source}`));

    if(EVENT_TYPES.pipeline !== event['detail-type']) return callback(null, 'No Treatment for now of stage and action');

    const env = /staging/.test(event.detail.pipeline) ? 'staging' : 'production';
    const pipelineName = /codepipeline-(.*)/.exec(event.detail.pipeline)[1];
    const title = `${pipelineName} (${env})`;
    const link = `https://eu-west-1.console.aws.amazon.com/codepipeline/home?region=eu-west-1#/view/${event.detail.pipeline}`
    const text = `Deployment just ${event.detail.state.toLowerCase()} <${link}|🔗>\n_(id: ${event.detail['execution-id']})_`;

    web.chat.postMessage({ channel, attachments: [{title, text, color: COLOR_CODES[event.detail.state]||'#dddddd'}] })
        .then(res => {
            callback(null, 'Acknoledge Event');
        }).catch(err => callback(err));

};
