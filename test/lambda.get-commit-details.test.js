const {describe} = require('ava-spec');
const Promise = require('bluebird');
const {getCommitDetails} = require('../aws-slack-codepipeline-watch');

const codepipelineData = {
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

describe('getCommitDetails', it => {
  it('perform a query to the github api to extract details', async t => {
    const context = {
      request: (param, callback) => {
        callback(
          null,
          {statusCode: 200},
          {
            sha: 'ea42d3e8f8696860db721b7519b8eadd8a70f270',
            node_id:
              'MDY6Q29tbWl0MzI5MTg0NTM6ZWE0MmQzZThmODY5Njg2MGRiNzIxYjc1MTliOGVhZGQ4YTcwZjI3MA==',
            commit: {
              author: {
                name: 'AdrieanKhisbe',
                email: 'AdrieanKhisbe@users.noreply.github.com',
                date: '2018-06-07T16:33:00Z'
              },
              committer: {
                name: 'GitHub',
                email: 'noreply@github.com',
                date: '2018-06-07T16:33:00Z'
              },
              message: 'Merge pull request #42 from CoorpAcademy/universe-answer',
              tree: {
                sha: '89fe6ac3a29b09fc041bd6e9a5f4b30e4f872e37',
                url:
                  'https://api.github.com/repos/CoorpAcademy/my-repo/git/trees/89fe6ac3a29b09fc041bd6e9a5f4b30e4f872e37'
              },
              url:
                'https://api.github.com/repos/CoorpAcademy/my-repo/git/commits/ea42d3e8f8696860db721b7519b8eadd8a70f270',
              comment_count: 0,
              verification: {
                verified: true,
                reason: 'valid',
                signature:
                  '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJbGV48CRBK7hj4Ov3rIwAAdHIIAHUvNmkRvEY6XNovnRjKlFyg\nBEz4XCUUVIU99FhTBWEDPyMIRItU7DMGVOXCl1X6QShL8IbtHqzgT9U9yOO3OKR6\nkbpqaKcMm6S0+QqciD0VOtzOAM1hIqDE6yl5ouvwI0zCvIfowqduQ80TZHWlaK7P\nysvKeR+KcJFaVUyRs9mR1OOfE5rwMnf/dM9ZJrV6DuOhi4O28db4V6n0sR6p1Z4H\nXRYO/58l8K7J3Ju8UCPS0PvJ5rT6vwXDc01G4ZKbqjS65bsqPhEs1VD89wHrj53X\nR5H+zFrh8yUsoiAT8JZFncNRMNrATUl830ro0ohmlUD0fnWEcwBFl1mDVCC7yBg=\n=q+io\n-----END PGP SIGNATURE-----\n',
                payload:
                  'tree 89fe6ac3a29b09fc041bd6e9a5f4b30e4f872e37\nparent 66a6d08a920432fbbd84413f06749d1bd744e7df\nparent c4af29b4189aad5c9610247eb8ae14dc6ab9757f\nauthor AdrieanKhisbe <AdrieanKhisbe@users.noreply.github.com> 1528389180 +0200\ncommitter GitHub <noreply@github.com> 1528389180 +0200\n\nMerge pull request #1062 from CoorpAcademy/fix-docker-build\n\nuseless hook'
              }
            },
            url:
              'https://api.github.com/repos/CoorpAcademy/my-repo/commits/ea42d3e8f8696860db721b7519b8eadd8a70f270',
            html_url:
              'https://github.com/CoorpAcademy/my-repo/commit/ea42d3e8f8696860db721b7519b8eadd8a70f270',
            comments_url:
              'https://api.github.com/repos/CoorpAcademy/my-repo/commits/ea42d3e8f8696860db721b7519b8eadd8a70f270/comments',
            author: {
              login: 'AdrieanKhisbe',
              id: 493450,
              node_id: 'MDQ6VXNlcjQ5MzQ1MA==',
              avatar_url: 'https://avatars1.githubusercontent.com/u/493450?v=4',
              gravatar_id: '',
              url: 'https://api.github.com/users/AdrieanKhisbe',
              html_url: 'https://github.com/AdrieanKhisbe',
              followers_url: 'https://api.github.com/users/AdrieanKhisbe/followers',
              following_url: 'https://api.github.com/users/AdrieanKhisbe/following{/other_user}',
              gists_url: 'https://api.github.com/users/AdrieanKhisbe/gists{/gist_id}',
              starred_url: 'https://api.github.com/users/AdrieanKhisbe/starred{/owner}{/repo}',
              subscriptions_url: 'https://api.github.com/users/AdrieanKhisbe/subscriptions',
              organizations_url: 'https://api.github.com/users/AdrieanKhisbe/orgs',
              repos_url: 'https://api.github.com/users/AdrieanKhisbe/repos',
              events_url: 'https://api.github.com/users/AdrieanKhisbe/events{/privacy}',
              received_events_url: 'https://api.github.com/users/AdrieanKhisbe/received_events',
              type: 'User',
              site_admin: false
            },
            committer: {
              login: 'web-flow',
              id: 19864447,
              node_id: 'MDQ6VXNlcjE5ODY0NDQ3',
              avatar_url: 'https://avatars3.githubusercontent.com/u/19864447?v=4',
              gravatar_id: '',
              url: 'https://api.github.com/users/web-flow',
              html_url: 'https://github.com/web-flow',
              followers_url: 'https://api.github.com/users/web-flow/followers',
              following_url: 'https://api.github.com/users/web-flow/following{/other_user}',
              gists_url: 'https://api.github.com/users/web-flow/gists{/gist_id}',
              starred_url: 'https://api.github.com/users/web-flow/starred{/owner}{/repo}',
              subscriptions_url: 'https://api.github.com/users/web-flow/subscriptions',
              organizations_url: 'https://api.github.com/users/web-flow/orgs',
              repos_url: 'https://api.github.com/users/web-flow/repos',
              events_url: 'https://api.github.com/users/web-flow/events{/privacy}',
              received_events_url: 'https://api.github.com/users/web-flow/received_events',
              type: 'User',
              site_admin: false
            },
            parents: [
              {
                sha: '66a6d08a920432fbbd84413f06749d1bd744e7df',
                url:
                  'https://api.github.com/repos/CoorpAcademy/my-repo/commits/66a6d08a920432fbbd84413f06749d1bd744e7df',
                html_url:
                  'https://github.com/CoorpAcademy/my-repo/commit/66a6d08a920432fbbd84413f06749d1bd744e7df'
              },
              {
                sha: 'c4af29b4189aad5c9610247eb8ae14dc6ab9757f',
                url:
                  'https://api.github.com/repos/CoorpAcademy/my-repo/commits/c4af29b4189aad5c9610247eb8ae14dc6ab9757f',
                html_url:
                  'https://github.com/CoorpAcademy/my-repo/commit/c4af29b4189aad5c9610247eb8ae14dc6ab9757f'
              }
            ],
            stats: {
              total: 3,
              additions: 1,
              deletions: 2
            },
            files: [
              // later
            ]
          }
        );
      },
      github: {token: 'tokenn'},
      event: {pipelineData: {pipelineExecution: {artifactRevisions: [{revisionId: 'abcd'}]}}}
    };
    const res = await getCommitDetails(context, codepipelineData);
    t.deepEqual(res, {
      author: 'AdrieanKhisbe',
      authorIcon: 'https://github.com/AdrieanKhisbe.png?size=16',
      authorLink: 'https://github.com/AdrieanKhisbe',
      authorName: 'AdrieanKhisbe',
      branch: 'develop',
      committer: 'GitHub',
      committerIcon: 'https://github.com/web-flow.png?size=16',
      committerLink: 'https://github.com/web-flow',
      committerName: 'GitHub',
      owner: 'CoorpAcademy',
      repo: 'my-repo',
      stats: {additions: 1, deletions: 2, total: 3}
    });
  });
});
