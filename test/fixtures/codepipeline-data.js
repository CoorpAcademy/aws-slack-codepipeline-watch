module.exports = {
  pipeline: {
    name: 'codepipeline-test',
    roleArn: 'arn:aws:iam::446570804799:role/ecs-staging-CodePipelineServiceRole-RA8QX37QF7OM',
    artifactStore: {
      type: 'S3',
      location: 'some-buildbucket-uj497f6bne6c'
    },
    stages: [
      {
        name: 'Source',
        actions: [
          {
            name: 'source',
            actionTypeId: {
              category: 'Source',
              owner: 'ThirdParty',
              provider: 'GitHub',
              version: '1'
            },
            runOrder: 1,
            configuration: {
              Branch: 'develop',
              OAuthToken: '****',
              Owner: 'CoorpAcademy',
              Repo: 'my-repo'
            },
            outputArtifacts: [
              {
                name: 'source'
              }
            ],
            inputArtifacts: []
          }
        ]
      },
      {
        name: 'Install',
        actions: [
          {
            name: 'Install',
            actionTypeId: {
              category: 'Build',
              owner: 'AWS',
              provider: 'CodeBuild',
              version: '1'
            },
            runOrder: 1,
            configuration: {
              ProjectName: 'codebuild-test-Install'
            },
            outputArtifacts: [],
            inputArtifacts: [
              {
                name: 'source'
              }
            ]
          }
        ]
      },
      {
        name: 'Tests',
        actions: [
          {
            name: 'Lint',
            actionTypeId: {
              category: 'Test',
              owner: 'AWS',
              provider: 'CodeBuild',
              version: '1'
            },
            runOrder: 1,
            configuration: {
              ProjectName: 'codebuild-test-lint'
            },
            outputArtifacts: [],
            inputArtifacts: [
              {
                name: 'source'
              }
            ]
          },
          {
            name: 'Tests',
            actionTypeId: {
              category: 'Test',
              owner: 'AWS',
              provider: 'CodeBuild',
              version: '1'
            },
            runOrder: 2,
            configuration: {
              ProjectName: 'codebuild-test-test'
            },
            outputArtifacts: [],
            inputArtifacts: [
              {
                name: 'source'
              }
            ]
          }
        ]
      }
    ],
    version: 1
  },
  metadata: {
    pipelineArn: 'arn:aws:codepipeline:eu-west-1:446570804799:coorp-staging-codepipeline-store',
    created: '2018-06-08T08:38:22.510Z',
    updated: '2018-06-08T08:38:22.510Z'
  }
};
