AWS Slack Codepipeline Watch
============================

[![GitHub tag](https://img.shields.io/github/tag/CoorpAcademy/aws-slack-codepipeline-watch.svg)](https://github.com/CoorpAcademy/aws-slack-codepipeline-watch/releases)
[![Build Status](https://travis-ci.org/CoorpAcademy/aws-slack-codepipeline-watch.svg?branch=master)](https://travis-ci.org/CoorpAcademy/aws-slack-codepipeline-watch)
[![codecov](https://codecov.io/gh/CoorpAcademy/aws-slack-codepipeline-watch/branch/master/graph/badge.svg)](https://codecov.io/gh/CoorpAcademy/aws-slack-codepipeline-watch)

> Codepipeline Watch that post updates to slack channel :traffic_light:


## Basic Deployment
> :building_construction: This documentation is in building

Here is some minimal instruction details:

- clone this repository
- set up dependencies: `nvm use` and `npm install`
- create a basic config file, with the minimal details to be configure
    ```yaml
    # ./my-config.yml
    github:
        token: MY_GITHUB_TOKEN
    slack:
        token: MY_SLACK_TOKEN
        channel: MY_SLACK_CHANNEL
    ```
- deploy it with `npx serverless deploy --config-file my-config.yml`

If your want more control over naming of creating ressource you can extend your config file with
overrides following a similar schema than in [the default config](./serverless-default-config.yml)

:warning: This will create ressources on your aws account, most importantly a dynamodb table,
and the IAM permissions to interact with you

### UnDeployment

Destroy all the things with `npx serverless remove --config-file my-config.yml`
