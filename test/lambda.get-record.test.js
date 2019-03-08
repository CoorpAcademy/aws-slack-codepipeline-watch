const test = require('ava');
const Promise = require('bluebird');
const {getRecord} = require('../lambda/aws-slack-codepipeline-watch');
const {awsPromise, failingAwsPromise} = require('./utils');

test('getRecord can be resolve from first shot', async t => {
  t.plan(4);
  const res = await getRecord({
    event: {projectName: 'pn', executionId: 'eid'},
    aws: {
      dynamodbTable: 'CodepipelineWatch',
      dynamoDocClient: {
        update(params) {
          try {
            t.is(params.TableName, 'CodepipelineWatch');
            t.deepEqual(params.Key, {projectName: 'pn', executionId: 'eid'});
            t.is(params.UpdateExpression, 'SET #lock = :lock');
            return awsPromise({Attributes: 'record'});
          } catch (err) {
            return failingAwsPromise(err);
          }
        }
      }
    }
  });
  t.is(res, 'record');
});
test('getRecord can be resolved after iteration', async t => {
  let firstGet = true;
  t.plan(7);
  const res = await getRecord({
    event: {projectName: 'pn', executionId: 'eid'},
    aws: {
      dynamodbTable: 'CodepipelineWatch',
      dynamoDocClient: {
        update(params) {
          try {
            t.is(params.TableName, 'CodepipelineWatch');
            t.deepEqual(params.Key, {projectName: 'pn', executionId: 'eid'});
            t.is(params.UpdateExpression, 'SET #lock = :lock');
            const returnedValue = firstGet
              ? Promise.reject(new Error('AWt not get'))
              : Promise.resolve({Attributes: 'record'});
            firstGet = false;
            return awsPromise(returnedValue);
          } catch (err) {
            return failingAwsPromise(err);
          }
        }
      }
    }
  });
  t.is(res, 'record');
});
