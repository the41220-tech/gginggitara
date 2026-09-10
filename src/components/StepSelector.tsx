"use client";

import styles from "@/app/public-flow.module.css";

type StepOption = {
  readonly value: string | number;
  readonly label: string;
  readonly description?: string;
};

type StepSelectorProps = {
  readonly options: readonly StepOption[];
  readonly value: string | number;
  readonly onChange: (value: string | number) => void;
  readonly name: string;
  readonly legend: string;
  readonly className?: string;
};

export default function StepSelector({ options, value, onChange, name, legend, className = "" }: StepSelectorProps) {
  return (
    <fieldset className={className}>
      <legend className="sr-only">{legend}</legend>
      <div className={styles.partyGrid}>
        {options.map((option) => {
          const selected = value === option.value;
          const inputId = `${name}-${option.value}`;

          return (
            <label htmlFor={inputId} key={option.value} className={styles.partyLabel}>
              <input id={inputId} type="radio" name={name} value={option.value} checked={selected} onChange={() => onChange(option.value)} />
              <span className={styles.optionCopy}>
                <strong>{option.label}</strong>
                {option.description ? <span>{option.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
