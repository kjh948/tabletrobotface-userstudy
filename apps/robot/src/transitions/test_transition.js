// NOTE: might be called twice if transition and emission fncs are called separately
function transition(state, inputD, inputC, params) {
  var engagedMinX = params.engagedMinX;
  if (state === 'S0' && inputD.type === 'START') {
    return {
      state: 'S1',
      outputs: {
        RobotSpeechbubbleAction: 'Tap "Pause" to pause',
        HumanSpeechbubbleAction: ['Pause'],
      },
    };
  } else if (
      state === 'S1' && inputD.type === 'HumanSpeechbubbleAction'
      && inputD.status === 'SUCCEEDED' && inputD.result === 'Pause'
  ) {
    return {
      state: 'S2',
      outputs: {
        RobotSpeechbubbleAction: 'Tap "Resume" to resume',
        HumanSpeechbubbleAction: ['Resume'],
      },
    };
  } else if (
      state === 'S2' && inputD.type === 'HumanSpeechbubbleAction'
      && inputD.status === 'SUCCEEDED' && inputD.result === 'Resume'
  ) {
    return {
      state: 'S1',
      outputs: {
        RobotSpeechbubbleAction: 'Tap "Pause" to pause',
        HumanSpeechbubbleAction: ['Pause'],
      },
    };


  } else if (
      state === 'S1' && inputD.type === 'Features'
      && inputC.face.faceCenterX > engagedMinX
  ) {
    return {
      state: 'S2',
      outputs: {
        RobotSpeechbubbleAction: 'Tap "Resume" to resume',
        HumanSpeechbubbleAction: ['Resume'],
      },
    };
  } else if (
      state === 'S2' && inputD.type === 'Features'
      && inputC.face.faceCenterX < engagedMinX
  ) {
    return {
      state: 'S1',
      outputs: {
        RobotSpeechbubbleAction: 'Tap "Pause" to pause',
        HumanSpeechbubbleAction: ['Pause'],
      },
    };

  } else {
    return {
      state: state,
      outputs: null,
    };
  }
};

var defaultParams = {
  engagedMinX: 340,
};

module.exports = {
  transition: transition,
  defaultParams: defaultParams
};