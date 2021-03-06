import xs from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import pairwise from "xstream/extra/pairwise";
import sampleCombine from "xstream/extra/sampleCombine";
import throttle from "xstream/extra/throttle";
import { initGoal, isEqualGoalID } from "@cycle-robot-drivers/action";
import { defaultFaceFeatures } from "./features";

export function input({
  command,
  fsmUniqueStateStamped,
  actionResults,
  faceFeatures,
  voiceFeatures,
  temporalFeatures
}) {
  const command$ = command.filter(cmd => cmd.type === "LOAD_FSM");

  const inputD$ = xs.merge(
    command
      .filter(cmd => cmd.type === "START_FSM")
      .mapTo({
        type: "START"
      }),
    actionResults
  );

  // extract history features
  const stateStampedHistory$ = fsmUniqueStateStamped
    .compose(pairwise) // IMPORTANT! assumes first two unique states are S0 and S1
    .map(([x, y]) => [y, x])
    .startWith([...Array(2)].map(_ => ({ state: "", stamp: 0 })));
  const isVisibleStampedHistory$ = xs
    .merge(
      faceFeatures // for filling up pairwise
        .map(ff => ({ isVisible: ff.isVisible, stamp: ff.stamp }))
        .take(2),
      faceFeatures
        .map(ff => ({ isVisible: ff.isVisible, stamp: ff.stamp }))
        .compose(dropRepeats((x, y) => x.isVisible === y.isVisible))
    )
    .compose(pairwise)
    .map(([x, y]) => [y, x]);
  const vadStateStampedHistory$ = xs
    .merge(
      voiceFeatures // for filling up pairwise
        .map(vf => ({ vadState: vf.vadState, stamp: vf.stamp }))
        .take(2),
      voiceFeatures
        .map(vf => ({ vadState: vf.vadState, stamp: vf.stamp }))
        .compose(dropRepeats((x, y) => x.vadState === y.vadState))
    )
    .compose(pairwise)
    .map(([x, y]) => [y, x]);
  const humanSpeechbubbleActionResultStamped$ = inputD$
    .filter(inputD => inputD.type === "HumanSpeechbubbleAction")
    .map(inputD => ({ stamp: Date.now(), ...inputD }))
    .compose(
      dropRepeats(
        (x, y) => x.status === y.status && isEqualGoalID(x.goal_id, y.goal_id)
      )
    )
    .startWith({
      type: "",
      goal_id: { stamp: 0, id: "" },
      status: "",
      result: ""
    });
  const speechSynthesisActionResultStamped$ = inputD$
    .filter(inputD => inputD.type === "SpeechSynthesisAction")
    .map(inputD => ({ stamp: Date.now(), ...inputD }))
    .compose(
      dropRepeats(
        (x, y) => x.status === y.status && isEqualGoalID(x.goal_id, y.goal_id)
      )
    )
    .startWith({
      type: "",
      goal_id: { stamp: 0, id: "" },
      status: "",
      result: ""
    });

  const inputC$ = xs
    .combine(
      faceFeatures,
      voiceFeatures,
      temporalFeatures,
      stateStampedHistory$,
      isVisibleStampedHistory$,
      vadStateStampedHistory$,
      humanSpeechbubbleActionResultStamped$,
      speechSynthesisActionResultStamped$,
      faceFeatures.filter(ff => !!ff.isVisible).startWith(defaultFaceFeatures)
    )
    .map(
      ([
        faceFeatures,
        voiceFeatures,
        temporalFeatures,
        stateStampedHistory,
        isVisibleStampedHistory,
        vadStateStampedHistory,
        humanSpeechbubbleActionResultStamped,
        speechSynthesisActionResultStamped,
        lastVisibleFaceFeatures
      ]) => ({
        face: faceFeatures,
        voice: voiceFeatures,
        history: {
          stateStamped: stateStampedHistory,
          isVisibleStamped: isVisibleStampedHistory,
          vadStateStamped: vadStateStampedHistory,
          humanSpeechbubbleActionResultStamped: [
            humanSpeechbubbleActionResultStamped
          ],
          speechSynthesisActionResultStamped: [
            speechSynthesisActionResultStamped
          ],
          lastVisibleFaceFeatures
        },
        temporal: temporalFeatures
      })
    );
  return xs.merge(
    command$,
    inputD$.compose(sampleCombine(inputC$)).map(([inputD, inputC]) => ({
      type: "FSM_INPUT",
      discrete: inputD,
      continuous: inputC
    })),
    inputC$
      .map(inputC => ({
        type: "FSM_INPUT",
        discrete: { type: "Features" },
        continuous: inputC
      }))
      .compose(throttle(100)) // 10hz
  );
}

export function transitionReducer(input$) {
  const initReducer$ = xs.of(prev => {
    return {
      fsm: null,
      outputs: null
    };
  });

  const wrapOutputs = (outputs = {}) => {
    return outputs !== null
      ? Object.keys(outputs).reduce(
          (prev, name) => ({
            ...prev,
            [name]:
              outputs[name].hasOwnProperty("goal") &&
              outputs[name].hasOwnProperty("cancel")
                ? {
                    ...outputs[name],
                    goal: initGoal(outputs[name].goal)
                  }
                : {
                    goal: initGoal(outputs[name])
                    // no cancel
                  }
          }),
          {}
        )
      : outputs;
  };

  const inputReducer$ = input$.map(input => prev => {
    if (input.type === "LOAD_FSM") {
      const stamp = Date.now();
      return {
        ...prev,
        fsm: {
          stateStamped: {
            stamp,
            state: input.value.S0
          },
          transition: input.value.T,
          emission: input.value.G
        },
        trace: null,
        outputs: null
      };
    } else if (input.type === "FSM_INPUT") {
      if (prev.fsm === null) {
        console.warn(`FSM not loaded; skipping`);
        return {
          ...prev,
          outputs: null
        };
      }
      const prevStateStamped = prev.fsm.stateStamped;
      const inputD = input.discrete;
      const inputC = input.continuous;
      const state = prev.fsm.transition(prevStateStamped, inputD, inputC);
      const stamp = Date.now();
      const stateStamped = {
        // new state
        state,
        stamp
      };
      const outputs = wrapOutputs(
        prev.fsm.emission(prevStateStamped, inputD, inputC)
      );
      return {
        ...prev,
        fsm: {
          ...prev.fsm,
          stateStamped
        },
        outputs,
        trace: {
          prevStateStamped,
          input,
          stateStamped,
          outputs
        }
      };
    } else {
      console.warn(`Unknown input.type=${input.type}; skipping`);
      return {
        ...prev,
        outputs: null
      };
    }
  });

  return xs.merge(initReducer$, inputReducer$);
}

export function output(reducerState$) {
  const outputs$ = reducerState$
    .filter(rs => !!rs.outputs)
    .map(rs => rs.outputs);
  return {
    FacialExpressionAction: {
      goal: outputs$
        .filter(
          o => !!o.FacialExpressionAction && !!o.FacialExpressionAction.goal
        )
        .map(o => o.FacialExpressionAction.goal),
      cancel: outputs$
        .filter(
          o => !!o.FacialExpressionAction && !!o.FacialExpressionAction.cancel
        )
        .map(o => o.FacialExpressionAction.cancel)
    },
    RobotSpeechbubbleAction: {
      goal: outputs$
        .filter(
          o => !!o.RobotSpeechbubbleAction && !!o.RobotSpeechbubbleAction.goal
        )
        .map(o => o.RobotSpeechbubbleAction.goal),
      cancel: outputs$
        .filter(
          o => !!o.RobotSpeechbubbleAction && !!o.RobotSpeechbubbleAction.cancel
        )
        .map(o => o.RobotSpeechbubbleAction.cancel)
    },
    HumanSpeechbubbleAction: {
      goal: outputs$
        .filter(
          o => !!o.HumanSpeechbubbleAction && !!o.HumanSpeechbubbleAction.goal
        )
        .map(o => o.HumanSpeechbubbleAction.goal),
      cancel: outputs$
        .filter(
          o => !!o.HumanSpeechbubbleAction && !!o.HumanSpeechbubbleAction.cancel
        )
        .map(o => o.HumanSpeechbubbleAction.cancel)
    },
    AudioPlayerAction: {
      goal: outputs$
        .filter(o => !!o.AudioPlayerAction && !!o.AudioPlayerAction.goal)
        .map(o => o.AudioPlayerAction.goal),
      cancel: outputs$
        .filter(o => !!o.AudioPlayerAction && !!o.AudioPlayerAction.canel)
        .map(o => o.AudioPlayerAction.cancel)
    },
    SpeechSynthesisAction: {
      goal: outputs$
        .filter(
          o => !!o.SpeechSynthesisAction && !!o.SpeechSynthesisAction.goal
        )
        .map(o => o.SpeechSynthesisAction.goal),
      cancel: outputs$
        .filter(
          o => !!o.SpeechSynthesisAction && !!o.SpeechSynthesisAction.cancel
        )
        .map(o => o.SpeechSynthesisAction.cancel)
    },
    SpeechRecognitionAction: {
      goal: outputs$
        .filter(
          o => !!o.SpeechRecognitionAction && !!o.SpeechRecognitionAction.goal
        )
        .map(o => o.SpeechRecognitionAction.goal),
      cancel: outputs$
        .filter(
          o => !!o.SpeechRecognitionAction && !!o.SpeechRecognitionAction.cancel
        )
        .map(o => o.SpeechRecognitionAction.cancel)
    }
  };
}

export function RobotApp(sources) {
  // sources.state.stream.addListener({next: s => console.debug('RobotApp state', s)});

  const input$ = input(sources);
  const reducer = transitionReducer(input$);
  const outputs = output(sources.state.stream);

  return {
    state: reducer,
    ...outputs
  };
}
