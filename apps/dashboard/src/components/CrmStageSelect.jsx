import { forwardRef, useMemo } from 'react';
import { DEFAULT_STAGE_OPTIONS, stageLabel } from '../lib/stage';

const variantStyles = {
  control: 'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60',
  filter: 'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60',
};

const CrmStageSelect = forwardRef(function CrmStageSelect(
  {
    value,
    onChange,
    stageOptions,
    includeAny = false,
    anyValue = 'all',
    anyLabel = 'Any stage',
    disabledStages = [],
    variant = 'control',
    className = '',
    ...rest
  },
  ref
) {
  const options = useMemo(() => {
    const base = Array.isArray(stageOptions) && stageOptions.length ? stageOptions : DEFAULT_STAGE_OPTIONS;
    return base.map((stage) => String(stage));
  }, [stageOptions]);

  const disabledSet = useMemo(() => new Set(disabledStages.map((stage) => String(stage))), [disabledStages]);
  const resolvedVariant = variantStyles[variant] || variantStyles.control;

  return (
    <select
      ref={ref}
      value={value}
      onChange={onChange}
      className={`${resolvedVariant} ${className}`.trim()}
      {...rest}
    >
      {includeAny ? <option value={anyValue}>{anyLabel}</option> : null}
      {options.map((stage) => (
        <option key={stage} value={stage} disabled={disabledSet.has(stage)}>
          {stageLabel(stage)}
        </option>
      ))}
    </select>
  );
});

export default CrmStageSelect;
