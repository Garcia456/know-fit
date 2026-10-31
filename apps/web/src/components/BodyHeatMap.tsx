import { useMemo } from 'react';
import { computeHeatTiers, validateBodyMap, viewPaths } from '../lib/bodyMap';

interface Props {
  /** 范围内**已按肌群求和**的训练量（kg） */
  byMuscle: Record<string, number>;
}

const VIEWS = [
  { view: 'FRONT' as const, label: '正面', viewBox: '0 0 35 93' },
  { view: 'BACK' as const, label: '背面', viewBox: '37 0 35 93' },
];

/** 20 区热力图。契约不成立就整块报错，不静默少画。 */
export function BodyHeatMap({ byMuscle }: Props) {
  const problems = useMemo(() => validateBodyMap(), []);
  const tiers = useMemo(() => computeHeatTiers(byMuscle), [byMuscle]);

  if (problems.length > 0) {
    return (
      <div className="body-map body-map--error" role="alert">
        <p>热力图数据不完整，未渲染：</p>
        <ul>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="body-map">
      <div className="body-map__views">
        {VIEWS.map(({ view, label, viewBox }) => {
          const { groups, silhouettes } = viewPaths(view);
          return (
            <svg
              key={view}
              viewBox={viewBox}
              className="body-map__svg"
              role="img"
              aria-label={`${label}肌肉训练量`}
            >
              {silhouettes.map((d, i) => (
                <path key={`s-${i}`} d={d} className="body-silhouette" />
              ))}
              {groups.map((group) => {
                const paths = group.paths;
                if (paths.length === 0) return null;
                return (
                  <g
                    key={group.region}
                    data-region={group.region}
                    className={`body-region heat-${tiers[group.region]}${
                      group.region === 'quads' ? ' body-region--merged' : ''
                    }`}
                  >
                    {paths.map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </g>
                );
              })}
            </svg>
          );
        })}
      </div>
    </div>
  );
}