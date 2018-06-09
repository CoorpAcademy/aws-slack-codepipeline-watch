const {describe} = require('ava-spec');
const {shouldProceed} = require('../aws-slack-codepipeline-watch');

describe('shouldProceed pipeline handling', it => {
  it('declare guard false when some stage is active', t => {
    const [guard, update] = shouldProceed({type: 'pipeline', state: 'WHATEVER'}, 'someStage');
    t.is(guard, false);
    t.not(update, undefined);
  });

  it('declare guard true when some stage is not active', t => {
    const [guard, update] = shouldProceed({type: 'pipeline', state: 'WHATEVER'}, null);
    t.is(guard, true);
    t.deepEqual(update, {
      currentStage: null,
      currentActions: {runOrder: 1, actions: [], noStartedAction: true}
    });
  });
});
describe('shouldProceed stage handling', it => {
  it('declare guard false when some other stage is active and stage is STARTED', t => {
    const [guard, update] = shouldProceed(
      {type: 'stage', state: 'STARTED', stage: 'stage'},
      'someStage'
    );
    t.is(guard, false);
    t.not(update, undefined);
  });
  it('declare guard false when some other stage is active and stage is RESUMED', t => {
    const [guard, update] = shouldProceed(
      {type: 'stage', state: 'RESUMED', stage: 'stage'},
      'someStage'
    );
    t.is(guard, false);
    t.not(update, undefined);
  });
  it('declare guard false when some other stage is active and stage is other than STARTING/RESUMED', t => {
    const [guard, update] = shouldProceed(
      {type: 'stage', state: 'WHATEVER', stage: 'stage'},
      'someStage'
    );
    t.is(guard, false);
    t.not(update, undefined);
  });
  it('declare guard false when some action are still ongoing', t => {
    const [guard, update] = shouldProceed(
      {type: 'stage', state: 'WHATEVER', stage: 'stage'},
      'stage',
      {actions: ['action']}
    );
    t.is(guard, false);
    t.not(update, undefined);
  });
  it('declare guard false when no action has been handled', t => {
    const [guard, update] = shouldProceed(
      {type: 'stage', state: 'WHATEVER', stage: 'stage'},
      'stage',
      {actions: [], noStartedAction: true}
    );
    t.is(guard, false);
    t.not(update, undefined);
  });

  it('declare guard true when some stage is not active', t => {
    const [guard, update] = shouldProceed({type: 'pipeline', state: 'WHATEVER'}, null);
    t.is(guard, true);
    t.deepEqual(update, {
      currentStage: null,
      currentActions: {runOrder: 1, actions: [], noStartedAction: true}
    });
  });

  it('declare guard true when no other stage is active and state is STARTING', t => {
    const [guard, update] = shouldProceed({type: 'stage', state: 'STARTED', stage: 'stage'}, null);
    t.is(guard, true);
    t.deepEqual(update, {
      currentStage: 'stage',
      currentActions: {actions: [], noStartedAction: true, runOrder: 1}
    });
  });

  it('declare guard true when stage is active and state is CLOSING', t => {
    const [guard, update] = shouldProceed(
      {type: 'stage', state: 'FAILED', stage: 'stage'},
      'stage'
    );
    t.is(guard, true);
    t.deepEqual(update, {
      currentStage: null,
      currentActions: {actions: [], noStartedAction: false, runOrder: 1}
    });
  });
});
