import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
} from "react";
import styled, { ThemeContext } from "styled-components";
import { animated, useSpring, config } from "react-spring";
import { useRecoilValue } from "recoil";
import { useService } from "@xstate/react";
import AuosizeInput from "react-input-autosize";
import { GlobalHotKeys } from "react-hotkeys";
import { Add, KeyboardReturn as Arrow } from "@material-ui/icons";

import SearchResults from "./SearchResults";
import ViewStageParameter from "./ViewStageParameter";
import ErrorMessage from "./ErrorMessage";

const ViewStageContainer = animated(styled.div`
  margin: 0.5rem 0.25rem;
  display: flex;
  position: relative;
`);

const ViewStageDiv = animated(styled.div`
  box-sizing: border-box;
  border: 2px dashed ${({ theme }) => theme.brand};
  border-top-left-radius: 3px;
  border-bottom-left-radius: 3px;
  border-right-width: 0;
  position: relative;
  display: flex;
`);

const ViewStageInput = styled(AuosizeInput)`
  & input {
    background-color: transparent;
    border: none;
    margin: 0.5rem;
    color: ${({ theme }) => theme.font};
    line-height: 1rem;
    border: none;
    font-weight: bold;
  }

  & input:focus {
    border: none;
    outline: none;
    font-weight: bold;
  }

  & ::placeholder {
    color: ${({ theme }) => theme.font};
    font-weight: bold;
  }
`;

const ViewStageButton = animated(styled.button`
  box-sizing: border-box;
  border: 2px dashed ${({ theme }) => theme.brand};
  color: ${({ theme }) => theme.font};
  border-radius: 3px;
  position: relative;
  margin: 0.5rem;
  line-height: 1rem;
  cursor: pointer;
  font-weight: bold;
  overflow: hidden;
  padding: 0 0.25rem;

  :focus {
    outline: none;
  }
`);

const AddIcon = animated(styled(Add)``);

const addTransform = (y) => `translate3d(0, ${y}px, 0)`;

const ArrowIcon = animated(styled(Arrow)`
  position: absolute;
  top: 0.25rem;
`);

const arrowTransform = (y) => `scale(-1, 1) translate3d(0, ${y}px, 0)`;

export const AddViewStage = React.memo(({ send, index, active }) => {
  const theme = useContext(ThemeContext);
  const [props, set] = useSpring(() => ({
    background: theme.brandMoreTransparent,
    top: active ? -3 : 0,
    opacity: 1,
    from: {
      opacity: 0,
    },
    config: config.stiff,
  }));

  useEffect(() => {
    set({ top: active ? -3 : 0 });
    active ? setEnterProps() : setLeaveProps();
  }, [active]);

  const [addProps, setAdd] = useSpring(() => ({
    y: active ? 0 : 40,
  }));

  const [arrowProps, setArrow] = useSpring(() => ({
    y: active ? -40 : 0,
  }));

  const setEnterProps = () => {
    set({ background: theme.brandTransparent });
    setAdd({ y: 0 });
    setArrow({ y: -40 });
  };

  const setLeaveProps = () => {
    set({ background: theme.brandMoreTransparent });
    setAdd({ y: 40 });
    setArrow({ y: 0 });
  };

  return (
    <ViewStageButton
      style={props}
      onMouseEnter={setEnterProps}
      onMouseLeave={setLeaveProps}
      onClick={() => send({ type: "STAGE.ADD", index })}
    >
      <ArrowIcon
        style={{ transform: arrowProps.y.interpolate(arrowTransform) }}
      />
      <AddIcon style={{ transform: addProps.y.interpolate(addTransform) }} />
    </ViewStageButton>
  );
});

const ViewStageDeleteDiv = animated(styled.div`
  box-sizing: border-box;
  border: 2px dashed ${({ theme }) => theme.brand};
  position: relative;
  border-top-right-radius: 3px;
  border-bottom-right-radius: 3px;
  border-left-width: 0;
  cursor: pointer;
`);

const ViewStageDeleteButton = animated(styled.button`
  background-color: transparent;
  border: none;
  margin: 0.5rem;
  color: ${({ theme }) => theme.font};
  line-height: 1rem;
  border: none;
  padding: 0;
  cursor: pointer;
  font-weight: bold;

  :focus {
    outline: none;
  }
`);

const ViewStageDelete = React.memo(({ send, spring }) => {
  return (
    <ViewStageDeleteDiv style={spring} onClick={() => send("STAGE.DELETE")}>
      <ViewStageDeleteButton>x</ViewStageDeleteButton>
    </ViewStageDeleteDiv>
  );
});

const ViewStage = React.memo(({ stageRef }) => {
  const theme = useContext(ThemeContext);
  const [state, send] = useService(stageRef);
  const inputRef = useRef(null);

  const { stage, parameters, active, results, currentResult } = state.context;

  const isCompleted = [
    "input.reading.selected",
    "input.reading.submitted",
  ].some(state.matches);

  const deleteProps = useSpring({
    borderStyle: isCompleted ? "solid" : "dashed",
    backgroundColor: isCompleted
      ? theme.brandTransparent
      : theme.brandMoreTransparent,
    opacity: 1,
    from: {
      opacity: 0,
    },
  });

  const props = useSpring({
    borderStyle: isCompleted ? "solid" : "dashed",
    backgroundColor: isCompleted
      ? theme.brandTransparent
      : theme.brandMoreTransparent,
    borderRightWidth: isCompleted ? 0 : 2,
    borderTopRightRadius: state.matches("delible") && !isCompleted ? 3 : 0,
    borderBottomRightRadius: state.matches("delible") && !isCompleted ? 3 : 0,
    opacity: 1,
    from: {
      opacity: 0,
    },
  });

  const actionsMap = useMemo(
    () => ({
      focusInput: () => inputRef.current && inputRef.current.select(),
      blurInput: () => inputRef.current && inputRef.current.blur(),
    }),
    [inputRef.current]
  );

  useEffect(() => {
    const listener = (state) => {
      state.actions.forEach((action) => {
        if (action.type in actionsMap) actionsMap[action.type]();
      });
    };
    stageRef.onTransition(listener);
    return () => stageRef.listeners.delete(listener);
  }, []);

  const containerProps = useSpring({
    top: state.matches("focusedViewBar.yes") && state.context.active ? -3 : 0,
    config: config.stiff,
  });

  useEffect(() => {
    inputRef.current && send({ type: "FOCUS", inputRef: inputRef });
  }, [inputRef.current]);

  return (
    <>
      <ViewStageContainer style={containerProps}>
        <ViewStageDiv style={props}>
          <ViewStageInput
            placeholder="+ add stage"
            value={stage}
            onFocus={() => !state.matches("input.editing") && send("EDIT")}
            onBlur={(e) => {
              state.matches("input.editing.searchResults.notHovering") &&
                send("BLUR");
            }}
            onChange={(e) => send({ type: "CHANGE", stage: e.target.value })}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                send({ type: "COMMIT", stage: e.target.value });
              }
            }}
            onKeyDown={(e) => {
              switch (e.key) {
                case "Escape":
                  send("BLUR");
                  break;
                case "ArrowDown":
                  send("NEXT_RESULT");
                  break;
                case "ArrowUp":
                  send("PREVIOUS_RESULT");
                  break;
              }
            }}
            style={{ fontSize: "1rem" }}
            ref={inputRef}
          />
        </ViewStageDiv>
        {isCompleted &&
          parameters.map((parameter) => (
            <ViewStageParameter
              key={parameter.id}
              parameterRef={parameter.ref}
            />
          ))}
        {state.matches("delible.yes") ? (
          <ViewStageDelete spring={deleteProps} send={send} />
        ) : null}
        {state.matches("input.editing") && (
          <SearchResults
            results={results}
            send={send}
            currentResult={currentResult}
          />
        )}
        <ErrorMessage serviceRef={stageRef} />
      </ViewStageContainer>
    </>
  );
});

export default ViewStage;
