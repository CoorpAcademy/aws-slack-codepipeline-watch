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


exports.handler = (event, context, callback) => {
    if (event.source !== 'aws.codepipeline')
        return callback(new Error(`Called from wrong source ${event.source}`));

    web.chat.postMessage({ channel, text: `${event.detail.pipeline} : ${event.detail.state}` })
        .then(res => {
            callback(null, 'Acknoledge Event');
        }).catch(err => callback(err));

};
