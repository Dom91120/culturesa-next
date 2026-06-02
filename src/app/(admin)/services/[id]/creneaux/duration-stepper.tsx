"use client";

import { formatDuration } from "./helpers";

type Props = {
  value: number;
  onStep: (dir: 1 | -1) => void;
};

export function DurationStepper({ value, onStep }: Props) {
  return (
    <div className="time-step-wrap">
      <button type="button" className="time-step-btn" onClick={() => onStep(-1)}>
        −
      </button>
      <span className="dur-val">{formatDuration(value)}</span>
      <button type="button" className="time-step-btn" onClick={() => onStep(1)}>
        +
      </button>
    </div>
  );
}
